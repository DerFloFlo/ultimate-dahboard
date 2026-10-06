"""Client für Home Assistant Core über den Supervisor-Proxy.

REST:      http://supervisor/core/api/...
WebSocket: ws://supervisor/core/websocket

Das Token kommt ausschließlich aus der Umgebungsvariable ``SUPERVISOR_TOKEN``
und wird nirgends gespeichert.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections.abc import Callable
from datetime import datetime
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

DEFAULT_API = "http://supervisor/core/api"
DEFAULT_WS = "ws://supervisor/core/websocket"
WS_MAX_MSG = 64 * 1024 * 1024


class HAError(Exception):
    """Fehler bei der Kommunikation mit Home Assistant.

    ``meldung`` enthält, falls vorhanden, die Fehlermeldung von HA im Klartext
    (ohne technische Präfixe), z. B. aus einer WebSocket-Fehlerantwort.
    """

    def __init__(self, message: str, code: str | None = None, meldung: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.meldung = meldung


class HAClient:
    """REST- und WebSocket-Zugriff mit automatischem Wiederverbinden."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        api_url: str | None = None,
        ws_url: str | None = None,
        token: str | None = None,
        timeout: float = 60,
    ) -> None:
        self._session = session
        self.api_url = (api_url or os.environ.get("PMPS_HA_API") or DEFAULT_API).rstrip("/")
        self.ws_url = ws_url or os.environ.get("PMPS_HA_WS") or DEFAULT_WS
        self._token = token if token is not None else os.environ.get("SUPERVISOR_TOKEN", "")
        self._timeout = timeout
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._reader: asyncio.Task | None = None
        # Offene Anfragen je Verbindung: ein beendeter Leser bricht nur seine eigenen ab.
        self._pending: dict[aiohttp.ClientWebSocketResponse, dict[int, asyncio.Future]] = {}
        self._next_id = 1
        self._connect_lock = asyncio.Lock()
        self.ha_version: str | None = None
        # Abonnements: Nachrichten-ID -> Rückruf für ``type: event``
        self._subs: dict[int, Callable[[dict[str, Any]], None]] = {}

    # ------------------------------------------------------------- REST

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}

    async def rest(self, method: str, path: str, timeout: float | None = None, **kwargs: Any) -> Any:
        url = f"{self.api_url}/{path.lstrip('/')}"
        try:
            async with self._session.request(
                method,
                url,
                headers=self._headers,
                timeout=aiohttp.ClientTimeout(total=timeout or self._timeout),
                **kwargs,
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise HAError(f"{method} {path}: HTTP {resp.status} {text[:200]}", str(resp.status))
                if resp.content_type == "application/json":
                    return await resp.json()
                return await resp.text()
        except aiohttp.ClientError as err:
            raise HAError(f"{method} {path}: {err}") from err
        except TimeoutError as err:
            raise HAError(f"{method} {path}: Zeitüberschreitung") from err

    async def rest_raw(self, path: str, timeout: float = 15) -> tuple[bytes, str]:
        """GET mit Binärantwort (Kamerabilder, Cover), Rückgabe ``(daten, content_type)``."""
        url = f"{self.api_url}/{path.lstrip('/')}"
        try:
            async with self._session.get(
                url, headers={"Authorization": f"Bearer {self._token}"}, timeout=aiohttp.ClientTimeout(total=timeout)
            ) as resp:
                if resp.status >= 400:
                    raise HAError(f"GET {path}: HTTP {resp.status}", str(resp.status))
                return await resp.read(), resp.content_type or "application/octet-stream"
        except aiohttp.ClientError as err:
            raise HAError(f"GET {path}: {err}") from err
        except TimeoutError as err:
            raise HAError(f"GET {path}: Zeitüberschreitung") from err

    async def stream_oeffnen(self, path: str, headers: dict[str, str] | None = None) -> aiohttp.ClientResponse:
        """GET ohne Gesamt-Zeitlimit für Datenströme (MJPEG, Video). Der Aufrufer gibt die Antwort mit ``release()`` frei."""
        url = f"{self.api_url}/{path.lstrip('/')}"
        try:
            resp = await self._session.get(
                url,
                headers={"Authorization": f"Bearer {self._token}", **(headers or {})},
                timeout=aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=30),
            )
        except aiohttp.ClientError as err:
            raise HAError(f"GET {path}: {err}") from err
        if resp.status >= 400:
            resp.release()
            raise HAError(f"GET {path}: HTTP {resp.status}", str(resp.status))
        return resp

    async def get_states(self) -> list[dict[str, Any]]:
        return await self.rest("GET", "states")

    async def get_config(self) -> dict[str, Any]:
        return await self.rest("GET", "config")

    async def call_service(
        self,
        domain: str,
        service: str,
        data: dict[str, Any],
        return_response: bool = False,
        timeout: float | None = None,
    ) -> Any:
        """Dienst aufrufen.

        Ohne ``return_response`` über REST ``POST /api/services/<domain>/<service>``.
        Mit ``return_response`` über WebSocket ``call_service`` (homeassistant/components/
        websocket_api/commands.py); zurückgegeben wird ``result["response"]``. Fehler von HA
        kommen so im Klartext an (``HAError.meldung``). ``entity_id`` steht in ``service_data``.
        """
        if not return_response:
            return await self.rest("POST", f"services/{domain}/{service}", timeout=timeout, json=data)
        result = await self.ws_command(
            {"type": "call_service", "domain": domain, "service": service, "service_data": data, "return_response": True},
            timeout=timeout,
        )
        if isinstance(result, dict):
            return result.get("response")
        return None

    async def history_period_rest(
        self,
        entity_ids: list[str],
        start: datetime,
        end: datetime,
        minimal: bool = True,
        no_attributes: bool = True,
        significant_only: bool = True,
    ) -> dict[str, list[dict[str, Any]]]:
        """REST ``/api/history/period/<start>`` (homeassistant/components/history/__init__.py)."""
        params = {"filter_entity_id": ",".join(entity_ids), "end_time": end.isoformat()}
        if minimal:
            params["minimal_response"] = ""
        if no_attributes:
            params["no_attributes"] = ""
        if not significant_only:
            params["significant_changes_only"] = "0"
        data = await self.rest("GET", f"history/period/{start.isoformat()}", params=params)
        result: dict[str, list[dict[str, Any]]] = {}
        for rows in data or []:
            if rows:
                eid = rows[0].get("entity_id")
                if eid:
                    result[eid] = rows
        return result

    # ------------------------------------------------------------- WebSocket

    async def _ensure_ws(self) -> aiohttp.ClientWebSocketResponse:
        if self._ws is not None and not self._ws.closed:
            return self._ws
        async with self._connect_lock:
            if self._ws is not None and not self._ws.closed:
                return self._ws
            try:
                ws = await self._session.ws_connect(
                    self.ws_url, max_msg_size=WS_MAX_MSG, heartbeat=30, timeout=aiohttp.ClientWSTimeout(ws_close=10)
                )
            except (aiohttp.ClientError, OSError) as err:
                raise HAError(f"WebSocket nicht erreichbar: {err}") from err
            try:
                msg = await asyncio.wait_for(ws.receive_json(), 15)
                if msg.get("type") != "auth_required":
                    raise HAError(f"Unerwartete Begrüßung: {msg.get('type')}")
                await ws.send_json({"type": "auth", "access_token": self._token})
                msg = await asyncio.wait_for(ws.receive_json(), 15)
                if msg.get("type") != "auth_ok":
                    raise HAError("WebSocket-Anmeldung abgelehnt", "auth_invalid")
                self.ha_version = msg.get("ha_version")
            except (TimeoutError, TypeError, ValueError) as err:
                await ws.close()
                raise HAError(f"WebSocket-Anmeldung fehlgeschlagen: {err}") from err
            except HAError:
                await ws.close()
                raise
            self._ws = ws
            self._pending[ws] = {}
            self._reader = asyncio.create_task(self._read_loop(ws))
            _LOGGER.debug("WebSocket verbunden (HA %s)", self.ha_version)
            return ws

    async def _read_loop(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        try:
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    if msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                        break
                    continue
                try:
                    data = msg.json()
                except ValueError:
                    continue
                items = data if isinstance(data, list) else [data]
                pending = self._pending.get(ws, {})
                for item in items:
                    if item.get("type") == "event":
                        cb = self._subs.get(item.get("id"))
                        if cb is not None:
                            try:
                                cb(item.get("event") or {})
                            except Exception:  # Rückruffehler dürfen den Leser nicht beenden
                                _LOGGER.exception("Fehler im Ereignis-Rückruf")
                        continue
                    fut = pending.pop(item.get("id"), None)
                    if fut is not None and not fut.done():
                        fut.set_result(item)
        finally:
            self._subs.clear()
            for fut in self._pending.pop(ws, {}).values():
                if not fut.done():
                    fut.set_exception(HAError("WebSocket-Verbindung getrennt"))

    async def ws_command(self, payload: dict[str, Any], timeout: float | None = None) -> Any:
        """Befehl senden und ``result`` zurückgeben. Ein Wiederholversuch bei Verbindungsabbruch."""
        for attempt in (1, 2):
            ws = await self._ensure_ws()
            msg_id = self._next_id
            self._next_id += 1
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            pending = self._pending.get(ws)
            if pending is None:  # Leser dieser Verbindung ist bereits beendet
                self._ws = None
                if attempt == 2:
                    raise HAError("WebSocket-Verbindung getrennt")
                continue
            pending[msg_id] = fut
            try:
                await ws.send_json({**payload, "id": msg_id})
                resp = await asyncio.wait_for(fut, timeout or self._timeout)
            except (ConnectionResetError, aiohttp.ClientError, HAError) as err:
                pending.pop(msg_id, None)
                if attempt == 2 or (isinstance(err, HAError) and err.code):
                    raise HAError(str(err)) from err
                with contextlib.suppress(Exception):
                    await ws.close()
                continue
            except TimeoutError as err:
                pending.pop(msg_id, None)
                raise HAError(f"{payload.get('type')}: Zeitüberschreitung", "timeout") from err
            if not resp.get("success", False):
                error = resp.get("error") or {}
                meldung = error.get("message")
                meldung = str(meldung).strip()[:500] if meldung else None
                raise HAError(
                    f"{payload.get('type')}: {meldung or 'unbekannter Fehler'}",
                    error.get("code", "error"),
                    meldung,
                )
            return resp.get("result")
        raise HAError("unerreichbar")  # pragma: no cover

    async def subscribe(self, payload: dict[str, Any], callback: Callable[[dict[str, Any]], None]) -> int:
        """Abonnement anlegen (z. B. ``subscribe_events``). Bricht die Verbindung ab, endet es;
        ``connected`` liefert dann False und der Aufrufer abonniert neu."""
        ws = await self._ensure_ws()
        msg_id = self._next_id
        self._next_id += 1
        self._subs[msg_id] = callback
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        pending = self._pending.get(ws)
        if pending is None:
            self._subs.pop(msg_id, None)
            raise HAError("WebSocket-Verbindung getrennt")
        pending[msg_id] = fut
        await ws.send_json({**payload, "id": msg_id})
        try:
            resp = await asyncio.wait_for(fut, self._timeout)
        except TimeoutError as err:
            self._subs.pop(msg_id, None)
            raise HAError("Abonnement: Zeitüberschreitung", "timeout") from err
        if not resp.get("success", False):
            self._subs.pop(msg_id, None)
            raise HAError(f"Abonnement abgelehnt: {(resp.get('error') or {}).get('message')}", "error")
        return msg_id

    @property
    def connected(self) -> bool:
        return self._ws is not None and not self._ws.closed and bool(self._subs)

    async def wait_closed(self) -> None:
        """Wartet, bis der Leser der aktuellen Verbindung endet."""
        if self._reader is not None:
            # asyncio.wait gibt Fehler des Lesers nicht weiter, lässt einen Abbruch des Wartenden aber durch
            await asyncio.wait({self._reader})

    async def close(self) -> None:
        if self._ws is not None:
            await self._ws.close()
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._reader

    # ------------------------------------------------------------- Befehle

    async def entity_registry_get(self, entity_id: str) -> dict[str, Any]:
        return await self.ws_command({"type": "config/entity_registry/get", "entity_id": entity_id})

    async def config_entries_get(self, domain: str | None = None) -> list[dict[str, Any]]:
        """``config_entries/get`` (config/config_entries.py); Einträge mit ``domain`` und ``state``."""
        payload: dict[str, Any] = {"type": "config_entries/get"}
        if domain:
            payload["domain"] = domain
        result = await self.ws_command(payload)
        return result if isinstance(result, list) else []

    async def get_services(self) -> dict[str, Any]:
        """``get_services`` (websocket_api/commands.py): ``{domain: {service: beschreibung}}``."""
        result = await self.ws_command({"type": "get_services"})
        return result if isinstance(result, dict) else {}

    async def area_registry_list(self) -> list[dict[str, Any]]:
        """``config/area_registry/list``: Bereiche mit ``area_id`` und ``name``."""
        result = await self.ws_command({"type": "config/area_registry/list"})
        return result if isinstance(result, list) else []

    async def entity_registry_list(self) -> list[dict[str, Any]]:
        """``config/entity_registry/list``: vollständige Einträge (``entity_id``, ``area_id``, ``device_id`` …)."""
        result = await self.ws_command({"type": "config/entity_registry/list"})
        return result if isinstance(result, list) else []

    async def entity_registry_list_for_display(self) -> list[dict[str, Any]]:
        """``config/entity_registry/list_for_display`` (kompaktes Format), umgesetzt in die Felder von
        ``config/entity_registry/list``: ``entity_id``, ``platform``, ``area_id``, ``device_id``, ``hidden``."""
        result = await self.ws_command({"type": "config/entity_registry/list_for_display"})
        eintraege = (result or {}).get("entities") if isinstance(result, dict) else None
        out: list[dict[str, Any]] = []
        for e in eintraege or []:
            if not isinstance(e, dict) or not e.get("ei"):
                continue
            out.append(
                {
                    "entity_id": e["ei"],
                    "platform": e.get("pl"),
                    "area_id": e.get("ai"),
                    "device_id": e.get("di"),
                    "hidden": bool(e.get("hb")),
                    "entity_category": e.get("ec"),
                    "name": e.get("en"),
                    "icon": e.get("ic"),
                    "labels": e.get("lb") or [],
                }
            )
        return out

    async def device_registry_list(self) -> list[dict[str, Any]]:
        """``config/device_registry/list``: Geräte mit ``id`` und ``area_id``."""
        result = await self.ws_command({"type": "config/device_registry/list"})
        return result if isinstance(result, list) else []

    async def history_during_period(
        self,
        entity_ids: list[str],
        start: datetime,
        end: datetime,
        minimal_response: bool = False,
        no_attributes: bool = False,
        significant_changes_only: bool = True,
    ) -> dict[str, list[dict[str, Any]]]:
        """``history/history_during_period`` (homeassistant/components/history/websocket_api.py)."""
        result = await self.ws_command(
            {
                "type": "history/history_during_period",
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "entity_ids": entity_ids,
                "include_start_time_state": True,
                "significant_changes_only": significant_changes_only,
                "minimal_response": minimal_response,
                "no_attributes": no_attributes,
            },
            timeout=120,
        )
        return result or {}

    async def statistics_during_period(
        self,
        statistic_ids: list[str],
        start: datetime,
        end: datetime,
        period: str = "hour",
        types: list[str] | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        """``recorder/statistics_during_period`` (homeassistant/components/recorder/websocket_api.py)."""
        result = await self.ws_command(
            {
                "type": "recorder/statistics_during_period",
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "statistic_ids": statistic_ids,
                "period": period,
                "types": types or ["mean", "min", "max"],
            },
            timeout=120,
        )
        return result or {}
