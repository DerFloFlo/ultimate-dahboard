import aiohttp
from aiohttp import web

from panelstudio.config import Options
from panelstudio.unifi import UnifiClient, abfrage, band, client_aufbereiten

STA = [
    {
        "mac": "aa:01",
        "name": "iPhone Flo",
        "is_wired": False,
        "signal": -48,
        "satisfaction": 98,
        "essid": "Eichner",
        "radio": "na",
        "channel": 44,
        "ap_mac": "ap:01",
        "ip": "192.168.20.50",
    },
    {
        "mac": "aa:02",
        "hostname": "steckdose-kueche",
        "is_wired": False,
        "signal": -79,
        "essid": "Eichner-IoT",
        "radio": "ng",
        "channel": 6,
        "ap_mac": "ap:02",
    },
    {"mac": "aa:03", "name": "NAS", "is_wired": True},
    {"mac": "aa:04", "name": "Alt", "is_wired": False, "rssi": 30, "channel": 11, "ap_mac": "ap:01"},
]
DEV = [
    {"mac": "ap:01", "type": "uap", "name": "AP Wohnzimmer OG"},
    {"mac": "ap:02", "type": "uap", "model": "U6-Lite"},
    {"mac": "gw", "type": "udm", "name": "Gateway"},
]


def test_aufbereiten_und_band():
    aps = {"ap:01": "AP Wohnzimmer OG"}
    g = client_aufbereiten(STA[0], aps)
    assert g["name"] == "iPhone Flo" and g["signal"] == -48 and g["band"] == "5 GHz" and g["ap"] == "AP Wohnzimmer OG"
    assert client_aufbereiten(STA[2], aps) is None  # kabelgebunden
    assert client_aufbereiten(STA[3], aps)["signal"] == -65  # nur rssi
    assert band("6e", None) == "6 GHz" and band(None, 1) == "2,4 GHz" and band(None, 100) == "5 GHz"


def test_optionen_passwort_verborgen():
    o = Options.from_dict({"unifi_adresse": "192.168.20.1", "unifi_benutzer": "ha", "unifi_passwort": "geheim"})
    assert o.unifi_aktiv and o.unifi_passwort == "geheim"
    assert o.public()["unifi_passwort"] == "••••"
    assert not Options.from_dict({}).unifi_aktiv


async def _controller(aiohttp_server, unifi_os=True, passwort="geheim"):
    pre = "/proxy/network" if unifi_os else ""

    async def login(req):
        d = await req.json()
        if d.get("password") != passwort:
            return web.json_response({"meta": {"rc": "error"}}, status=401)
        r = web.json_response({"ok": True}, headers={"X-CSRF-Token": "tok"})
        r.set_cookie("TOKEN", "abc")
        return r

    def geschuetzt(daten):
        async def h(req):
            if req.cookies.get("TOKEN") != "abc" or (unifi_os and req.headers.get("X-CSRF-Token") != "tok"):
                return web.json_response({}, status=401)
            return web.json_response({"data": daten})

        return h

    app = web.Application()
    app.router.add_post("/api/auth/login" if unifi_os else "/api/login", login)
    app.router.add_get(f"{pre}/api/s/default/stat/sta", geschuetzt(STA))
    app.router.add_get(f"{pre}/api/s/default/stat/device", geschuetzt(DEV))
    return await aiohttp_server(app)


async def test_unifi_os_abfrage(aiohttp_server):
    srv = await _controller(aiohttp_server)
    async with aiohttp.ClientSession() as s:
        res = await abfrage(UnifiClient(s, f"http://127.0.0.1:{srv.port}", "ha", "geheim"))
    assert res["fehler"] is None
    namen = [g["name"] for g in res["geraete"]]
    assert namen == ["steckdose-kueche", "Alt", "iPhone Flo"]  # schwächstes zuerst, ohne Kabel
    assert res["geraete"][0]["ap"] == "U6-Lite"


async def test_klassischer_controller(aiohttp_server):
    srv = await _controller(aiohttp_server, unifi_os=False)
    async with aiohttp.ClientSession() as s:
        res = await abfrage(UnifiClient(s, f"http://127.0.0.1:{srv.port}", "ha", "geheim"))
    assert res["fehler"] is None and len(res["geraete"]) == 3


async def test_falsches_passwort(aiohttp_server):
    srv = await _controller(aiohttp_server)
    async with aiohttp.ClientSession() as s:
        res = await abfrage(UnifiClient(s, f"http://127.0.0.1:{srv.port}", "ha", "falsch"))
    assert res["geraete"] == [] and "Anmeldung abgelehnt" in res["fehler"]
