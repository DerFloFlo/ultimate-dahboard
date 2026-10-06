from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from panelstudio.config import Einstellungen
from panelstudio.szenen import farbe_aus_licht, farben_aus_konfig, statistik_aus_verlauf

START = datetime(2026, 9, 1, tzinfo=UTC)
TZ = ZoneInfo("Europe/Berlin")


def test_statistik_zaehlt_aktivierungen_je_ortsstunde():
    a = (START + timedelta(days=2, hours=17)).isoformat()  # 19 Uhr Ortszeit (MESZ)
    b = (START + timedelta(days=3, hours=17)).isoformat()
    alt = (START - timedelta(days=1)).isoformat()
    verlauf = {"scene.ambiente": [{"s": alt, "lu": 0}, {"s": a}, {"s": a}, {"s": b}, {"s": "unknown"}]}
    st = statistik_aus_verlauf(verlauf, START, TZ)["scene.ambiente"]
    assert st["n"] == 2
    assert st["h"][19] == 2
    assert st["zuletzt"] == b.replace("+00:00", "+00:00")


def test_farben_aus_konfig():
    konfig = {
        "entities": {
            "light.a": {"state": "on", "rgb_color": [255, 0, 0]},
            "light.b": {"state": "off", "rgb_color": [0, 255, 0]},
            "switch.x": {"state": "on"},
            "light.c": {"state": "on", "hs_color": [240, 100]},
            "light.d": {"state": "on", "color_temp_kelvin": 2700},
        }
    }
    assert farben_aus_konfig(konfig) == ["#ff0000", "#0000ff"]
    warm = farbe_aus_licht({"state": "on", "color_temp_kelvin": 2700})
    assert warm.startswith("#ff")
    assert farbe_aus_licht({"state": "on", "brightness": 100}) is None


def test_einstellungen_szenen():
    e = Einstellungen()
    e.aktualisieren({"szenen_angeheftet": ["scene.a", "light.b", "scene.a"], "szenen_aus": "scene.c"})
    assert e.szenen_angeheftet == ["scene.a"]
    assert e.szenen_aus == ["scene.c"]
