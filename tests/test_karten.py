from datetime import UTC, datetime

from panelstudio import karten as kt

JETZT = datetime(2026, 10, 1, 14, 0, tzinfo=UTC)


def st(state, **attrs):
    return {"state": state, "attributes": attrs}


def test_hinweise_eil_zuerst_und_max_acht():
    zeilen = "muell|Müll|morgen|Bio\neil|ARD|Eilmeldung|Schlagzeile\n" + "\n".join(f"wetter|W{i}|x|y" for i in range(10))
    k = kt.parse_hinweise(zeilen)
    assert k[0]["schluessel"] == "eil"
    assert len(k) == 8
    assert k[1]["titel"] == "Müll"


def test_hinweis_felder_und_weitere_trenner():
    (k,) = kt.parse_hinweise("offen|Offen|2 offen|Tür | Fenster\r\n\n")
    assert (k["titel"], k["wert"], k["hinweis"]) == ("Offen", "2 offen", "Tür | Fenster")
    assert kt.parse_hinweise(None) == []


def test_waesche_miele_laeuft():
    states = {
        "sensor.waschmaschine_status": st("in_use"),
        "sensor.waschmaschine_programmabschnitt": st("Spülen"),
        "sensor.waschmaschine_programm": st("Baumwolle"),
        "sensor.waschmaschine_verbleibende_zeit": st("75", unit_of_measurement="min"),
    }
    k = kt.akt_waesche(states, JETZT)
    assert (k["titel"], k["wert"], k["hinweis"]) == ("Baumwolle", "1:15 h", "Spülen")
    assert kt.akt_waesche({"sensor.waschmaschine_status": st("off")}, JETZT) is None
    assert kt.akt_waesche({"sensor.waschmaschine_status": st("unavailable")}, JETZT) is None
    assert kt.akt_waesche({"sensor.waschmaschine_status": st("pause")}, JETZT)["hinweis"] == "pausiert"


def test_trockner_ueber_leistung():
    eid = kt.QUELLEN["trockner_leistung"]
    assert kt.akt_trockner({eid: st("3.2")}, JETZT) is None
    assert kt.akt_trockner({eid: st("unavailable")}, JETZT) is None
    assert kt.akt_trockner({eid: st("612.4")}, JETZT)["wert"] == "612 W"


def test_auto_hinweise():
    states = {
        "sensor.keller_shc40b925_offene_turen_fenster": st(
            "2", open_doors=["MK Eingangstür DG"], open_windows=["Dachflächen-Fenster DG"], open_others=[]
        ),
        "sensor.solarbank_2_e1600_pro_ladestand": st("10", device_class="battery"),
        "sensor.bm_treppenaufgang_dg_batterie": st("11", device_class="battery", friendly_name="BM Treppenaufgang DG Batterie"),
        "sensor.flo_ipad_pro_m4_2024_battery_level": st("5", device_class="battery"),
        "sensor.hue_motion_sensor_1_batterie": st("43", device_class="battery"),
        "binary_sensor.rm_lukas": st("on", device_class="smoke", friendly_name="RM Lukas"),
        "binary_sensor.wassermelder_kellerfenster": st("off", device_class="moisture"),
        "update.home_assistant_core_update": st("on", title="Home Assistant Core"),
        "sensor.waschmaschine_status": st("program_ended"),
    }
    k = kt.auto_hinweise(states)
    assert [x["schluessel"] for x in k] == ["eil", "offen", "akku", "akku", "fertig", "update"]
    assert k[0]["hinweis"] == "Lukas"
    assert k[1]["wert"] == "2 Türen/Fenster" and k[1]["hinweis"] == "Eingangstür DG, Dachflächen-Fenster DG"
    assert k[3]["titel"] == "Batterien" and k[3]["hinweis"] == "Treppenaufgang DG 11 %"  # iPad zählt nicht
    assert kt.auto_hinweise({}) == []


def test_roborock_nur_beim_reinigen():
    assert kt.robo_aktiv("segment_cleaning")
    assert kt.robo_aktiv("cleaning")
    assert not kt.robo_aktiv("returning_home")
    assert not kt.robo_aktiv("charging")


def test_reihenfolge_und_ausblenden():
    states = {
        "sensor.h": st("2", zeilen="muell|Müll|morgen|Bio\nwarnung|DWD|Sturm|ab 18 Uhr"),
        kt.QUELLEN["trockner_leistung"]: st("500"),
        kt.QUELLEN["offen"]: st("1", open_doors=["MK Kellertüre UG"]),
    }
    k = kt.berechne(states, "sensor.h", JETZT)
    assert [x["schluessel"] for x in k] == ["warnung", "trockner", "muell"]
    k = kt.berechne(states, "sensor.h", JETZT, aus=["muell"], auto=True)
    assert [x["schluessel"] for x in k] == ["offen", "warnung", "trockner"]


def test_fmt_rest():
    assert kt.fmt_rest(59) == "0:59"
    assert kt.fmt_rest(3700) == "1:01 h"
    assert kt.fmt_rest(None) == "–"


def test_musik_karte_gruppen_einmal():
    a = {
        "media_title": "Song",
        "media_artist": "Band",
        "media_duration": 200,
        "media_position": 50,
        "media_position_updated_at": JETZT.isoformat(),
        "friendly_name": "Wohnung",
    }
    states = {"media_player.a": st("playing", **a), "media_player.b": st("playing", **a), "media_player.c": st("idle")}
    (k,) = kt.akt_musik(states, JETZT, ["media_player.a", "media_player.b", "media_player.c"])
    assert k["titel"] == "Song"
    assert k["wert"] == "2:30"
    assert k["unter"] == "Band · Wohnung"
    assert abs(k["ring"] - 0.75) < 0.01
