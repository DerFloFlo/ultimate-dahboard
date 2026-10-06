# Haus Eichner Panel

Home-Assistant-App für Wandtablets (iPad, Samsung Tab): rotierende Hinweiskarten mit Ringtimern, Ruhe- und
Wachzustand über Bewegungsmelder, Kamera-Overlay bei Ereignissen und alle Funktionen des Hauses als Module
(Räume, Klima, Licht, Sicherheit, Medien, Listen, Energie, Wartung, Suche).

Angepasste Fassung der App „PM Panel Studio“ aus
[D0GC/pm-networks-ultimate-dashboard](https://github.com/D0GC/pm-networks-ultimate-dashboard) (MIT-Lizenz).

## Installation

1. Home Assistant → Einstellungen → Apps → App-Store → ⋮ → Repositories → `https://github.com/DerFloFlo/ultimate-dahboard`
   hinzufügen.
2. „Haus Eichner Panel“ installieren und starten. Die Optionen sind bereits auf das Haus eingestellt.
3. In der Seitenleiste „Haus Panel“ öffnen, die Panel-Adresse (mit Zugangsschlüssel) kopieren und einmal auf jedem
   Tablet öffnen. Danach merkt sich der Browser den Zugang.

## Was an das Haus angepasst ist

| Bereich | Einstellung |
|---------|-------------|
| Personen | `person.florian_eichner` (Begrüßung „Flo“) |
| Wetter | `weather.forecast_home` (Met.no) |
| Alarmanlage | `alarm_control_panel.intrusion_detection_system`, „Alarm Oma“ zusätzlich auf der Sicherheitsseite |
| Kamera-Ereignis | Person am Treppenaufgang → Kamera `camera.treppenaufgang_fliessend` im Vollbild |
| Panel wecken | Bewegungsmelder Treppenaufgang DG und Bad DG |
| Laufende Geräte | Waschmaschine (Miele), Trockner (Steckdose ab 8 W), Saugroboter S8 MaxV Ultra, Musik |
| Automatische Hinweise | offene Türen/Fenster (Bosch SHC), Rauch- und Wasseralarm, Batterien unter 15 %, Solarbank unter 15 %, Waschmaschine fertig, Updates |
| Schnellzugriff | Alarmanlage, Saugroboter, Wohnzimmer OG, Küchen-LED, Anwesenheitssimulation, Alle Lichter aus |
| Sicherheit | Rauchmelder-Übersicht je Etage mit Batterie und Testalarm |
| Wartung | Signalstärke der Geräte (WLAN, dBm, Bosch, Zigbee), schwächste zuerst |
| Ausgeblendet | Status-LEDs der Meross-Steckdosen, Einstellungsschalter (Kindersicherung, Voralarm, Sirene bei Ereignis …), Ventile, leere Bereiche |
| Entfernt | Shisha-Seite, Kohlegrill, Dusch-/Spa-Timer, Spülmaschine des Originals |

Alles Weitere (Module, Reihenfolge der Räume, Schnellzugriff, Kartentypen, Helligkeit) lässt sich im Editor in der
Seitenleiste ändern.

## Aufbau

| Pfad | Inhalt |
|------|--------|
| `haus_panel/` | App (Dockerfile, `config.yaml`, s6-Dienst) |
| `haus_panel/app/panelstudio/` | Python-Backend (aiohttp): HA-Anbindung, Hub, Karten-Engine, Server |
| `haus_panel/app/panelstudio/static/` | Panel-Oberfläche und Editor (ohne Build-Schritt) |
| `tests/` | Tests mit nachgebautem Home Assistant (`fake_ha.py`) |
| `tools/dev_server.py` | Vorschau ohne Home Assistant: Editor `http://127.0.0.1:8099/`, Panel `…/panel` |

## Entwicklung

```sh
pip install aiohttp==3.13.3 pytest pytest-aiohttp ruff
ruff check . && ruff format --check . && pytest -q
python tools/dev_server.py
```
