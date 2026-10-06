"""Gemeinsame Fixtures: Fake-HA, HA-Client, Hub und beide App-Varianten."""

from __future__ import annotations

import asyncio
import ipaddress
import sys
from pathlib import Path

import aiohttp
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "haus_panel" / "app"))
sys.path.insert(0, str(Path(__file__).parent))

from fake_ha import TOKEN, FakeHA  # noqa: E402
from panelstudio.config import EinstellungsSpeicher, Options  # noqa: E402
from panelstudio.ha_client import HAClient  # noqa: E402
from panelstudio.hub import Hub  # noqa: E402
from panelstudio.server import create_ingress_app, create_panel_app  # noqa: E402

LOCAL = [ipaddress.ip_network("127.0.0.0/8"), ipaddress.ip_network("::1/128")]

# Zuordnungen passend zum Test-HA (fake_ha.py); die Standardwerte der App gelten für das echte Haus
TEST_OPTIONEN = {
    "hinweise_entitaet": "sensor.panel_bad_hinweise",
    "auto_hinweise": False,
    "bewegung": ["binary_sensor.bewegungsmelder_flur_1_bewegung", "binary_sensor.bewegungsmelder_flur_2_bewegung"],
    "personen": ["person.dominik", "person.gina_perina"],
    "wetter_entitaet": "weather.dwd_zuhause",
    "aussentemperatur": "sensor.aussentemperatur",
    "alarm_entitaet": "alarm_control_panel.alarmo",
    "ereignis_ausloeser": ["binary_sensor.wohnungstuer_person"],
    "ereignis_kamera": "camera.wohnungstuer_standardauflosung",
    "tueroeffner": "button.haustur_tur_offnen",
    "klima_praefix": "climate.pm_",
}


@pytest.fixture
def fake() -> FakeHA:
    return FakeHA()


@pytest.fixture
async def hub(aiohttp_server, fake, tmp_path):
    server = await aiohttp_server(fake.app)
    async with aiohttp.ClientSession() as session:
        base = f"http://{server.host}:{server.port}/core"
        client = HAClient(session, api_url=f"{base}/api", ws_url=f"ws://{server.host}:{server.port}/core/websocket", token=TOKEN)
        h = Hub(Options.from_dict(TEST_OPTIONEN), client, EinstellungsSpeicher(tmp_path))
        h.einstellungen.freigaben = {"switch.buro_buro": "input_boolean.burostrom_schaltfreigabe"}
        h.start()
        for _ in range(100):
            if h.verbunden:
                break
            await asyncio.sleep(0.05)
        assert h.verbunden
        yield h
        await h.stop()
        await client.close()


@pytest.fixture
def token() -> list[str]:
    return ["geheimer-zugangsschluessel-123456"]


@pytest.fixture
async def ingress(aiohttp_client, hub, token):
    return await aiohttp_client(create_ingress_app(hub, token, LOCAL))


@pytest.fixture
async def panel(aiohttp_client, hub, token):
    return await aiohttp_client(create_panel_app(hub, token))
