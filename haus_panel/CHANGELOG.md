# Änderungen

## 1.2.0 – 2026-10-06

- Die Seitenleiste „Haus Panel“ öffnet jetzt direkt das Panel. Es läuft damit auch unterwegs in der
  Home-Assistant-App (Nabu Casa), bleibt dort immer wach und dunkelt nicht ab. Die Einstellungen liegen hinter dem
  Zahnrad unten links.
- Handy-Ansicht: Startseite einspaltig ohne seitliches Überlaufen, Modulleiste wischbar, Module (Räume, Licht,
  Sicherheit, Energie …) untereinander statt in drei Spalten.

## 1.1.2 – 2026-10-06

- Panel-Adresse auf dem iPad: Der Editor zeigt jetzt anklickbare Adressen mit der lokalen Adresse von Home
  Assistant statt des Hostnamens, unter dem der Editor geöffnet wurde (über Nabu Casa ergab das eine Adresse, die
  im Heimnetz nicht erreichbar ist). „Kopieren“ funktioniert auch in Safari ohne HTTPS.
- Der Zugangsschlüssel öffnet das Panel direkt statt über eine Weiterleitung. Safari behält damit den Zugang, und
  ein Lesezeichen auf dem Home-Bildschirm funktioniert dauerhaft.

## 1.1.1 – 2026-10-06

- Die doppelten, leeren Bereiche „Gästezimmer Dachgeschoss“, „Küche“ und „Wohnzimmer“ sind in Home Assistant
  aufgelöst; das Panel blendet deshalb standardmäßig keine Bereiche mehr aus.

## 1.1.0 – 2026-10-06

- Sicherheit: neue Box „Rauchmelder“ mit Gesamtzustand (Ring), auffälligen Meldern (Rauch, nicht erreichbar,
  Batterie schwach) und der Unterseite „Alle Rauchmelder“: je Etage alle Melder mit Raum, Batteriezustand und
  Testalarm (Glocke 2 Sekunden halten).
- Wartung: neue Box „Signalstärke“, schwächste Geräte zuerst: WLAN in Prozent (Meross), dBm (Shelly u. a.),
  Kommunikationsqualität (Bosch) und Zigbee-Linkqualität; „Alle Geräte“ öffnet die vollständige Liste.
- Startseite: Arbeitszimmer DG statt des aufgelösten Bereichs „Arbeitszimmer“.

## 1.0.0 – 2026-10-06

Erste Fassung für Haus Eichner, abgeleitet von PM Panel Studio 0.1.14 (D0GC/pm-networks-ultimate-dashboard).

- Name, Symbol und Logo neu („Haus Eichner Panel“), Slug `haus_panel`.
- Optionen auf das Haus eingestellt: Person, Met.no-Wetter, Bosch-Alarmanlage, Reolink-Kamera am Treppenaufgang,
  Bewegungsmelder Treppenaufgang DG und Bad DG, alle Thermostate sichtbar.
- Neu: automatische Hinweiskarten (Option `auto_hinweise`) ohne eigenen Template-Sensor: offene Türen und Fenster,
  Rauch- und Wasseralarm, schwache Batterien, Solarbank-Akku, Waschmaschine fertig, Updates.
- Aktivitäten: Waschmaschine (Miele), Trockner (Leistung der Steckdose), Saugroboter S8 MaxV Ultra.
- Bereiche ohne Symbol bekommen eines nach ihrem Namen; Status-LEDs und Einstellungsschalter erscheinen nicht.
- Sicherheitsseite zeigt die Hauptanlage zuerst und „Alarm Oma“ darunter.
- Begrüßung in Du-Form.
- Entfernt: Shisha-Seite, Kohlegrill, Dusch- und Spa-Timer, Spülmaschine, Büro-Freigaben.
