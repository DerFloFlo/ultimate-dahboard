# Änderungen

## 1.4.1 – 2026-10-06

- UniFi: verständliche Meldung, wenn ein Ubiquiti-Cloud-Konto mit Zwei-Faktor statt eines lokalen Benutzers
  eingetragen ist (HTTP 499).

## 1.4.0 – 2026-10-06

- Wartung: neue Box „WLAN-Geräte“ mit der Signalstärke (dBm) aller WLAN-Clients aus dem UniFi-Controller,
  schwächste zuerst, mit Funkband, Zugangspunkt und SSID; „Alle … WLAN-Geräte“ gruppiert nach Zugangspunkt.
  Aktualisierung jede Minute. Neue App-Optionen `unifi_adresse`, `unifi_benutzer`, `unifi_passwort`, `unifi_site`
  (UniFi OS und klassischer Controller, nur lesender Zugriff).

## 1.3.1 – 2026-10-06

- iPhone: Die Modulleiste (Räume, Klima, Licht, Sicherheit, Wartung …) war seit 1.2.0 auf null Höhe
  zusammengefallen. Sie steht jetzt fest am unteren Rand und lässt sich seitlich wischen. iPad unverändert.

## 1.3.0 – 2026-10-06

- Beamer (Optoma UHZ68LV, `media_player.optoma_beamer`): Kachel und Dialog schalten ihn ein und aus statt
  Play/Pause zu senden, zeigen den Eingang lesbar („HDMI 3“ statt „DIGITAL 3“) und bieten die Eingänge sowie
  Ton aus als Knöpfe an. Gilt für jeden Player ohne Wiedergabefunktion (z. B. Beamer oder Fernseher über PJLink).
- Neue Aktivitätskarte „Beamer“ im Karussell, solange er läuft (im Editor unter Karten abschaltbar).

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
