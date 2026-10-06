"""Karten für das Karussell: Hinweise und laufende Aktivitäten (mit Ringtimer).

Hinweise entstehen auf zwei Wegen: automatisch aus den Zuständen im Haus (``auto_hinweise``: offene Türen und
Fenster, Rauch- und Wasseralarm, schwache Batterien, Solarbank-Akku, Updates) und optional aus einem eigenen Sensor
mit dem Attribut ``zeilen``. Aktivitäten (Waschmaschine, Trockner, Saugroboter, Musik) werden aus den
Gerätezuständen berechnet.

Eine Karte ist ein Dict:
  id         stabiler Schlüssel (Rotation hält die Position, solange die ID bleibt)
  art        ``hinweis`` | ``aktivitaet``
  schluessel Symbol- und Farbklasse (``eil``, ``warnung``, ``offen``, ``waesche`` …)
  titel, wert, hinweis  Texte
  ring       Anteil 0..1 oder None (kein Ring)
  ende       ISO-Zeitpunkt, bis zu dem der Wert herunterzählt (der Client zählt lokal), sonst None
  dauer_s    Gesamtdauer in Sekunden für den Ring beim lokalen Herunterzählen, sonst None
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

State = dict[str, Any]
States = dict[str, State]

INAKTIV = ("unknown", "unavailable", "", None)

QUELLEN = {
    # Waschmaschine (Miele) im Keller
    "waesche_status": "sensor.waschmaschine_status",
    "waesche_phase": "sensor.waschmaschine_programmabschnitt",
    "waesche_rest": "sensor.waschmaschine_verbleibende_zeit",
    "waesche_programm": "sensor.waschmaschine_programm",
    # Trockner hängt an einer Meross-Steckdose: läuft, solange er Leistung zieht
    "trockner_leistung": "sensor.smart_switch_24031581622418510808c4e7ae00037b_power",
    # Saugroboter (Roborock S8 MaxV Ultra)
    "robo_status": "sensor.s8_maxv_ultra_status",
    "robo_fortschritt": "sensor.s8_maxv_ultra_reinigungsfortschritt",
    "robo_raum": "sensor.s8_maxv_ultra_aktueller_raum",
    # Für die automatischen Hinweise
    "offen": "sensor.keller_shc40b925_offene_turen_fenster",
    "solar_akku": "sensor.solarbank_2_e1600_pro_ladestand",
}

TROCKNER_AN_W = 8.0
WAESCHE_LAEUFT = ("in_use", "running", "programmed", "waiting_to_start", "pause", "rinse_hold")
WAESCHE_FERTIG = ("program_ended", "end_programmed", "finished", "end")

VORRANG = ("eil", "warnung", "offen")
MAX_HINWEISE = 8


def _state(states: States, eid: str) -> str | None:
    st = states.get(eid)
    return None if st is None else st.get("state")


def _attr(states: States, eid: str, key: str) -> Any:
    st = states.get(eid)
    return None if st is None else (st.get("attributes") or {}).get(key)


def _num(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_dauer(text: Any) -> float | None:
    """``H:MM:SS`` (auch mit Tagen ``1 day, 0:10:00``) in Sekunden."""
    if not isinstance(text, str) or ":" not in text:
        return None
    tage = 0
    if "day" in text:
        vorn, _, text = text.partition(",")
        tage = int(_num(vorn.split()[0]) or 0)
    teile = text.strip().split(":")
    try:
        werte = [float(t) for t in teile]
    except ValueError:
        return None
    while len(werte) < 3:
        werte.insert(0, 0.0)
    h, m, s = werte[-3:]
    return tage * 86400 + h * 3600 + m * 60 + s


def _parse_zeit(text: Any) -> datetime | None:
    if not isinstance(text, str) or len(text) < 10:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else None


def fmt_rest(sek: float | None) -> str:
    """Restzeit wie am Panel: unter einer Stunde ``m:ss``, sonst ``h:mm h``."""
    if sek is None:
        return "–"
    sek = max(0, round(sek))
    h, rest = divmod(sek, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d} h" if h else f"{m}:{s:02d}"


def _timer_karte(states: States, eid: str, kid: str, schluessel: str, titel: str, jetzt: datetime, laeuft: str) -> dict | None:
    zustand = _state(states, eid)
    if zustand not in ("active", "paused"):
        return None
    dauer = _parse_dauer(_attr(states, eid, "duration"))
    if zustand == "active":
        ende = _parse_zeit(_attr(states, eid, "finishes_at"))
        rest = (ende - jetzt).total_seconds() if ende else _parse_dauer(_attr(states, eid, "remaining"))
    else:
        ende = None
        rest = _parse_dauer(_attr(states, eid, "remaining"))
    ring = max(0.0, min(1.0, rest / dauer)) if (rest is not None and dauer) else None
    return {
        "id": kid,
        "art": "aktivitaet",
        "schluessel": schluessel,
        "titel": titel,
        "wert": fmt_rest(rest),
        "hinweis": laeuft if zustand == "active" else "pausiert",
        "ring": ring,
        "ende": ende.isoformat() if ende else None,
        "dauer_s": dauer if ende else None,
    }


def _rest_aus_sensor(states: States, eid: str, jetzt: datetime) -> tuple[float | None, datetime | None]:
    """Restzeit aus einem Sensor: Zeitstempel (device_class timestamp) oder Minuten."""
    roh = _state(states, eid)
    if roh in INAKTIV:
        return None, None
    ende = _parse_zeit(roh)
    if ende:
        return (ende - jetzt).total_seconds(), ende
    num = _num(roh)
    if num is None:
        return None, None
    einheit = str(_attr(states, eid, "unit_of_measurement") or "min").lower()
    sek = num * (3600 if einheit in ("h", "std") else 1 if einheit == "s" else 60)
    return sek, jetzt + timedelta(seconds=sek)


def akt_waesche(states: States, jetzt: datetime) -> dict | None:
    status = str(_state(states, QUELLEN["waesche_status"]) or "").lower()
    phase = _state(states, QUELLEN["waesche_phase"])
    if status not in WAESCHE_LAEUFT:
        return None
    rest, _ende = _rest_aus_sensor(states, QUELLEN["waesche_rest"], jetzt)
    programm = _state(states, QUELLEN["waesche_programm"])
    if status == "pause":
        hinweis = "pausiert"
    elif status in ("programmed", "waiting_to_start"):
        hinweis = "startet gleich"
    else:
        hinweis = str(phase) if phase not in INAKTIV else "läuft"
    return {
        "id": "akt:waesche",
        "art": "aktivitaet",
        "schluessel": "waesche",
        "titel": str(programm) if programm not in INAKTIV else "Waschmaschine",
        "wert": fmt_rest(rest),
        "hinweis": hinweis,
        "ring": None,
        "ende": None,  # geschätzte Restzeit: Minuten, kein sekundengenauer Ring
        "dauer_s": None,
    }


def akt_trockner(states: States, jetzt: datetime) -> dict | None:
    watt = _num(_state(states, QUELLEN["trockner_leistung"]))
    if watt is None or watt < TROCKNER_AN_W:
        return None
    return {
        "id": "akt:trockner",
        "art": "aktivitaet",
        "schluessel": "trockner",
        "titel": "Trockner",
        "wert": f"{round(watt)} W",
        "hinweis": "läuft",
        "ring": None,
        "ende": None,
        "dauer_s": None,
    }


def robo_aktiv(status: str | None) -> bool:
    s = str(status or "")
    return s == "cleaning" or s.endswith(("_cleaning", "_mopping"))


def akt_robo(states: States, jetzt: datetime) -> dict | None:
    if not robo_aktiv(_state(states, QUELLEN["robo_status"])):
        return None
    pct = _num(_state(states, QUELLEN["robo_fortschritt"]))
    raum = _state(states, QUELLEN["robo_raum"])
    return {
        "id": "akt:robo",
        "art": "aktivitaet",
        "schluessel": "robo",
        "titel": "Saugroboter",
        "wert": f"{round(pct)} %" if pct is not None else "–",
        "hinweis": str(raum) if raum not in INAKTIV else "saugt",
        "ring": (pct / 100) if pct is not None else None,
        "ende": None,
        "dauer_s": None,
    }


AKTIVITAETEN = (akt_waesche, akt_trockner, akt_robo)
MAX_MUSIK = 2


def akt_musik(states: States, jetzt: datetime, player: list[str]) -> list[dict]:
    """Laufende Wiedergabe der Music-Assistant-Player; gleiche Titel (Gruppen) nur einmal."""
    out: list[dict] = []
    gesehen: set[tuple] = set()
    for eid in player:
        st = states.get(eid) or {}
        if st.get("state") != "playing":
            continue
        a = st.get("attributes") or {}
        titel = a.get("media_title") or "Wiedergabe"
        schluessel = (titel, a.get("media_artist"))
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        dauer, pos = _num(a.get("media_duration")), _num(a.get("media_position"))
        stand = _parse_zeit(a.get("media_position_updated_at"))
        ende = None
        if dauer and pos is not None and stand:
            ende = stand + timedelta(seconds=max(0.0, dauer - pos))
        rest = (ende - jetzt).total_seconds() if ende else None
        out.append(
            {
                "id": f"akt:musik:{eid}",
                "art": "aktivitaet",
                "schluessel": "musik",
                "titel": str(titel),
                "wert": fmt_rest(rest) if rest is not None else "♪",
                "hinweis": "noch" if rest is not None else "spielt",
                "unter": " · ".join(str(x) for x in (a.get("media_artist"), a.get("friendly_name")) if x),
                "ring": max(0.0, min(1.0, rest / dauer)) if (rest is not None and dauer) else None,
                "ende": ende.isoformat() if ende else None,
                "dauer_s": dauer if ende else None,
            }
        )
        if len(out) >= MAX_MUSIK:
            break
    return out


# ------------------------------------------------------------ Automatische Hinweise

# Batterien von Handys, Tablets und Speichern sind keine Wartungsfälle
BATTERIE_AUSNAHMEN = ("iphone", "ipad", "tablet", "samsung_tab", "watch", "solarbank", "system_eichners", "sonos", "s8_maxv")
BATTERIE_SCHWACH = 15
SOLAR_AKKU_NIEDRIG = 15


def _name(states: States, eid: str) -> str:
    return str(_attr(states, eid, "friendly_name") or eid.split(".", 1)[-1].replace("_", " "))


def _hinweis(schluessel: str, titel: str, wert: str, hinweis: str) -> dict:
    return {
        "id": f"auto:{schluessel}:{titel}",
        "art": "hinweis",
        "schluessel": schluessel,
        "titel": titel,
        "wert": wert,
        "hinweis": hinweis,
        "ring": None,
        "ende": None,
        "dauer_s": None,
    }


def _kurz(name: str) -> str:
    """„MK Eingangstür DG“ -> „Eingangstür DG“, „RM Lukas Rauch“ bleibt lesbar."""
    for vorsilbe in ("MK ", "RM ", "BM "):
        if name.startswith(vorsilbe):
            return name[len(vorsilbe) :]
    return name


def auto_hinweise(states: States) -> list[dict]:
    """Hinweiskarten aus dem Hauszustand: Eilmeldungen (Rauch, Wasser) zuerst, dann Warnungen und Infos."""
    out: list[dict] = []
    rauch, wasser, akkus = [], [], []
    for eid, st in states.items():
        if not eid.startswith(("binary_sensor.", "sensor.")):
            continue
        a = st.get("attributes") or {}
        dc = a.get("device_class")
        if eid.startswith("binary_sensor.") and st.get("state") == "on":
            if dc == "smoke":
                rauch.append(_kurz(_name(states, eid)))
            elif dc == "moisture":
                wasser.append(_kurz(_name(states, eid)))
        elif dc == "battery" and not any(x in eid for x in BATTERIE_AUSNAHMEN):
            wert = _num(st.get("state"))
            if wert is not None and wert < BATTERIE_SCHWACH:
                akkus.append((wert, _kurz(_name(states, eid).replace(" Batterie", "").replace(" Battery Percent", ""))))
    if rauch:
        out.append(_hinweis("eil", "Rauchalarm", "Rauch erkannt", ", ".join(sorted(rauch))))
    if wasser:
        out.append(_hinweis("eil", "Wasseralarm", "Wasser erkannt", ", ".join(sorted(wasser))))
    offen_eid = QUELLEN["offen"]
    n = int(_num(_state(states, offen_eid)) or 0)
    if n > 0:
        a = (states.get(offen_eid) or {}).get("attributes") or {}
        namen = [
            _kurz(str(x)) for x in [*(a.get("open_doors") or []), *(a.get("open_windows") or []), *(a.get("open_others") or [])]
        ]
        out.append(_hinweis("offen", "Offen", f"{n} {'Tür/Fenster' if n == 1 else 'Türen/Fenster'}", ", ".join(namen)))
    solar = _num(_state(states, QUELLEN["solar_akku"]))
    if solar is not None and solar < SOLAR_AKKU_NIEDRIG:
        out.append(_hinweis("akku", "Solarbank", f"{round(solar)} %", "Akku fast leer"))
    if akkus:
        akkus.sort()
        out.append(
            _hinweis(
                "akku",
                "Batterien",
                f"{len(akkus)} schwach" if len(akkus) > 1 else f"{round(akkus[0][0])} %",
                ", ".join(f"{name} {round(w)} %" for w, name in akkus[:4]),
            )
        )
    status = str(_state(states, QUELLEN["waesche_status"]) or "").lower()
    if status in WAESCHE_FERTIG:
        out.append(_hinweis("fertig", "Waschmaschine", "Fertig", "Wäsche ausräumen"))
    updates = [eid for eid, st in states.items() if eid.startswith("update.") and st.get("state") == "on"]
    if updates:
        titel = [str(_attr(states, e, "title") or _name(states, e)) for e in updates]
        out.append(_hinweis("update", "Updates", f"{len(updates)} verfügbar", ", ".join(titel[:3])))
    return out


def parse_hinweise(zeilen: Any) -> list[dict]:
    """``schluessel|Titel|Wert|Hinweis`` je Zeile; weitere ``|`` gehören zum Hinweis; höchstens 8; ``eil`` zuerst."""
    if not isinstance(zeilen, str):
        return []
    out: list[dict] = []
    for i, zeile in enumerate(zeilen.replace("\r", "").split("\n")):
        if not zeile.strip():
            continue
        teile = zeile.split("|", 3)
        teile += [""] * (4 - len(teile))
        schluessel = teile[0].strip().lower() or "neutral"
        out.append(
            {
                "id": f"hin:{schluessel}:{teile[1].strip()}" if schluessel != "eil" else "hin:eil",
                "art": "hinweis",
                "schluessel": schluessel,
                "titel": teile[1].strip(),
                "wert": teile[2].strip(),
                "hinweis": teile[3].strip(),
                "ring": None,
                "ende": None,
                "dauer_s": None,
                "_pos": i,
            }
        )
        if len(out) >= MAX_HINWEISE:
            break
    out.sort(key=lambda k: (k["schluessel"] != "eil", k["_pos"]))
    for k in out:
        del k["_pos"]
    return out


def berechne(
    states: States,
    hinweise_entitaet: str,
    jetzt: datetime,
    aus: list[str] | None = None,
    musik: list[str] | None = None,
    auto: bool = False,
) -> list[dict]:
    """Alle Karten in Anzeigereihenfolge: Eilmeldung und Warnung, dann Aktivitäten, dann übrige Hinweise."""
    aus = aus or []
    hinweise = auto_hinweise(states) if auto else []
    hinweise += parse_hinweise(_attr(states, hinweise_entitaet, "zeilen")) if hinweise_entitaet else []
    akt = [k for fn in AKTIVITAETEN if (k := fn(states, jetzt))] + akt_musik(states, jetzt, musik or [])
    vorn = [k for k in hinweise if k["schluessel"] in VORRANG]
    rest = [k for k in hinweise if k["schluessel"] not in VORRANG]
    return [k for k in (*vorn, *akt, *rest) if k["schluessel"] not in aus]


def relevante_entitaeten(hinweise_entitaet: str) -> set[str]:
    return {*QUELLEN.values(), *([hinweise_entitaet] if hinweise_entitaet else [])}
