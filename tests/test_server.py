import asyncio
import json

from panelstudio.hub import dienst_erlaubt


async def _init(ws):
    while True:
        m = json.loads((await ws.receive()).data)
        if m["typ"] == "init":
            return m


async def _warte_auf(ws, typ, bedingung=lambda m: True):
    for _ in range(50):
        m = json.loads((await asyncio.wait_for(ws.receive(), 3)).data)
        if m["typ"] == typ and bedingung(m):
            return m
    raise AssertionError(f"{typ} nicht erhalten")


async def test_panel_braucht_zugangsschluessel(panel, token):
    r = await panel.get("/")
    assert r.status == 403
    r = await panel.get("/?token=falsch")
    assert r.status == 403
    r = await panel.get(f"/?token={token[0]}", allow_redirects=False)
    assert r.status == 200 and "pmps_zugang" in r.cookies and "Haus Eichner" in await r.text()
    panel.session.cookie_jar.clear()
    panel.session.cookie_jar.update_cookies({"pmps_zugang": token[0]})
    r = await panel.get("/")
    assert r.status == 200 and "Haus Eichner" in await r.text()
    assert (await panel.get("/api/health")).status == 200


async def test_editor_und_einstellungen(ingress, hub):
    r = await ingress.get("/")
    assert r.status == 200 and "Haus Eichner" in await r.text() and "Panel einrichten" not in await r.text()
    r = await ingress.get("/einstellungen")
    assert r.status == 200 and "Panel einrichten" in await r.text()
    d = await (await ingress.get("/api/einstellungen")).json()
    assert d["verbunden"] and d["port"] == 8098 and len(d["token"]) > 10
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    r = await ingress.post("/api/einstellungen", json={"verweildauer_s": 15})
    assert (await r.json())["einstellungen"]["verweildauer_s"] == 15
    m = await _warte_auf(ws, "einstellungen")
    assert m["einstellungen"]["verweildauer_s"] == 15
    await ws.close()


async def test_init_enthaelt_zustaende_und_karten(ingress):
    ws = await ingress.ws_connect("/api/ws")
    m = await _init(ws)
    assert m["zustaende"]["light.flur_deckenlampe_flur"]["s"] == "on"
    assert m["registry"]["light.flur_deckenlampe_flur"]["b"] == "flur"
    schluessel = [k["schluessel"] for k in m["karten"]]
    assert schluessel[0] == "offen"  # offene Türen/Fenster stehen vor den Aktivitäten
    assert [k for k in schluessel if k in ("waesche", "trockner")] == ["waesche", "trockner"]
    assert "muell" in schluessel
    await ws.close()


async def test_dienst_und_diff(ingress, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    await ws.send_json(
        {"typ": "dienst", "id": 1, "domain": "light", "service": "toggle", "data": {"entity_id": "light.lichterkette"}}
    )
    a = await _warte_auf(ws, "antwort")
    assert a["ok"]
    d = await _warte_auf(ws, "diff", lambda m: "light.lichterkette" in m["zustaende"])
    assert d["zustaende"]["light.lichterkette"]["s"] == "on"
    await ws.send_json({"typ": "dienst", "id": 2, "domain": "hassio", "service": "host_reboot", "data": {}})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 2)
    assert not a["ok"] and "nicht erlaubt" in a["fehler"]
    await ws.send_json({"typ": "ws", "id": 3, "befehl": {"type": "config/auth/delete"}})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 3)
    assert not a["ok"]
    await ws.close()


def test_dienst_sperrliste():
    assert dienst_erlaubt("light", "turn_on")
    assert dienst_erlaubt("homeassistant", "toggle")
    assert not dienst_erlaubt("homeassistant", "restart")
    assert not dienst_erlaubt("shell_command", "x")


async def test_bild_nur_erlaubte_pfade(ingress):
    r = await ingress.get("/api/bild", params={"pfad": "/api/states"})
    assert r.status == 400
    r = await ingress.get("/api/bild", params={"pfad": "/api/camera_proxy/camera.wohnungstuer_standardauflosung"})
    assert r.status == 200 and r.content_type == "image/png"


async def test_ereignis_bei_person_an_der_tuer(ingress, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    fake.set_state("binary_sensor.wohnungstuer_person", "on")
    m = await _warte_auf(ws, "ereignis")
    assert m["aktiv"] and m["kamera"] == "camera.wohnungstuer_standardauflosung"
    await ws.send_json({"typ": "ereignis_ende", "id": 9})
    m = await _warte_auf(ws, "ereignis", lambda m: not m["aktiv"])
    await ws.close()


async def test_bewegung_weckt(hub, fake):
    hub.modus = "ruhe"
    hub.letzte_bewegung = 0
    fake.set_state("binary_sensor.bewegungsmelder_flur_1_bewegung", "on")
    for _ in range(40):
        if hub.modus == "wach":
            break
        await asyncio.sleep(0.05)
    assert hub.modus == "wach"


async def test_pm_klima_zugeordnet_und_musik_und_meldungen(ingress, hub):
    ws = await ingress.ws_connect("/api/ws")
    m = await _init(ws)
    assert m["registry"]["climate.pm_wohnzimmer"]["b"] == "wohnzimmer"
    assert "musik" in [k["schluessel"] for k in m["karten"]]
    if not m["meldungen"]:
        m = await _warte_auf(ws, "meldungen")
        assert m["liste"][0]["notification_id"] == "n1"
    else:
        assert m["meldungen"][0]["notification_id"] == "n1"
    await ws.close()


async def test_kamera_stream(ingress):
    r = await ingress.get("/api/kamera", params={"eid": "camera.wohnungstuer_standardauflosung"})
    assert r.status == 200
    assert r.headers["Content-Type"].startswith("multipart/x-mixed-replace")
    assert b"--frame" in await r.read()
    r = await ingress.get("/api/kamera", params={"eid": "light.flur"})
    assert r.status == 400


async def test_panel_meldung_und_popup_kommen_im_panel_an(ingress, fake, hub):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    hub.modus = "ruhe"
    fake.service(
        "script", "panel_meldung", {"tag": "kohle_fertig", "titel": "Kohle fertig", "text": "Fertig.", "prioritaet": "high"}
    )
    m = await _warte_auf(ws, "popups")
    assert m["neu"] == "msg:kohle_fertig"
    assert m["liste"][0]["prio"] == "high"
    assert hub.modus == "wach"  # hohe Priorität weckt
    fake.service("browser_mod", "popup", {"title": "Kohle fertig", "content": "Lang.", "tag": "kohle_fertig"})
    m = await _warte_auf(ws, "popups", lambda m: m["liste"] and m["liste"][0]["details"] == "Lang.")
    k = await _warte_auf(ws, "karten", lambda m: m["karten"][0]["art"] == "meldung")
    assert k["karten"][0]["titel"] == "Kohle fertig"
    fake.service("browser_mod", "close_popup", {"tag": "kohle_fertig"})
    m = await _warte_auf(ws, "popups", lambda m: not m["liste"])
    await ws.close()


async def test_livestream_hls(ingress):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    await ws.send_json({"typ": "kamera_stream", "id": 21, "entity_id": "camera.wohnungstuer_standardauflosung"})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 21)
    assert a["ok"] and a["ergebnis"] == "api/hls/tok123/master_playlist.m3u8"
    r = await ingress.get("/" + a["ergebnis"])
    assert r.status == 200 and "#EXTM3U" in await r.text()
    r = await ingress.get("/api/hls/tok123/segment0.ts")
    assert r.status == 200 and len(await r.read()) == 188
    await ws.send_json({"typ": "kamera_stream", "id": 22, "entity_id": "light.x"})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 22)
    assert not a["ok"]
    await ws.close()


async def test_kamera_popup_wird_overlay(ingress, fake, hub):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    fake.service(
        "browser_mod",
        "popup",
        {
            "title": "Person an der Tür",
            "content": {"type": "picture-entity", "entity": "camera.wohnungstuer_hochauflosung"},
            "tag": "tuer",
        },
    )
    m = await _warte_auf(ws, "ereignis")
    assert m["aktiv"] and m["kamera"] == "camera.wohnungstuer_hochauflosung" and m["titel"] == "Person an der Tür"
    assert hub.popups.liste() == []  # nicht zusätzlich als Meldung
    fake.service("browser_mod", "close_popup", {"tag": "tuer"})
    m = await _warte_auf(ws, "ereignis", lambda m: not m["aktiv"])
    await ws.close()


async def test_aufnahmen_und_video(ingress):
    ws = await ingress.ws_connect("/api/ws")
    init = await _init(ws)
    assert init["geraete"]["dev_tabletop"] == "Panel Tabletop"
    await ws.send_json({"typ": "aufnahmen", "id": 31})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 31)
    kam = a["ergebnis"]["kameras"][0]
    assert kam["titel"] == "Wohnungstuer" and kam["tage"][0]["titel"] == "2026/10/2"  # neuester Tag zuerst
    await ws.send_json({"typ": "aufnahmen", "id": 32, "tag": kam["tage"][0]["id"]})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 32)
    datei = a["ergebnis"]["aufnahmen"][0]
    assert datei["titel"].endswith("Person")
    await ws.send_json({"typ": "aufnahmen", "id": 33, "tag": "media-source://media_source/local"})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 33)
    assert not a["ok"]
    await ws.close()
    r = await ingress.get("/api/video", params={"id": datei["id"]})
    assert r.status == 200 and r.content_type == "video/mp4" and len(await r.read()) == 10240
    r = await ingress.get("/api/video", params={"id": datei["id"]}, headers={"Range": "bytes=100-199"})
    assert r.status == 206 and r.headers["Content-Range"] == "bytes 100-199/10240" and len(await r.read()) == 100
    r = await ingress.get("/api/video", params={"id": "media-source://media_source/local/x.mp4"})
    assert r.status == 400


async def test_server_schalter_nur_mit_freigabe(ingress, fake):
    ws = await ingress.ws_connect("/api/ws")
    await _init(ws)
    befehl = {"typ": "dienst", "domain": "switch", "service": "turn_off", "data": {"entity_id": ["switch.buro_buro"]}}
    await ws.send_json({**befehl, "id": 41})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 41)
    assert not a["ok"] and "Freigabe" in a["fehler"]
    await ws.send_json({**befehl, "id": 42, "domain": "homeassistant", "service": "turn_off"})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 42)
    assert not a["ok"]
    fake.set_state("input_boolean.burostrom_schaltfreigabe", "on")
    await _warte_auf(ws, "diff", lambda m: "input_boolean.burostrom_schaltfreigabe" in m["zustaende"])
    await ws.send_json({**befehl, "id": 43})
    a = await _warte_auf(ws, "antwort", lambda m: m["id"] == 43)
    assert a["ok"]
    await ws.close()
