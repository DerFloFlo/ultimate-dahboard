# Haus Eichner Panel

Wandpanel-Oberfläche für Tablets (iPad, Samsung Tab). Die App hält die Verbindung zu Home Assistant, berechnet
Karten und Zustände selbst und schickt dem Panel nur fertige Änderungen.

## Zugänge

| Zugang | Zweck |
|--------|-------|
| Seitenleiste „Haus Panel“ (Ingress) | Editor: Verhalten, Schnellzugriff, Module, Räume, Karten; Panel-Adresse; Vorschau |
| `http://<Home-Assistant>:8098/?token=…` | Das Wandpanel selbst. Der Schlüssel steht im Editor. Nach dem ersten Aufruf merkt sich der Browser den Zugang (Cookie) |

Der Zugangsschlüssel liegt in `/data/panel_token`. „Neuen Schlüssel erzeugen“ im Editor trennt alle Panels.

## Optionen

| Option | Bedeutung |
|--------|-----------|
| `auto_hinweise` | Hinweiskarten automatisch aus dem Hauszustand (siehe unten). Vorgabe an |
| `hinweise_entitaet` | Optional: Sensor mit Attribut `zeilen` für eigene Hinweiskarten. Vorgabe leer |
| `bewegung` | Bewegungsmelder, die das Panel wecken |
| `personen` | Personen auf der Startseite |
| `wetter_entitaet`, `aussentemperatur` | Wetter und große Temperaturanzeige |
| `alarm_entitaet` | Alarmanlage für die Statuszeile |
| `ereignis_ausloeser` | Wird eine dieser Entitäten „an“, erscheint die Kamera im Vollbild |
| `ereignis_kamera`, `tueroeffner` | Kamera und Türöffner im Overlay |
| `klima_praefix` | Optional: nur Thermostate mit diesem Präfix. Leer = alle Thermostate (Vorgabe) |

## Schutz am Panel

- Entriegeln, Öffnen und Türöffner lösen erst nach 2 Sekunden Halten aus; die Bedingung wird beim Drücken geprüft.
- Unscharf schalten nur nach 2 Sekunden Halten, mit Code, falls die Alarmanlage einen verlangt.
- Gesperrte Dienste am Panel: `hassio`, `recorder`, `backup`, `shell_command`, `rest_command`, `python_script`,
  `pyscript`, `logger`, `system_log`, `frontend`, `lovelace`, `cloud`, `ffmpeg`; bei `homeassistant` nur
  `turn_on`, `turn_off`, `toggle`, `update_entity`.
- Lesende Abfragen nur über eine feste Liste (To-dos, Verlauf, Logbuch, Kalender, Statistik).

## Kiosk auf den Tablets

- **iPad:** Panel-Adresse mit `?token=…` einmal in Safari öffnen, „Zum Home-Bildschirm“ hinzufügen und die
  Web-App starten. Mit „Geführter Zugriff“ (Einstellungen → Bedienungshilfen) bleibt das iPad im Panel.
  Automatische Sperre auf „Nie“ stellen; die App dunkelt selbst ab.
- **Samsung Tab:** Fully Kiosk Browser oder Chrome („Zum Startbildschirm hinzufügen“) mit der Panel-Adresse;
  Bildschirm-Timeout abschalten.
- Die Oberfläche skaliert mit der Bildschirmgröße und funktioniert quer und hoch.

## Meldungen

Das Panel zeigt Meldungen, die ein Skript `script.panel_meldung` auslöst, mit Symbol, Priorität und
Bestätigen/Später, sowie die Benachrichtigungen von Home Assistant (Glocke). Ein Browser-Mod-Popup mit gleicher Kennung liefert den
ausführlichen Text (etwa das Morgen-Briefing). Geschlossen wird mit `script.panel_meldung_schliessen` oder
`browser_mod.close_popup` derselben Kennung, sonst nach der Laufzeit. Im Editor abwählbar („Panel-Meldungen“).

## Automatische Hinweise

Mit `auto_hinweise: true` erzeugt die App die Hinweiskarten selbst aus dem Hauszustand: offene Türen und Fenster
(Bosch-Sensor „Offene Türen und Fenster“), Rauch- und Wasseralarm, Batterien unter 15 % (ohne Handys, Tablets und
Speicher), Solarbank-Akku unter 15 %, Waschmaschine fertig und verfügbare Updates. Eigene Karten kommen über
`hinweise_entitaet` dazu: ein Sensor mit dem Attribut `zeilen`, je Zeile `schluessel|Titel|Wert|Hinweis`.
Einzelne Kartentypen lassen sich im Editor ausblenden.
