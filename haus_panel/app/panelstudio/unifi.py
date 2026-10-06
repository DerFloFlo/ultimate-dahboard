"""UniFi-Controller: WLAN-Geräte mit Signalstärke.

Die UniFi-Integration von Home Assistant liefert keine Signalstärken der WLAN-Clients. Das Panel fragt sie deshalb
direkt beim Controller ab (nur lesend). Unterstützt UniFi OS (Cloud Gateway, Dream Machine, Cloud Key Gen2+, Port 443,
Pfade unter ``/proxy/network``) und den klassischen Network-Controller (Port 8443).
"""

from __future__ import annotations

import logging
import time
from typing import Any

import aiohttp

_LOGGER = logging.getLogger(__name__)

TIMEOUT = aiohttp.ClientTimeout(total=15)


class UnifiFehler(Exception):
    """Abfrage beim UniFi-Controller fehlgeschlagen (Text für die Anzeige)."""


def _basis(adresse: str) -> str:
    a = adresse.strip().rstrip("/")
    if not a.startswith(("http://", "https://")):
        a = "https://" + a
    return a


def band(radio: str | None, kanal: Any) -> str:
    """Funkband aus Radio-Kennung (ng/na/6e) bzw. Kanal."""
    r = (radio or "").lower()
    if r == "6e":
        return "6 GHz"
    if r == "na":
        return "5 GHz"
    if r == "ng":
        return "2,4 GHz"
    try:
        k = int(kanal)
    except (TypeError, ValueError):
        return ""
    return "2,4 GHz" if k <= 14 else "5 GHz"


def client_aufbereiten(c: dict[str, Any], aps: dict[str, str]) -> dict[str, Any] | None:
    """Einen Eintrag aus ``stat/sta`` auf das Panel-Format bringen (nur WLAN-Clients mit Signal)."""
    if c.get("is_wired"):
        return None
    signal = c.get("signal")
    if not isinstance(signal, (int, float)):
        rssi = c.get("rssi")
        # Ältere Controller liefern nur rssi (positiv, über dem Grundrauschen); grob in dBm umrechnen
        signal = rssi - 95 if isinstance(rssi, (int, float)) and rssi > 0 else None
    if signal is None:
        return None
    name = c.get("name") or c.get("hostname") or c.get("oui") or c.get("mac") or "Unbekannt"
    return {
        "name": str(name),
        "mac": c.get("mac", ""),
        "ip": c.get("ip") or c.get("last_ip") or "",
        "signal": int(signal),
        "zufriedenheit": c.get("satisfaction") if isinstance(c.get("satisfaction"), (int, float)) else None,
        "ssid": c.get("essid") or "",
        "band": band(c.get("radio"), c.get("channel")),
        "ap": aps.get(c.get("ap_mac", ""), ""),
    }


class UnifiClient:
    def __init__(self, session: aiohttp.ClientSession, adresse: str, benutzer: str, passwort: str, site: str = "default"):
        self._s = session
        self._basis = _basis(adresse)
        self._benutzer = benutzer
        self._passwort = passwort
        self._site = site or "default"
        self._unifi_os: bool | None = None
        self._kopf: dict[str, str] = {}
        self._cookies: dict[str, str] = {}

    def _pfad(self, p: str) -> str:
        pre = "/proxy/network" if self._unifi_os else ""
        return f"{self._basis}{pre}/api/s/{self._site}/{p}"

    async def _anmelden(self) -> None:
        daten = {"username": self._benutzer, "password": self._passwort, "remember": True}
        for os_, pfad in ((True, "/api/auth/login"), (False, "/api/login")):
            try:
                async with self._s.post(self._basis + pfad, json=daten, ssl=False, timeout=TIMEOUT) as r:
                    if r.status == 404:
                        continue
                    if r.status in (400, 401, 403):
                        raise UnifiFehler("Anmeldung abgelehnt – Benutzername oder Passwort prüfen (lokaler Benutzer nötig)")
                    if r.status >= 400:
                        raise UnifiFehler(f"Anmeldung fehlgeschlagen (HTTP {r.status})")
                    self._unifi_os = os_
                    self._cookies = {k: v.value for k, v in r.cookies.items()}
                    tok = r.headers.get("X-CSRF-Token") or r.headers.get("x-updated-csrf-token")
                    self._kopf = {"X-CSRF-Token": tok} if tok else {}
                    return
            except aiohttp.ClientError as err:
                raise UnifiFehler(f"Controller nicht erreichbar: {err.__class__.__name__}") from err
        raise UnifiFehler("Kein UniFi-Controller unter dieser Adresse gefunden")

    async def _get(self, p: str, erneut: bool = True) -> list[dict[str, Any]]:
        if self._unifi_os is None:
            await self._anmelden()
        try:
            async with self._s.get(self._pfad(p), headers=self._kopf, cookies=self._cookies, ssl=False, timeout=TIMEOUT) as r:
                if r.status == 401 and erneut:
                    self._unifi_os = None
                    return await self._get(p, erneut=False)
                if r.status >= 400:
                    raise UnifiFehler(f"Abfrage {p} fehlgeschlagen (HTTP {r.status})")
                j = await r.json(content_type=None)
        except aiohttp.ClientError as err:
            raise UnifiFehler(f"Controller nicht erreichbar: {err.__class__.__name__}") from err
        return j.get("data", []) if isinstance(j, dict) else []

    async def wlan_geraete(self) -> list[dict[str, Any]]:
        geraete = await self._get("stat/device")
        aps = {d.get("mac", ""): d.get("name") or d.get("model") or d.get("mac", "") for d in geraete if d.get("type") == "uap"}
        clients = await self._get("stat/sta")
        liste = [x for x in (client_aufbereiten(c, aps) for c in clients) if x]
        liste.sort(key=lambda x: x["signal"])
        return liste


async def abfrage(client: UnifiClient) -> dict[str, Any]:
    """Ergebnis für das Panel: Geräteliste oder Fehlertext, mit Zeitstempel."""
    try:
        return {"aktiv": True, "geraete": await client.wlan_geraete(), "fehler": None, "stand": time.time()}
    except UnifiFehler as err:
        _LOGGER.warning("UniFi: %s", err)
        return {"aktiv": True, "geraete": [], "fehler": str(err), "stand": time.time()}
    except Exception as err:
        _LOGGER.exception("UniFi: unerwarteter Fehler")
        return {"aktiv": True, "geraete": [], "fehler": f"Unerwarteter Fehler: {err}", "stand": time.time()}
