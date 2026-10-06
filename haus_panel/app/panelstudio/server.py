"""Zwei aiohttp-Anwendungen auf einem gemeinsamen Hub.

Ingress (Port 8099): Editor in der HA-Seitenleiste und Panel-Vorschau; nur vom Supervisor-Ingress erreichbar.
Panel (Port 8098):   Wandpanel im LAN; Zugang mit Zugangsschlüssel (einmal ``/?token=…`` aufrufen, danach Cookie).
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import logging
import os
import re
import secrets
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web

from . import __version__
from .config import DATA_DIR, EinstellungsSpeicher, Options
from .ha_client import HAClient, HAError
from .hub import BILD_ERLAUBT, Hub

_LOGGER = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"
INGRESS_IP = "172.30.32.2"
COOKIE = "pmps_zugang"

CSP = (
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; "
    "frame-ancestors 'self'; base-uri 'self'"
)

K_HUB: web.AppKey[Hub] = web.AppKey("hub")
K_TOKEN: web.AppKey[list[str]] = web.AppKey("token")
K_ROLLE: web.AppKey[str] = web.AppKey("rolle")


def allowed_networks() -> list[Any]:
    raw = os.environ.get("PMPS_ALLOWED_IPS", INGRESS_IP)
    return [ipaddress.ip_network(p.strip(), strict=False) for p in raw.split(",") if p.strip()]


def make_ingress_filter(networks: list[Any]):
    @web.middleware
    async def ingress_filter(request: web.Request, handler):
        try:
            addr = ipaddress.ip_address(request.remote or "")
        except ValueError:
            addr = None
        if addr is None or not any(addr in net for net in networks):
            _LOGGER.warning("Zugriff von %s abgewiesen (nur Ingress erlaubt)", request.remote)
            raise web.HTTPForbidden(text="Nur über Home-Assistant-Ingress erreichbar.")
        return await handler(request)

    return ingress_filter


@web.middleware
async def panel_zugang(request: web.Request, handler):
    token = request.app[K_TOKEN][0]
    if request.path == "/api/health":
        return await handler(request)
    angegeben = request.query.get("token")
    if angegeben is not None:
        if secrets.compare_digest(angegeben, token):
            resp = web.HTTPFound("/")
            resp.set_cookie(COOKIE, token, max_age=10 * 365 * 86400, httponly=True, samesite="Strict")
            raise resp
        raise web.HTTPForbidden(text="Zugangsschlüssel ungültig.")
    if not secrets.compare_digest(request.cookies.get(COOKIE, ""), token):
        raise web.HTTPForbidden(
            text="Kein Zugang. Bitte die Panel-Adresse mit Zugangsschlüssel aus Haus Eichner Panel (Seitenleiste) öffnen."
        )
    return await handler(request)


@web.middleware
async def sicherheits_header(request: web.Request, handler):
    try:
        resp = await handler(request)
    except web.HTTPException as exc:
        exc.headers.setdefault("Content-Security-Policy", CSP)
        raise
    resp.headers.setdefault("Content-Security-Policy", CSP)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    if request.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    elif request.path.startswith("/static/"):
        resp.headers.setdefault("Cache-Control", "no-cache")
    return resp


# ------------------------------------------------------------------ Handler


async def health(request: web.Request) -> web.Response:
    hub = request.app[K_HUB]
    return web.json_response({"ok": True, "version": __version__, "verbunden": hub.verbunden, "panels": len(hub.clients)})


def _html(name: str) -> web.FileResponse:
    resp = web.FileResponse(STATIC_DIR / name)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


async def seite_panel(_request: web.Request) -> web.FileResponse:
    return _html("index.html")


async def seite_editor(_request: web.Request) -> web.FileResponse:
    return _html("editor.html")


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    hub = request.app[K_HUB]
    ws = web.WebSocketResponse(heartbeat=25, max_msg_size=1024 * 1024)
    await ws.prepare(request)
    hub.clients.add(ws)
    _LOGGER.info("Panel verbunden (%s, %s), jetzt %d", request.remote, request.app[K_ROLLE], len(hub.clients))
    await hub.init_senden(ws)
    try:
        async for msg in ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            if data.get("typ") == "beruehrt":
                hub.beruehrt()
                continue
            hub.spawn(_anfrage(hub, ws, data))
    finally:
        hub.clients.discard(ws)
        _LOGGER.info("Panel getrennt, jetzt %d", len(hub.clients))
    return ws


async def _anfrage(hub: Hub, ws: web.WebSocketResponse, data: dict[str, Any]) -> None:
    antwort: dict[str, Any] = {"typ": "antwort", "id": data.get("id")}
    try:
        antwort["ergebnis"] = await hub.anfrage(data)
        antwort["ok"] = True
    except (HAError, ValueError) as err:
        antwort["ok"] = False
        antwort["fehler"] = getattr(err, "meldung", None) or str(err)
    except Exception as err:  # Anfragen dürfen den Panel-Socket nicht beenden
        _LOGGER.exception("Anfrage fehlgeschlagen")
        antwort["ok"] = False
        antwort["fehler"] = str(err)
    with contextlib.suppress(Exception):
        await ws.send_str(json.dumps(antwort, ensure_ascii=False, default=str))


async def bild(request: web.Request) -> web.Response:
    """Kamerabilder und Cover über Home Assistant (die Panels kennen kein HA-Token)."""
    hub = request.app[K_HUB]
    pfad = request.query.get("pfad", "")
    if not pfad.startswith(BILD_ERLAUBT) or ".." in pfad:
        raise web.HTTPBadRequest(text="Pfad nicht erlaubt")
    try:
        daten, ctype = await hub.client.rest_raw(pfad.removeprefix("/api"))
    except HAError as err:
        raise web.HTTPBadGateway(text=str(err)) from err
    if not ctype.startswith("image/"):
        raise web.HTTPBadGateway(text="Keine Bilddaten")
    return web.Response(body=daten, content_type=ctype, headers={"Cache-Control": "no-store"})


KAMERA_RE = re.compile(r"^camera\.[a-z0-9_]+$")


async def kamera(request: web.Request) -> web.StreamResponse:
    """MJPEG-Livebild einer Kamera (camera_proxy_stream), durchgereicht bis das Panel die Verbindung schließt."""
    hub = request.app[K_HUB]
    eid = request.query.get("eid", "")
    if not KAMERA_RE.match(eid):
        raise web.HTTPBadRequest(text="Kamera ungültig")
    try:
        quelle = await hub.client.stream_oeffnen(f"camera_proxy_stream/{eid}")
    except HAError as err:
        raise web.HTTPBadGateway(text=str(err)) from err
    try:
        ziel = web.StreamResponse(
            headers={"Content-Type": quelle.headers.get("Content-Type", "multipart/x-mixed-replace"), "Cache-Control": "no-store"}
        )
        await ziel.prepare(request)
        async for block in quelle.content.iter_chunked(64 * 1024):
            await ziel.write(block)
    except (ConnectionResetError, aiohttp.ClientError, asyncio.CancelledError):
        pass
    finally:
        quelle.release()
    return ziel


HLS_RE = re.compile(r"^[A-Za-z0-9_\-]+/[A-Za-z0-9_\-./]+$")


async def hls(request: web.Request) -> web.StreamResponse:
    """HLS-Livestream von Home Assistant durchreichen (Playlisten und Segmente, Pfade relativ zu /api/hls/)."""
    hub = request.app[K_HUB]
    pfad = request.match_info["pfad"]
    if not HLS_RE.match(pfad) or ".." in pfad:
        raise web.HTTPBadRequest(text="Pfad ungültig")
    try:
        quelle = await hub.client.stream_oeffnen(f"hls/{pfad}")
    except HAError as err:
        raise web.HTTPBadGateway(text=str(err)) from err
    try:
        ziel = web.StreamResponse(
            headers={"Content-Type": quelle.headers.get("Content-Type", "application/octet-stream"), "Cache-Control": "no-store"}
        )
        await ziel.prepare(request)
        async for block in quelle.content.iter_chunked(64 * 1024):
            await ziel.write(block)
    except (ConnectionResetError, aiohttp.ClientError, asyncio.CancelledError):
        pass
    finally:
        quelle.release()
    return ziel


async def video(request: web.Request) -> web.StreamResponse:
    """Kameraaufnahme abspielen: Medienquelle auflösen und das Video samt Range-Anfragen (Spulen) durchreichen."""
    hub = request.app[K_HUB]
    try:
        pfad = await hub.aufnahme_pfad(request.query.get("id", ""))
    except ValueError as err:
        raise web.HTTPBadRequest(text=str(err)) from err
    except HAError as err:
        raise web.HTTPBadGateway(text=str(err)) from err
    bereich = {"Range": request.headers["Range"]} if "Range" in request.headers else None
    try:
        quelle = await hub.client.stream_oeffnen(pfad.removeprefix("/api"), headers=bereich)
    except HAError as err:
        raise web.HTTPBadGateway(text=str(err)) from err
    try:
        kopf = {
            k: quelle.headers[k]
            for k in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges")
            if k in quelle.headers
        }
        ziel = web.StreamResponse(status=quelle.status, headers={**kopf, "Cache-Control": "no-store"})
        await ziel.prepare(request)
        async for block in quelle.content.iter_chunked(64 * 1024):
            await ziel.write(block)
    except (ConnectionResetError, aiohttp.ClientError, asyncio.CancelledError):
        pass
    finally:
        quelle.release()
    return ziel


async def einstellungen_get(request: web.Request) -> web.Response:
    hub = request.app[K_HUB]
    return web.json_response(
        {
            "einstellungen": hub.einstellungen.to_dict(),
            "optionen": hub.opts.public(),
            "token": request.app[K_TOKEN][0],
            "port": int(os.environ.get("PMPS_PANEL_PORT", "8098")),
            "version": __version__,
            "verbunden": hub.verbunden,
            "panels": len(hub.clients),
        }
    )


async def einstellungen_post(request: web.Request) -> web.Response:
    hub = request.app[K_HUB]
    try:
        raw = await request.json()
    except ValueError as err:
        raise web.HTTPBadRequest(text="JSON erwartet") from err
    if not isinstance(raw, dict):
        raise web.HTTPBadRequest(text="Objekt erwartet")
    abgewiesen = hub.einstellungen_setzen(raw)
    return web.json_response({"einstellungen": hub.einstellungen.to_dict(), "abgewiesen": abgewiesen})


async def token_neu(request: web.Request) -> web.Response:
    hub = request.app[K_HUB]
    tok = hub.speicher.token(neu=True)
    request.app[K_TOKEN][0] = tok
    panel_app = request.app.get(K_PANEL_APP)
    if panel_app is not None:
        panel_app[K_TOKEN][0] = tok
    # Verbundene Panels mit altem Schlüssel trennen
    for ws in list(hub.clients):
        with contextlib.suppress(Exception):
            await ws.close()
    return web.json_response({"token": tok})


K_PANEL_APP: web.AppKey[web.Application] = web.AppKey("panel_app")


# ------------------------------------------------------------------ Aufbau


def _gemeinsam(app: web.Application) -> None:
    app.router.add_get("/api/health", health)
    app.router.add_get("/api/ws", ws_handler)
    app.router.add_get("/api/bild", bild)
    app.router.add_get("/api/kamera", kamera)
    app.router.add_get("/api/hls/{pfad:.+}", hls)
    app.router.add_get("/api/video", video)
    app.router.add_static("/static/", STATIC_DIR, show_index=False)


def create_ingress_app(hub: Hub, token: list[str], networks: list[Any] | None = None) -> web.Application:
    app = web.Application(middlewares=[make_ingress_filter(networks or allowed_networks()), sicherheits_header])
    app[K_HUB] = hub
    app[K_TOKEN] = token
    app[K_ROLLE] = "ingress"
    app.router.add_get("/", seite_editor)
    app.router.add_get("/panel", seite_panel)
    app.router.add_get("/api/einstellungen", einstellungen_get)
    app.router.add_post("/api/einstellungen", einstellungen_post)
    app.router.add_post("/api/token", token_neu)
    _gemeinsam(app)
    return app


def create_panel_app(hub: Hub, token: list[str]) -> web.Application:
    app = web.Application(middlewares=[sicherheits_header, panel_zugang])
    app[K_HUB] = hub
    app[K_TOKEN] = token
    app[K_ROLLE] = "panel"
    app.router.add_get("/", seite_panel)
    _gemeinsam(app)
    return app


async def run(port: int, panel_port: int) -> None:
    opts = Options.load()
    logging.getLogger().setLevel(opts.log_level.upper() if opts.log_level else "INFO")
    speicher = EinstellungsSpeicher(DATA_DIR)
    async with aiohttp.ClientSession() as session:
        client = HAClient(session)
        hub = Hub(opts, client, speicher)
        token = [speicher.token()]
        ingress = create_ingress_app(hub, token)
        panel = create_panel_app(hub, token)
        ingress[K_PANEL_APP] = panel
        runners = []
        for app, p in ((ingress, port), (panel, panel_port)):
            runner = web.AppRunner(app, access_log=None)
            await runner.setup()
            await web.TCPSite(runner, "0.0.0.0", p).start()  # noqa: S104 (Container)
            runners.append(runner)
        _LOGGER.info("Haus Eichner Panel %s: Ingress-Port %d, Panel-Port %d", __version__, port, panel_port)
        hub.start()
        try:
            await asyncio.Event().wait()
        finally:
            await hub.stop()
            await client.close()
            for r in runners:
                await r.cleanup()
