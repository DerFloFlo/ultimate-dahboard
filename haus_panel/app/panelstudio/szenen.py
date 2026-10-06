"""Szenen: Nutzung (Aktivierungen der letzten 30 Tage nach Stunde) und Farben (aus der Szenen-Konfiguration).

Der Zustand einer Szene ist der Zeitpunkt ihrer letzten Aktivierung. Jeder neue Zeitpunkt im Verlauf ist also eine
Aktivierung. Die Farben stammen aus ``config/scene/config/<id>`` (nur in HA angelegte Szenen); Szenen aus
Integrationen (z. B. Hue) haben dort keinen Eintrag und erhalten die neutrale Darstellung des Panels.
"""

from __future__ import annotations

import colorsys
import math
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

TAGE = 30


def _zeit(text: Any) -> datetime | None:
    if not isinstance(text, str) or len(text) < 19 or text[4] != "-":
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else None


def statistik_aus_verlauf(verlauf: dict[str, list[dict[str, Any]]], start: datetime, tz: ZoneInfo) -> dict[str, dict[str, Any]]:
    """``{scene: {"n": Anzahl, "h": [24 Zähler je Ortsstunde], "zuletzt": ISO}}`` aus ``history_during_period``."""
    out: dict[str, dict[str, Any]] = {}
    for eid, zeilen in (verlauf or {}).items():
        zeiten = set()
        for z in zeilen or []:
            dt = _zeit(z.get("s", z.get("state")))
            if dt and dt >= start:
                zeiten.add(dt)
        stunden = [0] * 24
        for dt in zeiten:
            stunden[dt.astimezone(tz).hour] += 1
        out[eid] = {"n": len(zeiten), "h": stunden, "zuletzt": max(zeiten).isoformat() if zeiten else None}
    return out


def _hex(r: float, g: float, b: float) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(max(0, min(255, round(x))) for x in (r, g, b)))


def _kelvin_rgb(k: float) -> tuple[float, float, float]:
    """Näherung der Lichtfarbe einer Farbtemperatur (Tanner Helland)."""
    t = max(1000.0, min(40000.0, k)) / 100
    r = 255 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    return r, g, b


def farbe_aus_licht(attr: dict[str, Any]) -> str | None:
    if str(attr.get("state", "on")) == "off":
        return None
    rgb = attr.get("rgb_color")
    if isinstance(rgb, list) and len(rgb) >= 3:
        return _hex(*rgb[:3])
    hs = attr.get("hs_color")
    if isinstance(hs, list) and len(hs) == 2:
        r, g, b = colorsys.hsv_to_rgb(float(hs[0]) / 360, float(hs[1]) / 100, 1.0)
        return _hex(r * 255, g * 255, b * 255)
    kelvin = attr.get("color_temp_kelvin")
    if kelvin is None and attr.get("color_temp"):
        kelvin = 1_000_000 / float(attr["color_temp"])
    if kelvin:
        return _hex(*_kelvin_rgb(float(kelvin)))
    return None


def farben_aus_konfig(konfig: dict[str, Any], max_farben: int = 2) -> list[str]:
    """Bis zu zwei unterschiedliche Lichtfarben einer Szene (Reihenfolge wie in der Szene)."""
    out: list[str] = []
    for eid, attr in (konfig.get("entities") or {}).items():
        if not str(eid).startswith("light.") or not isinstance(attr, dict):
            continue
        f = farbe_aus_licht(attr)
        if f and f not in out:
            out.append(f)
        if len(out) >= max_farben:
            break
    return out
