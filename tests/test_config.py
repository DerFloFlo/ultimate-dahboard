from panelstudio.config import Einstellungen, EinstellungsSpeicher, Options


def test_optionen_filtern_ungueltige_entitaeten():
    o = Options.from_dict({"bewegung": ["binary_sensor.a", "kein text", "binary_sensor.a"], "ereignis_kamera": "x"})
    assert o.bewegung == ["binary_sensor.a"]
    assert o.ereignis_kamera == ""


def test_einstellungen_grenzen_und_abweisung():
    e = Einstellungen()
    ab = e.aktualisieren(
        {"verweildauer_s": 1, "ruhe_nach_s": "abc", "module": ["suche", "start", "quatsch", "licht"], "unbekannt": 1}
    )
    assert e.verweildauer_s == 3
    assert e.module == ["suche", "licht"]
    assert set(ab) == {"ruhe_nach_s", "unbekannt"}


def test_speicher_und_token(tmp_path):
    sp = EinstellungsSpeicher(tmp_path)
    e = sp.laden()
    e.verweildauer_s = 12
    sp.speichern(e)
    assert sp.laden().verweildauer_s == 12
    t1 = sp.token()
    assert len(t1) >= 24 and sp.token() == t1
    assert sp.token(neu=True) != t1


def test_ton_einstellungen():
    e = Einstellungen()
    assert e.ton_hoch and e.ton_lautstaerke == 70
    e.aktualisieren({"ton_hoch": False, "ton_lautstaerke": 500})
    assert e.ton_hoch is False and e.ton_lautstaerke == 100


def test_raum_schalter_und_wartung():
    e = Einstellungen()
    assert e.raum_schalter == {} and e.freigaben == {}
    assert e.wartung_ignorieren == [] and e.material_modus == "auto"
    assert e.aussen_feuchte[0] == "sensor.innen_hinterm_haus_humidity"
    # Die frühere Jarvis-Liste in gespeicherten Einstellungen wird still übergangen
    assert e.aktualisieren({"wartung_entitaeten": ["binary_sensor.x"]}) == []
    assert e.aktualisieren({"material_modus": "egal"}) == ["material_modus"]
    e.aktualisieren({"material_modus": "manuell", "material_fest": ["sensor.filter", "kein text"]})
    assert e.material_modus == "manuell" and e.material_fest == ["sensor.filter"]
    e.aktualisieren({"gruss": False, "gruss_anrede": {"person.gina_perina": "Gina", "licht.x": "Nein"}})
    assert e.gruss is False and e.gruss_anrede == {"person.gina_perina": "Gina"}
    e.aktualisieren(
        {"raum_schalter": {"wohnzimmer": ["input_boolean.gina_lernt", "kein text"], "Ungültig!": ["input_boolean.x"]}}
    )
    assert e.raum_schalter == {"wohnzimmer": ["input_boolean.gina_lernt"]}
    assert e.aktualisieren({"raum_schalter": "falsch"}) == ["raum_schalter"]


def test_standardwerte_fuer_das_haus():
    o = Options()
    assert o.personen == ["person.florian_eichner"]
    assert o.alarm_entitaet == "alarm_control_panel.intrusion_detection_system"
    assert o.klima_praefix == "" and o.hinweise_entitaet == "" and o.auto_hinweise is True
    assert Options.from_dict({"auto_hinweise": False}).auto_hinweise is False
    e = Einstellungen()
    assert "shisha" not in e.module and "wartung" in e.module
    assert e.bereiche_ausblenden == []
    assert e.start_raeume == ["wohnzimmer_og", "arbeitszimmer_dachgeschoss", "oma_zimmer_ug"]
    assert e.gruss_anrede == {"person.florian_eichner": "Flo"}


def test_unbekanntes_modul_aus_altem_stand_faellt_weg():
    alt = Einstellungen.from_dict({"module": ["raeume", "shisha", "suche"]})
    assert alt.module == ["raeume", "suche"]


def test_bereich_symbole_und_versteckte_entitaeten():
    from panelstudio.hub import VERSTECKT_RE, bereich_symbol

    assert bereich_symbol("flur_wohnung_eg", "Flur Wohnung EG") == "mdi:door"
    assert bereich_symbol("wohnzimmer_og", "Wohnzimmer OG") == "mdi:sofa"
    assert bereich_symbol("gastezimmer_dg", "Gästezimmer DG") == "mdi:bed-double"
    assert bereich_symbol("x", "Irgendwas") is None
    assert VERSTECKT_RE.match("light.smart_switch_24031583795964510808c4e7ae001e0c_dnd")
    assert VERSTECKT_RE.match("switch.thermostat_lukas_childlock")
    assert not VERSTECKT_RE.match("switch.kuchen_led")
    assert not VERSTECKT_RE.match("light.oma_zimmer_ug")
