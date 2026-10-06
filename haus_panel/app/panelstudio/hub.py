"""Zentraler Zustand: Verbindung zu Home Assistant, Zustandsspiegel, Karten, Ruhe/Wach, Ereignisse.

Die Panels erhalten über ihren WebSocket nur fertige Daten:
  init        vollständiger Stand (Zustände kompakt, Bereiche, Registry, Einstellungen, Karten, Modus)
  diff        geänderte Zustände (gebündelt, höchstens alle 250 ms)
  karten      Karussell-Inhalt, wenn er sich ändert
  modus       wach / ruhe, nacht, Verbindungsstatus
  ereignis    Klingel bzw. Person an der Tür (Kamera-Overlay)
  einstellungen  nach Änderung im Editor
  registry    nach Änderung von Bereichen oder Entitäten
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from aiohttp import web

from . import karten as kt
from . import szenen as sz
from .config import Einstellungen, EinstellungsSpeicher, Options
from .ha_client import HAClient, HAError
from .popups import PopupSpeicher, text_aus_inhalt

_LOGGER = logging.getLogger(__name__)

ATTR_MAX = 6000  # Attribute größer als das werden nicht an die Panels gesendet (Abruf bei Bedarf)
FLUSH_S = 0.25
RETRY = (2, 5, 10, 20, 30)

# Dienste, die ein Wand-Panel nicht auslösen darf
DOMAINS_GESPERRT = {
    "hassio",
    "recorder",
    "system_log",
    "logger",
    "backup",
    "shell_command",
    "rest_command",
    "python_script",
    "pyscript",
    "frontend",
    "lovelace",
    "cloud",
    "ffmpeg",
}
HOMEASSISTANT_ERLAUBT = {"turn_on", "turn_off", "toggle", "update_entity"}

# Nur lesende WebSocket-Befehle, die ein Panel durchreichen darf
WS_ERLAUBT = {
    "todo/item/list",
    "history/history_during_period",
    "logbook/get_events",
    "recorder/statistics_during_period",
    "weather/subscribe_forecast",
    "energy/get_prefs",
}
REST_ERLAUBT = ("calendars/", "logbook/", "history/period/")
AUFNAHME_WURZEL = "media-source://reolink"
AUFNAHME_TAG = "media-source://reolink/DAY|"
AUFNAHME_DATEI = "media-source://reolink/FILE|"
BILD_ERLAUBT = ("/api/camera_proxy/", "/api/media_player_proxy/", "/api/image_proxy/", "/api/image/serve/")


def kompakt(st: dict[str, Any]) -> dict[str, Any]:
    attrs = st.get("attributes") or {}
    roh = json.dumps(attrs, ensure_ascii=False, default=str)
    if len(roh) > ATTR_MAX:
        klein = {}
        for k, v in attrs.items():
            if len(json.dumps(v, ensure_ascii=False, default=str)) <= 600:
                klein[k] = v
        klein["_gross"] = True
        attrs = klein
    return {"s": st.get("state"), "a": attrs, "lc": st.get("last_changed")}


def _slug(text: str) -> str:
    t = text.lower()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


# Symbole für Bereiche ohne eigenes Symbol in HA, nach Namensbestandteilen (erster Treffer gilt)
BEREICH_SYMBOLE = (
    ("treppe", "mdi:stairs"),
    ("flur", "mdi:door"),
    ("bad", "mdi:shower"),
    ("kuche", "mdi:countertop"),
    ("gaste", "mdi:bed-double"),
    ("schlaf", "mdi:bed-king"),
    ("wohn", "mdi:sofa"),
    ("arbeit", "mdi:desk"),
    ("buro", "mdi:desk"),
    ("lukas", "mdi:teddy-bear"),
    ("kind", "mdi:teddy-bear"),
    ("oma", "mdi:account-heart"),
    ("keller", "mdi:home-floor-negative-1"),
    ("garten", "mdi:tree"),
    ("garage", "mdi:garage"),
)

# Status-LEDs (Meross „Bitte nicht stören“, Reolink-Hub) sind keine Lampen im Raum; Einstellungsschalter von Bosch,
# Reolink, Roborock, Sonos und Meross sowie Ventile, Sirenen, Auswahl- und Zahlenfelder gehören nicht aufs Panel
VERSTECKT_RE = re.compile(
    r"^light\..*(_dnd|status_led)$"
    r"|^(valve|siren|select|number)\."
    r"|^switch\..*(childlock|silentmode|prealarm|nightlypromise|humiditywarning|crossfade|loudness|autoplay|gruppierung"
    r"|bypass|vibration|intrusionalarm|bitte_nicht_storen|_dnd|ftp|push|e_mail|email|infrarot|autofokus|aufzeichn|audio"
    r"|privatsph|klingelton|config_|signalton|sensor_aktiviert|_routing|sirene|energysavingmode|warningsuppressed"
    r"|api_nutzung|_dock_|tracking|ruckkehr|patrouille|uberblenden)"
)


def bereich_symbol(area_id: str, name: str) -> str | None:
    slug = f"{area_id} {_slug(name)}"
    return next((icon for teil, icon in BEREICH_SYMBOLE if teil in slug), None)


def dienst_erlaubt(domain: str, service: str) -> bool:
    if domain in DOMAINS_GESPERRT:
        return False
    if domain == "homeassistant":
        return service in HOMEASSISTANT_ERLAUBT
    return True


class Hub:
    def __init__(self, opts: Options, client: HAClient, speicher: EinstellungsSpeicher) -> None:
        self.opts = opts
        self.client = client
        self.speicher = speicher
        self.einstellungen: Einstellungen = speicher.laden()
        self.states: dict[str, dict[str, Any]] = {}
        self.registry: dict[str, dict[str, Any]] = {}
        self.geraete: dict[str, str] = {}  # Geräte-ID -> Name (für den Systemzustand)
        self.bereiche: list[dict[str, Any]] = []
        self.ha_config: dict[str, Any] = {}
        self.clients: set[web.WebSocketResponse] = set()
        self.verbunden = False
        self.karten: list[dict] = []
        self._karten_json = ""
        self._diff: dict[str, Any] = {}
        self._flush_task: asyncio.Task | None = None
        self._tasks: list[asyncio.Task] = []
        self._hintergrund: set[asyncio.Task] = set()
        self._registry_neu = asyncio.Event()
        self._relevant = kt.relevante_entitaeten(opts.hinweise_entitaet)
        # Ruhe/Wach
        self.letzte_bewegung = time.monotonic()
        self.letzte_beruehrung = 0.0
        self.modus = "wach"
        # Music-Assistant-Player (für das Karussell) und HA-Benachrichtigungen (Glocke)
        self.musik: list[str] = []
        self.meldungen: dict[str, dict[str, Any]] = {}
        self.popups = PopupSpeicher()
        self.szenen_stat: dict[str, dict[str, Any]] = {}
        self.szenen_farben: dict[str, list[str]] = {}
        # Ereignis
        self.ereignis: dict[str, Any] | None = None
        self._ereignis_bis = 0.0

    # ------------------------------------------------------------ Lebenszyklus

    def spawn(self, coro: Any) -> asyncio.Task:
        """Hintergrundaufgabe mit gehaltener Referenz (sonst kann sie vorzeitig eingesammelt werden)."""
        task = asyncio.create_task(coro)
        self._hintergrund.add(task)
        task.add_done_callback(self._hintergrund.discard)
        return task

    def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._verbindung_loop(), name="ha-verbindung"),
            asyncio.create_task(self._takt_loop(), name="takt"),
            asyncio.create_task(self._registry_loop(), name="registry"),
        ]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        for ws in list(self.clients):
            with contextlib.suppress(Exception):
                await ws.close()

    async def _verbindung_loop(self) -> None:
        versuch = 0
        while True:
            try:
                await self._verbinden()
                versuch = 0
                await self.client.wait_closed()
                _LOGGER.warning("Verbindung zu Home Assistant getrennt")
            except HAError as err:
                _LOGGER.warning("Home Assistant nicht erreichbar: %s", err)
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOGGER.exception("Unerwarteter Fehler in der Verbindung")
            if self.verbunden:
                self.verbunden = False
                await self.senden_alle({"typ": "modus", **self.modus_daten()})
            await asyncio.sleep(RETRY[min(versuch, len(RETRY) - 1)])
            versuch += 1

    async def _verbinden(self) -> None:
        # Erst abonnieren, dann den Gesamtstand holen: so geht zwischen beiden keine Änderung verloren.
        await self.client.subscribe({"type": "subscribe_events", "event_type": "state_changed"}, self._on_state_changed)
        for ev in ("entity_registry_updated", "area_registry_updated", "device_registry_updated"):
            await self.client.subscribe({"type": "subscribe_events", "event_type": ev}, lambda _e: self._registry_neu.set())
        try:
            await self.client.subscribe({"type": "subscribe_events", "event_type": "call_service"}, self._on_dienst)
        except HAError as err:
            _LOGGER.warning("Dienstaufrufe nicht abonniert (keine Browser-Mod-Popups): %s", err)
        try:
            await self.client.subscribe({"type": "persistent_notification/subscribe"}, self._on_meldung)
        except HAError as err:
            _LOGGER.warning("Benachrichtigungen nicht abonniert: %s", err)
        states = await self.client.get_states()
        self.states = {s["entity_id"]: s for s in states if isinstance(s, dict) and "entity_id" in s}
        with contextlib.suppress(HAError):
            self.ha_config = await self.client.get_config()
        await self._registry_laden()
        self.verbunden = True
        _LOGGER.info("Mit Home Assistant verbunden (%d Entitäten, %d Bereiche)", len(self.states), len(self.bereiche))
        self._karten_neu(senden=False)
        self.spawn(self._szenen_laden())
        for ws in list(self.clients):
            await self.init_senden(ws)

    async def _registry_laden(self) -> None:
        areas = await self.client.area_registry_list()
        try:
            floors = await self.client.ws_command({"type": "config/floor_registry/list"})
        except HAError:
            floors = []
        etagen = {f.get("floor_id"): f for f in floors or [] if isinstance(f, dict)}
        devices = await self.client.device_registry_list()
        entities = await self.client.entity_registry_list_for_display()
        dev_area = {d.get("id"): d.get("area_id") for d in devices if isinstance(d, dict)}
        self.geraete = {
            d["id"]: str(d.get("name_by_user") or d.get("name") or "")
            for d in devices
            if isinstance(d, dict) and d.get("id") and not d.get("disabled_by") and d.get("entry_type") != "service"
        }
        self.bereiche = [
            {
                "id": a.get("area_id"),
                "name": a.get("name"),
                "icon": a.get("icon") or bereich_symbol(str(a.get("area_id")), str(a.get("name") or "")),
                "etage": (etagen.get(a.get("floor_id")) or {}).get("name"),
                "etage_level": (etagen.get(a.get("floor_id")) or {}).get("level"),
            }
            for a in areas
            if isinstance(a, dict) and a.get("area_id")
        ]
        reg: dict[str, dict[str, Any]] = {}
        for e in entities:
            eid = e["entity_id"]
            reg[eid] = {
                "b": e.get("area_id") or dev_area.get(e.get("device_id")),
                "d": e.get("device_id"),
                "ec": e.get("entity_category"),
                "h": e.get("hidden") or bool(VERSTECKT_RE.match(eid)),
                "n": e.get("name"),
                "i": e.get("icon"),
                "l": e.get("labels") or [],
                "p": e.get("platform"),
            }
        self._klima_zuordnen(reg)
        self.registry = reg
        self.musik = sorted(eid for eid, r in reg.items() if r.get("p") == "music_assistant" and eid.startswith("media_player."))
        self._relevant = kt.relevante_entitaeten(self.opts.hinweise_entitaet) | set(self.musik)

    def _klima_zuordnen(self, reg: dict[str, dict[str, Any]]) -> None:
        """Thermostate mit Präfix ohne Bereich über ihren Namen zuordnen (z. B. climate.x_kuche -> Bereich kuche)."""
        praefix = self.opts.klima_praefix
        if not praefix:
            return
        nach_slug: dict[str, str] = {}
        for b in self.bereiche:
            nach_slug[str(b["id"])] = b["id"]
            nach_slug[_slug(str(b.get("name") or ""))] = b["id"]
        for eid, r in reg.items():
            if eid.startswith(praefix) and not r.get("b"):
                r["b"] = nach_slug.get(eid[len(praefix) :])

    def _on_dienst(self, event: dict[str, Any]) -> None:
        data = event.get("data") or {}
        if data.get("domain") not in ("browser_mod", "script"):
            return
        sd = data.get("service_data") or {}
        # Kamera-Popup (z. B. „Wohnungstür Personenerkennung Popup“) -> Vollbild-Overlay statt Meldung, wie früher
        if data.get("domain") == "browser_mod" and data.get("service") == "popup":
            _text, kamera = text_aus_inhalt(sd.get("content"))
            if kamera:
                self.ereignis_starten(
                    "browser_mod.popup", str(sd.get("title") or "") or None, kamera, str(sd.get("tag") or "") or None
                )
                return
        if data.get("domain") == "browser_mod" and data.get("service") == "close_popup" and self.ereignis:
            tag = sd.get("tag")
            if not tag or tag == self.ereignis.get("tag"):
                self.ereignis_beenden()
        ergebnis = self.popups.verarbeiten(str(data.get("domain")), str(data.get("service")), sd)
        if ergebnis is None:
            return
        m = self.popups.meldungen.get(ergebnis) if ergebnis else None
        if m and m["prio"] == "high":  # wie an den Panels: hohe Priorität weckt die Anzeige
            self.letzte_bewegung = time.monotonic()
            self._modus_pruefen()
        self._popups_senden(ergebnis or None)

    def _popups_senden(self, neu_id: str | None = None) -> None:
        self.spawn(self.senden_alle({"typ": "popups", "liste": self.popups.liste(), "neu": neu_id}))
        self._karten_json = ""
        self._karten_neu()

    def _on_meldung(self, event: dict[str, Any]) -> None:
        typ = event.get("type")
        eintraege = event.get("notifications") or {}
        if typ == "current":
            self.meldungen = dict(eintraege)
        elif typ == "removed":
            for nid in eintraege:
                self.meldungen.pop(nid, None)
        else:
            self.meldungen.update(eintraege)
        self.spawn(self.senden_alle({"typ": "meldungen", "liste": self.meldungen_liste()}))

    def meldungen_liste(self) -> list[dict[str, Any]]:
        return sorted(self.meldungen.values(), key=lambda m: str(m.get("created_at") or ""), reverse=True)

    async def _registry_loop(self) -> None:
        while True:
            await self._registry_neu.wait()
            await asyncio.sleep(3)  # Änderungen bündeln
            self._registry_neu.clear()
            try:
                await self._registry_laden()
            except HAError as err:
                _LOGGER.warning("Registry nicht geladen: %s", err)
                continue
            await self.senden_alle(
                {"typ": "registry", "bereiche": self.bereiche, "registry": self.registry, "geraete": self.geraete}
            )

    # ------------------------------------------------------------ Zustände

    def _on_state_changed(self, event: dict[str, Any]) -> None:
        data = event.get("data") or {}
        eid = data.get("entity_id")
        if not eid:
            return
        neu = data.get("new_state")
        alt = self.states.get(eid)
        if neu is None:
            self.states.pop(eid, None)
            self._diff[eid] = None
        else:
            self.states[eid] = neu
            self._diff[eid] = kompakt(neu)
        if self._flush_task is None or self._flush_task.done():
            self._flush_task = self.spawn(self._flush())
        if eid in self._relevant or (self.opts.auto_hinweise and self._fuer_hinweise(eid, neu)):
            self._karten_neu()
        if eid in self.opts.bewegung and neu and neu.get("state") == "on":
            self.letzte_bewegung = time.monotonic()
            self._modus_pruefen()
        if eid == "sun.sun":
            self.spawn(self.senden_alle({"typ": "modus", **self.modus_daten()}))
        if eid in self.opts.ereignis_ausloeser and neu and neu.get("state") == "on" and (alt or {}).get("state") != "on":
            self.ereignis_starten(eid)

    @staticmethod
    def _fuer_hinweise(eid: str, neu: dict[str, Any] | None) -> bool:
        """Zustände, aus denen die automatischen Hinweise entstehen (Updates, Rauch, Wasser, Batterien)."""
        if eid.startswith("update."):
            return True
        dc = ((neu or {}).get("attributes") or {}).get("device_class")
        return dc in ("smoke", "moisture", "battery")

    async def _flush(self) -> None:
        await asyncio.sleep(FLUSH_S)
        diff, self._diff = self._diff, {}
        if diff:
            await self.senden_alle({"typ": "diff", "zustaende": diff})

    def _karten_neu(self, senden: bool = True) -> None:
        karten = kt.berechne(
            self.states,
            self.opts.hinweise_entitaet,
            datetime.now(UTC),
            self.einstellungen.karten_aus,
            self.musik,
            auto=self.opts.auto_hinweise,
        )
        if "meldung" not in self.einstellungen.karten_aus:
            karten = self.popups.karten() + karten
        roh = json.dumps(karten, ensure_ascii=False, sort_keys=True)
        if roh == self._karten_json:
            return
        self._karten_json = roh
        self.karten = karten
        if senden:
            self.spawn(self.senden_alle({"typ": "karten", "karten": karten}))

    # ------------------------------------------------------------ Ruhe / Wach / Ereignis

    def bewegung_aktiv(self) -> bool:
        return any((self.states.get(e) or {}).get("state") == "on" for e in self.opts.bewegung)

    def nacht(self) -> bool:
        return (self.states.get("sun.sun") or {}).get("state") == "below_horizon"

    def modus_daten(self) -> dict[str, Any]:
        return {"modus": self.modus, "nacht": self.nacht(), "verbunden": self.verbunden}

    def _modus_pruefen(self) -> None:
        jetzt = time.monotonic()
        if self.bewegung_aktiv():
            self.letzte_bewegung = jetzt
        letzte = max(self.letzte_bewegung, self.letzte_beruehrung)
        neu = "ruhe" if (jetzt - letzte) > self.einstellungen.ruhe_nach_s else "wach"
        if neu != self.modus:
            self.modus = neu
            self.spawn(self.senden_alle({"typ": "modus", **self.modus_daten()}))

    def beruehrt(self) -> None:
        self.letzte_beruehrung = time.monotonic()
        self._modus_pruefen()

    def ereignis_starten(
        self, ausloeser: str, titel: str | None = None, kamera: str | None = None, tag: str | None = None
    ) -> None:
        st = self.states.get(ausloeser) or {}
        name = titel or (st.get("attributes") or {}).get("friendly_name") or ausloeser
        alt = self.ereignis or {}
        self.ereignis = {
            "aktiv": True,
            "ausloeser": ausloeser,
            "titel": name,
            "kamera": kamera or alt.get("kamera") or self.opts.ereignis_kamera or None,
            "tueroeffner": self.opts.tueroeffner or None,
            "tag": tag or alt.get("tag"),
            "seit": alt.get("seit") or datetime.now(UTC).isoformat(),
        }
        self._ereignis_bis = time.monotonic() + self.einstellungen.ereignis_dauer_s
        self.letzte_bewegung = time.monotonic()
        self._modus_pruefen()
        self.spawn(self.senden_alle({"typ": "ereignis", **self.ereignis}))

    def ereignis_beenden(self) -> None:
        if self.ereignis is None:
            return
        self.ereignis = None
        self.spawn(self.senden_alle({"typ": "ereignis", "aktiv": False}))

    async def _szenen_laden(self) -> None:
        """Nutzung (30 Tage) und Farben aller Szenen; danach alle 30 Minuten erneut (Stand im Takt)."""
        szenen = sorted(e for e in self.states if e.startswith("scene."))
        if not szenen:
            return
        jetzt = datetime.now(UTC)
        start = jetzt - timedelta(days=sz.TAGE)
        try:
            tz = ZoneInfo(self.ha_config.get("time_zone") or "Europe/Berlin")
        except (ZoneInfoNotFoundError, ValueError):
            tz = ZoneInfo("UTC")
        try:
            verlauf = await self.client.history_during_period(
                szenen, start, jetzt, minimal_response=True, no_attributes=True, significant_changes_only=False
            )
            self.szenen_stat = sz.statistik_aus_verlauf(verlauf, start, tz)
        except HAError as err:
            _LOGGER.warning("Szenen-Verlauf nicht geladen: %s", err)
        farben: dict[str, list[str]] = {}
        for eid in szenen:
            sid = ((self.states.get(eid) or {}).get("attributes") or {}).get("id")
            if not sid:
                continue
            try:
                konfig = await self.client.rest("GET", f"config/scene/config/{sid}")
            except HAError:
                continue
            if isinstance(konfig, dict) and (f := sz.farben_aus_konfig(konfig)):
                farben[eid] = f
        self.szenen_farben = farben
        self._szenen_stand = time.monotonic()
        await self.senden_alle({"typ": "szenen", "stat": self.szenen_stat, "farben": self.szenen_farben})

    async def _takt_loop(self) -> None:
        zaehler = 0
        while True:
            await asyncio.sleep(1)
            zaehler += 1
            self._modus_pruefen()
            if self.ereignis and time.monotonic() > self._ereignis_bis:
                self.ereignis_beenden()
            if self.popups.aufraeumen():
                self._popups_senden()
            if self.verbunden and time.monotonic() - getattr(self, "_szenen_stand", time.monotonic()) > 1800:
                self._szenen_stand = time.monotonic()
                self.spawn(self._szenen_laden())
            if zaehler % 15 == 0 and self.verbunden:
                self._karten_neu()  # Restzeiten ohne Zustandsänderung (Timer) nachführen

    # ------------------------------------------------------------ Panels

    def init_daten(self) -> dict[str, Any]:
        return {
            "typ": "init",
            "zustaende": {eid: kompakt(st) for eid, st in self.states.items()},
            "bereiche": self.bereiche,
            "registry": self.registry,
            "geraete": self.geraete,
            "einstellungen": self.einstellungen.to_dict(),
            "optionen": self.opts.public(),
            "karten": self.karten,
            "meldungen": self.meldungen_liste(),
            "popups": self.popups.liste(),
            "szenen": {"stat": self.szenen_stat, "farben": self.szenen_farben},
            "ereignis": self.ereignis or {"aktiv": False},
            "ha": {
                "standort": self.ha_config.get("location_name"),
                "zeitzone": self.ha_config.get("time_zone"),
                "einheit_temp": (self.ha_config.get("unit_system") or {}).get("temperature", "°C"),
            },
            **self.modus_daten(),
        }

    async def init_senden(self, ws: web.WebSocketResponse) -> None:
        with contextlib.suppress(Exception):
            await ws.send_str(json.dumps(self.init_daten(), ensure_ascii=False, default=str))

    async def senden_alle(self, msg: dict[str, Any]) -> None:
        if not self.clients:
            return
        roh = json.dumps(msg, ensure_ascii=False, default=str)
        tot = []
        for ws in list(self.clients):
            try:
                await ws.send_str(roh)
            except Exception:
                tot.append(ws)
        for ws in tot:
            self.clients.discard(ws)

    def einstellungen_setzen(self, raw: dict[str, Any]) -> list[str]:
        abgewiesen = self.einstellungen.aktualisieren(raw)
        self.speicher.speichern(self.einstellungen)
        self._karten_json = ""
        self._karten_neu()
        self.spawn(self.senden_alle({"typ": "einstellungen", "einstellungen": self.einstellungen.to_dict()}))
        return abgewiesen

    # ------------------------------------------------------------ Anfragen der Panels

    def ohne_freigabe(self, domain: str, data: dict[str, Any]) -> str | None:
        """Erste Ziel-Entität, deren Freigabe-Helfer nicht an ist (Server-Hauptschalter im Büro u. a.)."""
        if domain not in ("switch", "homeassistant", "input_boolean", "light", "fan"):
            return None
        ziel = data.get("entity_id")
        ziele = [ziel] if isinstance(ziel, str) else ziel if isinstance(ziel, list) else []
        for eid in ziele:
            frei = self.einstellungen.freigaben.get(str(eid))
            if frei and (self.states.get(frei) or {}).get("state") != "on":
                return str(eid)
        return None

    async def _durchsuchen(self, media_id: str) -> dict[str, Any]:
        res = await self.client.ws_command({"type": "media_source/browse_media", "media_content_id": media_id}, timeout=30)
        return res if isinstance(res, dict) else {}

    async def aufnahmen(self, tag: str) -> dict[str, Any]:
        """Kameraaufnahmen der Reolink-Integration (Medienquelle). Ohne ``tag``: Kameras mit ihren Aufnahmetagen
        (niedrige Auflösung, lädt am Panel schneller); mit ``tag``: die Aufnahmen dieses Tages."""
        if tag:
            if not tag.startswith(AUFNAHME_TAG):
                raise ValueError("Tag ungültig")
            res = await self._durchsuchen(tag)
            return {
                "aufnahmen": [
                    {"id": c.get("media_content_id"), "titel": c.get("title")}
                    for c in res.get("children") or []
                    if str(c.get("media_content_id", "")).startswith(AUFNAHME_DATEI)
                ]
            }
        kameras = []
        for cam in (await self._durchsuchen(AUFNAHME_WURZEL)).get("children") or []:
            res = await self._durchsuchen(str(cam.get("media_content_id")))
            aufl = res.get("children") or []
            sub = next((c for c in aufl if str(c.get("media_content_id", "")).endswith("|sub")), aufl[0] if aufl else None)
            tage = (await self._durchsuchen(str(sub.get("media_content_id")))).get("children") or [] if sub else []
            kameras.append(
                {
                    "titel": cam.get("title"),
                    "bild": cam.get("thumbnail"),
                    "tage": [{"id": t.get("media_content_id"), "titel": t.get("title")} for t in reversed(tage[-31:])],
                }
            )
        return {"kameras": kameras}

    async def aufnahme_pfad(self, media_id: str) -> str:
        """Signierter HA-Pfad einer Aufnahme (``/api/reolink/video/…?authSig=…``)."""
        if not media_id.startswith(AUFNAHME_DATEI):
            raise ValueError("Aufnahme ungültig")
        res = await self.client.ws_command({"type": "media_source/resolve_media", "media_content_id": media_id}, timeout=30)
        url = str((res or {}).get("url") or "")
        if not url.startswith("/api/reolink/") or ".." in url:
            raise ValueError("Aufnahme nicht abspielbar")
        return url

    async def anfrage(self, msg: dict[str, Any]) -> Any:
        """Bearbeitet eine Anfrage mit ``id``; Rückgabe ist das Ergebnis, Fehler als HAError/ValueError."""
        typ = msg.get("typ")
        if typ == "dienst":
            domain, service = str(msg.get("domain", "")), str(msg.get("service", ""))
            if not dienst_erlaubt(domain, service):
                raise ValueError(f"Dienst {domain}.{service} ist am Panel nicht erlaubt")
            data = msg.get("data") if isinstance(msg.get("data"), dict) else {}
            if gesperrt := self.ohne_freigabe(domain, data):
                raise ValueError(f"{gesperrt} ist ohne Freigabe gesperrt")
            return await self.client.call_service(domain, service, data, return_response=bool(msg.get("antwort")))
        if typ == "ws":
            befehl = msg.get("befehl") if isinstance(msg.get("befehl"), dict) else {}
            if befehl.get("type") not in WS_ERLAUBT:
                raise ValueError(f"Befehl {befehl.get('type')} ist nicht erlaubt")
            return await self.client.ws_command(befehl, timeout=60)
        if typ == "rest":
            pfad = str(msg.get("pfad", ""))
            if not pfad.startswith(REST_ERLAUBT) or ".." in pfad:
                raise ValueError("Pfad nicht erlaubt")
            return await self.client.rest("GET", pfad)
        if typ == "attribute":
            eid = str(msg.get("entity_id", ""))
            st = self.states.get(eid)
            return (st or {}).get("attributes") or {}
        if typ == "kamera_stream":
            # Livestream (HLS) anfordern; Ergebnis ist ein Pfad, den das Panel über /api/hls/… lädt
            eid = str(msg.get("entity_id", ""))
            if not re.match(r"^camera\.[a-z0-9_]+$", eid):
                raise ValueError("Kamera ungültig")
            res = await self.client.ws_command({"type": "camera/stream", "entity_id": eid, "format": "hls"}, timeout=40)
            url = str((res or {}).get("url") or "")
            if not url.startswith("/api/hls/"):
                raise ValueError("Kein Livestream verfügbar")
            return url.removeprefix("/")
        if typ == "aufnahmen":
            return await self.aufnahmen(str(msg.get("tag") or ""))
        if typ == "popup_schliessen":
            if self.popups.entfernen(str(msg.get("popup", ""))):
                self._popups_senden()
            return True
        if typ == "ereignis_ende":
            self.ereignis_beenden()
            return True
        if typ == "ereignis_test":
            self.ereignis_starten((self.opts.ereignis_ausloeser or ["test"])[0])
            return True
        raise ValueError(f"Unbekannte Anfrage {typ}")
