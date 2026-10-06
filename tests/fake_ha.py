"""Nachbildung der benötigten Home-Assistant-Schnittstellen für Tests und Vorschau.

Pfade wie hinter dem Supervisor-Proxy:
  REST  /core/api/states, /core/api/config, /core/api/services/<domain>/<service>, /core/api/camera_proxy/<eid>,
        /core/api/calendars/<eid>, /core/api/logbook/<start>
  WS    /core/websocket  (auth_required -> auth -> auth_ok), subscribe_events, call_service, Registry-Listen,
        todo/item/list, history/history_during_period

Start eigenständig (Vorschau):  python tests/fake_ha.py --port 8123
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import math
from datetime import UTC, datetime, timedelta
from typing import Any

from aiohttp import WSMsgType, web

TOKEN = "test-token"

AREAS = [
    ("flur", "Flur", "mdi:door"),
    ("wohnzimmer", "Wohnzimmer", "mdi:sofa"),
    ("kuche", "Küche", "mdi:countertop"),
    ("badezimmer", "Badezimmer", "mdi:shower"),
    ("schlafzimmer", "Schlafzimmer", "mdi:bed"),
    ("buro", "Büro", "mdi:desk"),
]

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2b3a8b10000000049454e44ae426082"
)


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def default_states(jetzt: datetime) -> list[dict[str, Any]]:
    def s(eid, state, area=None, **attrs):
        return {"entity_id": eid, "state": state, "attributes": attrs, "_area": area}

    return [
        s("sun.sun", "above_horizon", friendly_name="Sonne"),
        s(
            "weather.dwd_zuhause",
            "partlycloudy",
            friendly_name="DWD Zuhause",
            temperature=17.4,
            temperature_unit="°C",
            humidity=62,
        ),
        s(
            "sensor.aussentemperatur",
            "16.8",
            None,
            friendly_name="Außentemperatur",
            device_class="temperature",
            unit_of_measurement="°C",
        ),
        s("person.dominik", "home", None, friendly_name="Dominik"),
        s("person.gina_perina", "not_home", None, friendly_name="Gina Perina"),
        s("alarm_control_panel.alarmo", "armed_home", None, friendly_name="Alarmsystem", code_format="number"),
        s(
            "binary_sensor.bewegungsmelder_flur_1_bewegung",
            "off",
            "flur",
            friendly_name="Bewegungsmelder Flur 1 Bewegung",
            device_class="motion",
        ),
        s(
            "binary_sensor.bewegungsmelder_flur_2_bewegung",
            "off",
            "flur",
            friendly_name="Bewegungsmelder Flur 2 Bewegung",
            device_class="motion",
        ),
        s("binary_sensor.wohnungstuer_person", "off", "flur", friendly_name="Wohnungstür Person", device_class="occupancy"),
        s("binary_sensor.tur_wohnung", "off", "flur", friendly_name="Wohnungstür", device_class="door"),
        s("binary_sensor.buro_balkontur_tur", "on", "buro", friendly_name="Büro Balkontür", device_class="door"),
        s("binary_sensor.fenster_kuche", "off", "kuche", friendly_name="Fenster Küche", device_class="window"),
        s("lock.eingangstur", "locked", "flur", friendly_name="Schloss Wohnungstür", supported_features=1),
        s("button.haustur_tur_offnen", "2026-10-01T13:42:12+00:00", "flur", friendly_name="Haustür Tür öffnen"),
        s("camera.wohnungstuer_standardauflosung", "idle", "flur", friendly_name="Wohnungstür Kamera"),
        s(
            "light.flur_deckenlampe_flur",
            "on",
            "flur",
            friendly_name="Flur Deckenlampe",
            brightness=153,
            supported_color_modes=["brightness"],
        ),
        s(
            "light.deckenlampe_wohnzimmer",
            "on",
            "wohnzimmer",
            friendly_name="Deckenlampe Wohnzimmer",
            brightness=204,
            supported_color_modes=["color_temp", "hs"],
            color_temp_kelvin=3000,
            min_color_temp_kelvin=2200,
            max_color_temp_kelvin=6500,
        ),
        s("light.lowboard", "on", "wohnzimmer", friendly_name="Lowboard", brightness=90, supported_color_modes=["hs"]),
        s("light.lichterkette", "off", "wohnzimmer", friendly_name="Lichterkette", supported_color_modes=["onoff"]),
        s(
            "light.kuche_deckenlampe_kuche",
            "off",
            "kuche",
            friendly_name="Küche Deckenlampe",
            supported_color_modes=["brightness"],
        ),
        s("light.badezimmer", "off", "badezimmer", friendly_name="Badezimmer", supported_color_modes=["brightness"]),
        s(
            "light.deckenlampe_schlafzimmer",
            "off",
            "schlafzimmer",
            friendly_name="Deckenlampe Schlafzimmer",
            supported_color_modes=["brightness"],
        ),
        s("light.deckenlampe_buro", "off", "buro", friendly_name="Deckenlampe Büro", supported_color_modes=["brightness"]),
        s("scene.wohnzimmer_ambiente", "2026-09-30T19:00:00+00:00", "wohnzimmer", friendly_name="Wohnzimmer Ambiente"),
        s(
            "climate.pm_wohnzimmer",
            "heat",
            None,
            friendly_name="PM Wohnzimmer",
            current_temperature=21.4,
            temperature=21.0,
            current_humidity=48,
            min_temp=5,
            max_temp=25,
            hvac_action="idle",
            preset_mode="zeitplan",
            preset_modes=["zeitplan", "manuell", "komfort", "eco", "frostschutz"],
            hvac_modes=["heat", "off"],
        ),
        s(
            "climate.pm_badezimmer",
            "heat",
            "badezimmer",
            friendly_name="PM Badezimmer",
            current_temperature=22.8,
            temperature=23.0,
            current_humidity=71,
            min_temp=5,
            max_temp=25,
            hvac_action="heating",
            preset_mode="zeitplan",
            preset_modes=["zeitplan", "manuell", "komfort", "eco", "frostschutz"],
            hvac_modes=["heat", "off"],
        ),
        s(
            "sensor.schlafzimmertemperatur",
            "18.9",
            "schlafzimmer",
            friendly_name="Schlafzimmer Temperatur",
            device_class="temperature",
            unit_of_measurement="°C",
        ),
        s(
            "sensor.schlafzimmerluftfeuchte",
            "55",
            "schlafzimmer",
            friendly_name="Schlafzimmer Luftfeuchte",
            device_class="humidity",
            unit_of_measurement="%",
        ),
        s(
            "sensor.kuchentemperatur",
            "20.8",
            "kuche",
            friendly_name="Küche Temperatur",
            device_class="temperature",
            unit_of_measurement="°C",
        ),
        s(
            "sensor.buro_buro_leistung",
            "312",
            "buro",
            friendly_name="Büro Leistung",
            device_class="power",
            unit_of_measurement="W",
        ),
        s(
            "sensor.balkon_kohlegrill_derzeitiger_verbrauch",
            "0",
            None,
            friendly_name="Kohlegrill Verbrauch",
            device_class="power",
            unit_of_measurement="W",
        ),
        s(
            "sensor.schloss_batterie",
            "18",
            "flur",
            friendly_name="Schloss Batterie",
            device_class="battery",
            unit_of_measurement="%",
        ),
        s(
            "sensor.wohnungstuer_batterie",
            "48",
            "flur",
            friendly_name="Kamera Wohnungstür",
            device_class="battery",
            unit_of_measurement="%",
        ),
        s(
            "media_player.wohnzimmer",
            "playing",
            "wohnzimmer",
            friendly_name="Wohnzimmer",
            media_title="Nightcall",
            media_artist="Kavinsky",
            volume_level=0.32,
            source_list=["Spotify", "Radio"],
            source="Spotify",
        ),
        s("vacuum.roborock_s8", "docked", "flur", friendly_name="Roborock S8"),
        s("input_boolean.alles_stumm", "off", None, friendly_name="Alles stumm"),
        s("script.morgen_briefing", "off", None, friendly_name="Morgen-Briefing"),
        s("todo.einkaufsliste", "2", None, friendly_name="Einkaufsliste"),
        s("calendar.privat", "off", None, friendly_name="Privat"),
        s(
            "update.home_assistant_core_update",
            "on",
            None,
            friendly_name="Home Assistant Core",
            latest_version="2026.10.1",
            installed_version="2026.9.3",
        ),
        s(
            "climate.wohnzimmer_lokal",
            "heat",
            "wohnzimmer",
            friendly_name="Wohnzimmer lokal",
            current_temperature=21.2,
            temperature=21.0,
        ),
        s("scene.wohnzimmer_fairfax", "unknown", "wohnzimmer", friendly_name="Wohnzimmer Fairfax"),
        s(
            "media_player.wohnung_3",
            "playing",
            None,
            friendly_name="Wohnung",
            media_title="Midnight City",
            media_artist="M83",
            media_duration=244,
            media_position=60,
            media_position_updated_at=_iso(jetzt),
        ),
        s(
            "sensor.panel_bad_hinweise",
            "3",
            None,
            friendly_name="Panel Bad Hinweise",
            zeilen="termin|Termin|in 45 min|Zahnarzt\narbeit|Arbeitsweg|26 min|+4 min Verkehr\nlueften|Lüften|71 %|Fenster öffnen\noffen|Offen|1 offen|Büro Balkontür\nmuell|Müll|morgen|Biotonne, Gelber Sack\nwetter|Wetter|12–18°|70 % Regen",
        ),
        s(
            "timer.kohle_timer",
            "active",
            None,
            friendly_name="Kohle Timer",
            duration="0:15:00",
            finishes_at=_iso(jetzt + timedelta(minutes=9, seconds=20)),
            remaining="0:15:00",
        ),
        s("switch.balkon_kohlegrill", "on", None, friendly_name="Balkon Kohlegrill"),
        # Waschmaschine (Miele) und Trockner (Steckdose mit Leistungsmessung)
        s("sensor.waschmaschine_status", "in_use", None, friendly_name="Waschmaschine Status"),
        s("sensor.waschmaschine_programmabschnitt", "Waschen", None, friendly_name="Waschmaschine Programmabschnitt"),
        s("sensor.waschmaschine_programm", "Baumwolle", None, friendly_name="Waschmaschine Programm"),
        s(
            "sensor.waschmaschine_verbleibende_zeit",
            "74",
            None,
            friendly_name="Waschmaschine Verbleibende Zeit",
            unit_of_measurement="min",
        ),
        s(
            "sensor.smart_switch_24031581622418510808c4e7ae00037b_power",
            "450",
            None,
            friendly_name="Trockner Keller Power",
            device_class="power",
            unit_of_measurement="W",
        ),
        s("sensor.roborock_s8_status", "charging", "flur", friendly_name="Roborock Status"),
        # Außenluftfeuchte (lokal und DWD) sowie Verbrauchsmaterial
        s(
            "sensor.wetter_outdoor_module_luftfeuchtigkeit",
            "97",
            "balkon",
            friendly_name="Wetter Outdoor Module Luftfeuchtigkeit",
            device_class="humidity",
            unit_of_measurement="%",
        ),
        s(
            "sensor.zuhause_relative_luftfeuchtigkeit",
            "93.2",
            None,
            friendly_name="DWD Zuhause Relative Luftfeuchtigkeit",
            device_class="humidity",
            unit_of_measurement="%",
        ),
        s(
            "sensor.wohnzimmer_luftreiniger_wohnzimmer_filterwechsel",
            "94.2",
            "wohnzimmer",
            friendly_name="Luftreiniger Wohnzimmer Filterwechsel",
            unit_of_measurement="%",
        ),
        s(
            "sensor.wohnzimmer_luftreiniger_wohnzimmer_filterwechsel_verbleibende_stunden",
            "4520",
            "wohnzimmer",
            friendly_name="Luftreiniger Wohnzimmer Filterwechsel – verbleibende Stunden",
            unit_of_measurement="h",
        ),
        s(
            "sensor.wohnzimmer_luftreiniger_wohnzimmer_filterreinigung",
            "18.7",
            "wohnzimmer",
            friendly_name="Luftreiniger Wohnzimmer Filterreinigung",
            unit_of_measurement="%",
        ),
        s(
            "sensor.roborock_s8_verbleibende_zeit_der_hauptburste",
            "130.8",
            "flur",
            friendly_name="Roborock S8 Verbleibende Zeit der Hauptbürste",
            unit_of_measurement="h",
            device_class="duration",
        ),
        s(
            "sensor.roborock_s8_verbleibende_zeit_der_seitenburste",
            "194.5",
            "flur",
            friendly_name="Roborock S8 Verbleibende Zeit der Seitenbürste",
            unit_of_measurement="h",
            device_class="duration",
        ),
        s(
            "sensor.roborock_s8_verbleibende_filterzeit",
            "131.9",
            "flur",
            friendly_name="Roborock S8 Verbleibende Filterzeit",
            unit_of_measurement="h",
            device_class="duration",
        ),
        s(
            "sensor.roborock_s8_verbleibende_sensorzeit",
            "4.5",
            "flur",
            friendly_name="Roborock S8 Verbleibende Sensorzeit",
            unit_of_measurement="h",
            device_class="duration",
        ),
        s(
            "sensor.badezimmer_dominiks_zahnburste_dauer",
            "0",
            "badezimmer",
            friendly_name="Dominiks Zahnbürste Dauer",
            unit_of_measurement="s",
        ),
        # Shisha: Zähler und Kohle-Timer
        s("counter.smoked_shishas", "12", None, friendly_name="smoked Shishas", step=1, initial=0),
        s("counter.smoked_shishas_jahrlich", "386", None, friendly_name="smoked Shishas jährlich", step=1, initial=0),
        s(
            "counter.verbleibende_kohle",
            "33",
            None,
            friendly_name="Verbleibende Kohle",
            step=3,
            initial=54,
            minimum=0,
            maximum=54,
        ),
        s("counter.kohle", "1176", "balkon", friendly_name="Kohle", step=3, initial=0),
        s("input_boolean.kohle_stumm", "off", None, friendly_name="Kohle Stumm", icon="mdi:volume-off"),
        # Luftqualität Wohnzimmer (PM Klima, Wetterstation, Luftreiniger)
        s(
            "sensor.pm_wohnzimmer_luftqualitaet",
            "mittel",
            None,
            friendly_name="Wohnzimmer Luft Qualität",
            device_class="enum",
            co2=1171.0,
            pm25=1.0,
            feuchte_innen=62.6,
            taupunkt=15.5,
            lueften_noetig=True,
            gruende=["CO₂ erhöht (1171 ppm)", "Schimmelwarnung (Wand 70 %)"],
        ),
        s(
            "sensor.wetterstation_kohlendioxid",
            "1171",
            "wohnzimmer",
            friendly_name="Wetterstation Kohlendioxid",
            device_class="carbon_dioxide",
            unit_of_measurement="ppm",
        ),
        s(
            "sensor.wohnzimmer_luftreiniger_wohnzimmer_feinstaub_pm2_5",
            "2",
            "wohnzimmer",
            friendly_name="Luftreiniger Feinstaub PM2.5",
            device_class="pm25",
            unit_of_measurement="µg/m³",
        ),
        s(
            "sensor.wohnzimmer_luftreiniger_wohnzimmer_allergen_index",
            "1",
            "wohnzimmer",
            friendly_name="Luftreiniger Allergen-Index",
        ),
        # Büro: Server-Hauptschalter mit Freigabe, Wake on LAN
        s("switch.buro_buro", "on", "buro", friendly_name="Main Switch Server", icon="mdi:server"),
        s("input_boolean.burostrom_schaltfreigabe", "off", "buro", friendly_name="Bürostrom Schaltfreigabe"),
        s("timer.burostrom_schaltfreigabe", "idle", "buro", friendly_name="Bürostrom Schaltfreigabe"),
        s("button.buro_wol_main_pc", "unknown", "buro", friendly_name="Main PC starten", icon="mdi:desktop-tower-monitor"),
        s("binary_sensor.panel_tabeltop_nextion_display", "unavailable", None, friendly_name="Panel Tabletop Display"),
        s("sensor.panel_tabeltop_temperatur", "unavailable", None, friendly_name="Panel Tabletop Temperatur"),
    ]


# Geräte für den Systemzustand: Entitäts-ID -> Geräte-ID
GERAETE = {
    "binary_sensor.panel_tabeltop_nextion_display": ("dev_tabletop", "Panel Tabletop"),
    "sensor.panel_tabeltop_temperatur": ("dev_tabletop", "Panel Tabletop"),
    "vacuum.roborock_s8": ("dev_robo", "Roborock S8"),
    "sensor.roborock_s8_status": ("dev_robo", "Roborock S8"),
    "sensor.wohnzimmer_luftreiniger_wohnzimmer_filterwechsel": ("dev_luft", "Luftreiniger Wohnzimmer"),
}
REOLINK_CAM = "media-source://reolink/CAM|abc|0"
REOLINK_SUB = "media-source://reolink/RES|abc|0|sub"
REOLINK_TAG = "media-source://reolink/DAY|abc|0|sub|2026|10|2"
REOLINK_DATEI = "media-source://reolink/FILE|abc|0|sub|1-0-0126|20261002111611|20261002111701"
VIDEO = bytes(range(256)) * 40


class FakeHA:
    def __init__(self, snapshot: str | None = None) -> None:
        jetzt = datetime.now(UTC)
        self.states: dict[str, dict[str, Any]] = {}
        self.area_of: dict[str, str | None] = {}
        self.areas = [(a, n, i, "eg") for a, n, i in AREAS]
        self.floors = [{"floor_id": "eg", "name": "Erdgeschoss", "level": 0}]
        self.geraete = dict(GERAETE)
        self.versteckt: set[str] = set()
        if snapshot:
            self._snapshot_laden(snapshot)
        else:
            for st in default_states(jetzt):
                area = st.pop("_area")
                st["last_changed"] = st["last_updated"] = _iso(jetzt - timedelta(minutes=12))
                self.states[st["entity_id"]] = st
                self.area_of[st["entity_id"]] = area
        self._router(jetzt)

    def _snapshot_laden(self, pfad: str) -> None:
        """Vorschau mit echten Daten: JSON {areas: [[id, name]], floors: [...], states: [{e, s, a, b, d, lc}]}."""
        with open(pfad, encoding="utf-8") as f:
            snap = json.load(f)
        self.areas = [(a[0], a[1], a[2] if len(a) > 2 else None, a[3] if len(a) > 3 else None) for a in snap["areas"]]
        self.floors = snap.get("floors", [])
        self.geraete = {}
        for x in snap["states"]:
            self.states[x["e"]] = {
                "entity_id": x["e"],
                "state": x["s"],
                "attributes": x.get("a") or {},
                "last_changed": x.get("lc"),
                "last_updated": x.get("lc"),
            }
            self.area_of[x["e"]] = x.get("b")
            if x.get("h"):
                self.versteckt.add(x["e"])
            if x.get("d"):
                self.geraete[x["e"]] = (x["d"], snap.get("devices", {}).get(x["d"]) or (x.get("a") or {}).get("friendly_name"))

    def _router(self, jetzt: datetime) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self._tasks: set = set()
        self.meldungen = {
            "n1": {
                "notification_id": "n1",
                "title": "Neue Geräte gefunden",
                "message": "2 neue Geräte",
                "created_at": _iso(jetzt),
            }
        }
        self.subs: list[tuple[web.WebSocketResponse, int, str]] = []
        self.todo = {
            "todo.einkaufsliste": [
                {"uid": "1", "summary": "Kaffee", "status": "needs_action"},
                {"uid": "2", "summary": "Milch", "status": "needs_action"},
            ]
        }
        self.app = web.Application()
        r = self.app.router
        r.add_get("/core/api/states", self.rest_states)
        r.add_get("/core/api/config", self.rest_config)
        r.add_post("/core/api/services/{domain}/{service}", self.rest_service)
        r.add_get("/core/api/camera_proxy/{eid}", self.rest_camera)
        r.add_get("/core/api/camera_proxy_stream/{eid}", self.rest_camera_stream)
        r.add_get("/core/api/hls/{token}/{datei}", self.rest_hls)
        r.add_get("/core/api/calendars/{eid}", self.rest_calendar)
        r.add_get("/core/api/reolink/video/{rest:.+}", self.rest_video)
        r.add_get("/core/api/logbook/{start}", self.rest_logbook)
        r.add_get("/core/websocket", self.ws)

    def _auth(self, request: web.Request) -> None:
        if request.headers.get("Authorization") != f"Bearer {TOKEN}":
            raise web.HTTPUnauthorized()

    async def rest_states(self, request):
        self._auth(request)
        return web.json_response(list(self.states.values()))

    async def rest_config(self, request):
        self._auth(request)
        return web.json_response({"location_name": "Zuhause", "time_zone": "Europe/Berlin", "unit_system": {"temperature": "°C"}})

    async def rest_camera(self, request):
        self._auth(request)
        return web.Response(body=PNG_1PX, content_type="image/png")

    async def rest_camera_stream(self, request):
        self._auth(request)
        resp = web.StreamResponse(headers={"Content-Type": "multipart/x-mixed-replace;boundary=frame"})
        await resp.prepare(request)
        for _ in range(3):
            await resp.write(b"--frame\r\nContent-Type: image/png\r\n\r\n" + PNG_1PX + b"\r\n")
            await asyncio.sleep(0.05)
        return resp

    async def rest_hls(self, request):
        self._auth(request)
        if request.match_info["datei"].endswith(".m3u8"):
            return web.Response(text="#EXTM3U\n#EXT-X-VERSION:3\nsegment0.ts\n", content_type="application/vnd.apple.mpegurl")
        return web.Response(body=b"\x47" * 188, content_type="video/mp2t")

    async def rest_video(self, request):
        # Signierter Pfad wie bei HA: authSig im Query, Range-Anfragen für das Spulen
        if request.query.get("authSig") != "sig":
            raise web.HTTPUnauthorized()
        rng = request.headers.get("Range", "")
        if rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            a, b = int(a), int(b or len(VIDEO) - 1)
            return web.Response(
                status=206,
                body=VIDEO[a : b + 1],
                content_type="video/mp4",
                headers={"Content-Range": f"bytes {a}-{b}/{len(VIDEO)}", "Accept-Ranges": "bytes"},
            )
        return web.Response(body=VIDEO, content_type="video/mp4", headers={"Accept-Ranges": "bytes"})

    async def rest_calendar(self, request):
        self._auth(request)
        heute = datetime.now(UTC).replace(hour=16, minute=30, second=0, microsecond=0)
        return web.json_response(
            [
                {
                    "summary": "Zahnarzt",
                    "start": {"dateTime": heute.isoformat()},
                    "end": {"dateTime": (heute + timedelta(hours=1)).isoformat()},
                }
            ]
        )

    async def rest_logbook(self, request):
        self._auth(request)
        return web.json_response(
            [
                {
                    "when": _iso(datetime.now(UTC) - timedelta(minutes=5)),
                    "name": "Flur Deckenlampe",
                    "message": "eingeschaltet",
                    "entity_id": "light.flur_deckenlampe_flur",
                }
            ]
        )

    async def rest_service(self, request):
        self._auth(request)
        data = await request.json()
        self.service(request.match_info["domain"], request.match_info["service"], data)
        return web.json_response([])

    # ------------------------------------------------------------------ Zustände ändern
    def set_state(self, eid: str, state: str, **attrs) -> None:
        alt = copy.deepcopy(self.states.get(eid))
        neu = copy.deepcopy(alt) if alt else {"entity_id": eid, "attributes": {}}
        neu["state"] = state
        neu["attributes"].update(attrs)
        neu["last_changed"] = neu["last_updated"] = _iso(datetime.now(UTC))
        self.states[eid] = neu
        event = {"event_type": "state_changed", "data": {"entity_id": eid, "old_state": alt, "new_state": neu}}
        for ws, sid, typ in list(self.subs):
            if typ == "state_changed" and not ws.closed:
                self._tasks.add(asyncio.ensure_future(ws.send_json({"id": sid, "type": "event", "event": event})))

    def service(self, domain: str, service: str, data: dict) -> Any:
        self.calls.append((domain, service, data))
        event = {"event_type": "call_service", "data": {"domain": domain, "service": service, "service_data": data}}
        for ws, sid, typ in list(self.subs):
            if typ == "call_service" and not ws.closed:
                self._tasks.add(asyncio.ensure_future(ws.send_json({"id": sid, "type": "event", "event": event})))
        ids = data.get("entity_id") or []
        ids = [ids] if isinstance(ids, str) else ids
        for eid in ids:
            st = self.states.get(eid)
            if not st:
                continue
            if service == "toggle":
                self.set_state(eid, "off" if st["state"] == "on" else "on")
            elif service == "turn_on":
                attrs = {}
                if "brightness_pct" in data:
                    attrs["brightness"] = round(data["brightness_pct"] * 2.55)
                self.set_state(eid, "on", **attrs)
            elif service == "turn_off":
                self.set_state(eid, "off")
            elif domain == "counter" and service in ("increment", "decrement", "reset"):
                a = st["attributes"]
                n = int(st["state"]) + {"increment": 1, "decrement": -1, "reset": 0}[service] * int(a.get("step", 1))
                n = (
                    a.get("initial", 0)
                    if service == "reset"
                    else max(a.get("minimum", -(10**9)), min(a.get("maximum", 10**9), n))
                )
                self.set_state(eid, str(n), **a)
            elif domain == "lock" and service in ("lock", "unlock", "open"):
                self.set_state(eid, "locked" if service == "lock" else "unlocked")
        if domain == "weather" and service == "get_forecasts":
            heute = datetime.now(UTC)
            return {
                "weather.dwd_zuhause": {
                    "forecast": [
                        {
                            "datetime": _iso(heute + timedelta(days=i)),
                            "condition": c,
                            "temperature": t,
                            "templow": t - 7,
                            "precipitation_probability": p,
                        }
                        for i, (c, t, p) in enumerate(
                            [("rainy", 18, 70), ("partlycloudy", 19, 20), ("sunny", 21, 5), ("cloudy", 16, 40)]
                        )
                    ]
                }
            }
        return None

    # ------------------------------------------------------------------ WebSocket
    async def ws(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required"})
        msg = await ws.receive_json()
        if msg.get("access_token") != TOKEN:
            await ws.send_json({"type": "auth_invalid"})
            await ws.close()
            return ws
        await ws.send_json({"type": "auth_ok", "ha_version": "2026.9.3"})
        async for m in ws:
            if m.type != WSMsgType.TEXT:
                continue
            req = json.loads(m.data)
            await ws.send_json(self.ws_antwort(ws, req))
        self.subs = [s for s in self.subs if s[0] is not ws]
        return ws

    def ws_antwort(self, ws, req: dict) -> dict:
        typ, mid = req.get("type"), req.get("id")
        ok = lambda result: {"id": mid, "type": "result", "success": True, "result": result}  # noqa: E731
        if typ == "subscribe_events":
            self.subs.append((ws, mid, req.get("event_type")))
            return ok(None)
        if typ == "config/area_registry/list":
            return ok([{"area_id": a, "name": n, "icon": i, "floor_id": f} for a, n, i, f in self.areas])
        if typ == "config/floor_registry/list":
            return ok(self.floors)
        if typ == "config/device_registry/list":
            return ok([{"id": d, "name": n, "area_id": None} for d, n in dict(self.geraete.values()).items()])
        if typ == "config/entity_registry/list_for_display":
            ents = [
                {
                    "ei": e,
                    "ai": a,
                    **({"pl": "music_assistant"} if e == "media_player.wohnung_3" else {}),
                    **({"di": self.geraete[e][0]} if e in self.geraete else {}),
                    **({"hb": "user"} if e in self.versteckt else {}),
                }
                for e, a in self.area_of.items()
            ]
            return ok({"entities": ents, "entity_categories": {}})
        if typ == "persistent_notification/subscribe":
            event = {"type": "current", "notifications": self.meldungen}
            loop = asyncio.get_running_loop()
            loop.call_soon(
                lambda: self._tasks.add(asyncio.ensure_future(ws.send_json({"id": mid, "type": "event", "event": event})))
            )
            return ok(None)
        if typ == "call_service":
            res = self.service(req["domain"], req["service"], req.get("service_data") or {})
            return ok({"context": {}, "response": res})
        if typ == "camera/stream":
            return ok(
                {"url": f"/api/hls/tok123/master_playlist.m3u8?{req['entity_id']}"[: len("/api/hls/tok123/master_playlist.m3u8")]}
            )
        if typ == "media_source/browse_media":
            mid_ = req["media_content_id"]
            kind = lambda i, t, k="channel": {"media_content_id": i, "title": t, "media_class": k}  # noqa: E731
            baum = {
                "media-source://reolink": [{**kind(REOLINK_CAM, "Wohnungstuer"), "thumbnail": "/api/camera_proxy/camera.x"}],
                REOLINK_CAM: [kind(REOLINK_SUB, "Low resolution"), kind(REOLINK_SUB.replace("|sub", "|main"), "High resolution")],
                REOLINK_SUB: [kind(REOLINK_TAG[:-1] + "1", "2026/10/1"), kind(REOLINK_TAG, "2026/10/2")],
                REOLINK_TAG: [
                    kind(REOLINK_DATEI, "11:16:11 0:00:50 Person", "video"),
                    kind(REOLINK_DATEI + "x", "11:42:56 0:00:11 Motion", "video"),
                ],
            }
            return ok({"title": "x", "children": baum.get(mid_, [])})
        if typ == "media_source/resolve_media":
            if not req["media_content_id"].startswith("media-source://reolink/FILE|"):
                return {"id": mid, "type": "result", "success": False, "error": {"code": "x", "message": "unbekannt"}}
            return ok({"url": "/api/reolink/video/abc/0/sub/datei.mp4?authSig=sig", "mime_type": "video/mp4"})
        if typ == "energy/get_prefs":
            return ok(
                {
                    "energy_sources": [{"type": "water", "stat_energy_from": "sensor.warmwasser"}],
                    "device_consumption": [
                        {"stat_consumption": "sensor.buro_energie", "stat_rate": "sensor.buro_buro_leistung", "name": "Büro"},
                        {
                            "stat_consumption": "sensor.kohle_energie",
                            "name": "Kohlegrill",
                            "included_in_stat": "sensor.buro_energie",
                        },
                        {"stat_consumption": "sensor.flur_energie", "name": "Flur Deckenlampe"},
                    ],
                }
            )
        if typ == "recorder/statistics_during_period":
            start = datetime.fromisoformat(req["start_time"]).timestamp() * 1000
            schritt = 3600e3 if req.get("period") == "hour" else 86400e3
            faktor = {
                "sensor.buro_energie": 0.3,
                "sensor.kohle_energie": 0.08,
                "sensor.flur_energie": 0.02,
                "sensor.warmwasser": 0.01,
            }
            return ok(
                {
                    sid: [
                        {
                            "start": start + i * schritt,
                            "end": start + (i + 1) * schritt,
                            "change": round(faktor.get(sid, 0.1) * (1 + math.sin(i / 3)), 3),
                        }
                        for i in range(17)
                    ]
                    for sid in req["statistic_ids"]
                }
            )
        if typ == "todo/item/list":
            return ok({"items": self.todo.get(req.get("entity_id"), [])})
        if typ == "history/history_during_period":
            eid = req["entity_ids"][0]
            start = datetime.fromisoformat(req["start_time"]).timestamp()
            if eid.startswith("climate."):  # Heizphasen: 5–7 Uhr und 17–18 Uhr nach Beginn
                return ok(
                    {
                        eid: [
                            {
                                "s": "heat",
                                "a": {
                                    "hvac_action": "heating" if 5 <= i < 7 or 17 <= i < 18 else "idle",
                                    "current_temperature": round(20 + math.sin(i / 4), 1),
                                },
                                "lu": start + i * 3600,
                            }
                            for i in range(24)
                        ]
                    }
                )
            return ok({eid: [{"s": str(round(300 + 120 * math.sin(i / 6), 1)), "lu": start + i * 1800} for i in range(48)]})
        return {
            "id": mid,
            "type": "result",
            "success": False,
            "error": {"code": "unknown_command", "message": f"Unbekannt: {typ}"},
        }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8123)
    args = ap.parse_args()
    web.run_app(FakeHA().app, port=args.port)


if __name__ == "__main__":
    main()
