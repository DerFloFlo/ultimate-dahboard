/* Haus Eichner Panel – Kern: Verbindung, Zustandsspiegel, Formatierung, Symbole, Bedienhilfen. */
(function () {
  "use strict";
  const PS = (window.PS = {
    z: {}, reg: {}, bereiche: [], einst: {}, opt: {}, karten: [], ha: {},
    modus: "wach", nacht: false, verbunden: false, ereignis: { aktiv: false },
  });

  // ------------------------------------------------------------ Ereignisse
  const hoerer = {};
  PS.on = (name, fn) => (hoerer[name] = hoerer[name] || []).push(fn);
  PS.emit = (name, data) => (hoerer[name] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

  // ------------------------------------------------------------ Verbindung
  let ws = null, naechsteId = 1, warteZeit = 1000;
  const offen = new Map();
  function verbinden() {
    const url = new URL("api/ws", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(url);
    ws.onopen = () => { warteZeit = 1000; };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      verarbeiten(m);
    };
    ws.onclose = () => {
      document.body.classList.add("getrennt");
      offen.forEach((p) => p.reject(new Error("Verbindung getrennt")));
      offen.clear();
      setTimeout(verbinden, warteZeit);
      warteZeit = Math.min(warteZeit * 2, 15000);
    };
  }
  function verarbeiten(m) {
    switch (m.typ) {
      case "init":
        PS.z = m.zustaende || {}; PS.bereiche = m.bereiche || []; PS.reg = m.registry || {}; PS.geraete = m.geraete || PS.geraete || {};
        PS.einst = m.einstellungen || {}; PS.opt = m.optionen || {}; PS.karten = m.karten || []; PS.ha = m.ha || {};
        PS.ereignis = m.ereignis || { aktiv: false };
        PS.meldungen = m.meldungen || [];
        PS.popups = m.popups || [];
        PS.szenen = m.szenen || { stat: {}, farben: {} };
        modusSetzen(m);
        document.body.classList.toggle("ohne-animation", PS.einst.animationen === false);
        PS.emit("init");
        PS.emit("karten", PS.karten);
        PS.emit("ereignis", PS.ereignis);
        document.body.classList.add("bereit");
        break;
      case "diff": {
        const ids = Object.keys(m.zustaende || {});
        for (const id of ids) { const s = m.zustaende[id]; if (s === null) delete PS.z[id]; else PS.z[id] = s; }
        PS.emit("diff", new Set(ids));
        break;
      }
      case "karten": PS.karten = m.karten || []; PS.emit("karten", PS.karten); break;
      case "modus": modusSetzen(m); break;
      case "ereignis": PS.ereignis = m; PS.emit("ereignis", m); break;
      case "einstellungen":
        PS.einst = m.einstellungen || {};
        document.body.classList.toggle("ohne-animation", PS.einst.animationen === false);
        PS.emit("einstellungen"); modusSetzen({ modus: PS.modus, nacht: PS.nacht, verbunden: PS.verbunden });
        break;
      case "szenen": PS.szenen = { stat: m.stat || {}, farben: m.farben || {} }; PS.emit("szenen"); break;
      case "popups": PS.popups = m.liste || []; PS.emit("popups", m.neu); break;
      case "meldungen": PS.meldungen = m.liste || []; PS.emit("meldungen"); break;
      case "registry": PS.bereiche = m.bereiche || []; PS.reg = m.registry || {}; PS.geraete = m.geraete || PS.geraete || {}; PS.emit("registry"); break;
      case "antwort": {
        const p = offen.get(m.id); if (!p) return; offen.delete(m.id);
        m.ok ? p.resolve(m.ergebnis) : p.reject(new Error(m.fehler || "Fehler"));
        break;
      }
    }
  }
  function modusSetzen(m) {
    PS.modus = m.modus || "wach"; PS.nacht = !!m.nacht; PS.verbunden = !!m.verbunden;
    document.body.classList.toggle("ruhe", PS.modus === "ruhe" && !document.body.classList.contains("offen"));
    document.body.classList.toggle("getrennt", !PS.verbunden);
    const e = PS.einst || {};
    const dunkel = PS.modus === "ruhe" ? (PS.nacht ? e.nacht_helligkeit : e.ruhe_helligkeit) : (PS.nacht ? Math.round((e.nacht_helligkeit || 0) / 3) : 0);
    document.documentElement.style.setProperty("--abdunkeln", ((dunkel || 0) / 100).toFixed(2));
    PS.emit("modus");
  }
  PS.anfrage = (msg) => new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error("Keine Verbindung"));
    const id = naechsteId++;
    offen.set(id, { resolve, reject });
    ws.send(JSON.stringify({ ...msg, id }));
    setTimeout(() => { if (offen.has(id)) { offen.delete(id); reject(new Error("Zeitüberschreitung")); } }, 30000);
  });
  PS.dienst = (domain, service, data = {}, antwort = false) =>
    PS.anfrage({ typ: "dienst", domain, service, data, antwort }).catch((e) => { PS.toast(e.message, true); throw e; });
  let letzteMeldung = 0;
  PS.letzteBeruehrung = 0;
  function beruehrt() {
    const t = Date.now();
    PS.letzteBeruehrung = t;
    if (PS.modus === "ruhe") { document.body.classList.remove("ruhe"); PS.modus = "wach"; PS.emit("modus"); }
    if (t - letzteMeldung > 4000 && ws && ws.readyState === 1) { letzteMeldung = t; ws.send(JSON.stringify({ typ: "beruehrt" })); }
    PS.emit("beruehrt");
  }
  addEventListener("pointerdown", beruehrt, { passive: true, capture: true });

  // ------------------------------------------------------------ Helfer
  PS.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  PS.domain = (eid) => eid.split(".")[0];
  PS.st = (eid) => PS.z[eid];
  PS.s = (eid) => (PS.z[eid] || {}).s;
  PS.a = (eid) => (PS.z[eid] || {}).a || {};
  PS.name = (eid) => {
    const a = PS.a(eid); const r = PS.reg[eid] || {};
    return a.friendly_name || r.n || eid.split(".")[1].replace(/_/g, " ");
  };
  PS.kurzname = (eid, bereichName) => {
    let n = PS.name(eid);
    if (bereichName && n.toLowerCase().startsWith(bereichName.toLowerCase() + " ")) n = n.slice(bereichName.length + 1);
    else if (bereichName && n.toLowerCase().endsWith(" " + bereichName.toLowerCase())) n = n.slice(0, -(bereichName.length + 1));
    return n.charAt(0).toUpperCase() + n.slice(1);
  };
  PS.bereichVon = (eid) => (PS.reg[eid] || {}).b || null;
  PS.bereichName = (id) => (PS.bereiche.find((b) => b.id === id) || {}).name || id;
  // Nur PM-Klima-Thermostate zeigen; die lokalen Thermostate steuert PM Klima selbst.
  PS.klimaSichtbar = (eid) => !eid.startsWith("climate.") || !PS.opt.klima_praefix || eid.startsWith(PS.opt.klima_praefix);
  PS.sichtbar = (eid) => { const r = PS.reg[eid]; return (!r || (!r.h && r.ec == null)) && PS.klimaSichtbar(eid); };
  // Szenen, Skripte und Knöpfe stehen auf „unknown“, bis sie einmal ausgelöst wurden; das ist kein Fehler.
  const OHNE_ZUSTAND = ["scene", "script", "button", "input_button", "event"];
  PS.nichtDa = (eid) => {
    const s = PS.s(eid);
    if (s === undefined || s === "unavailable") return true;
    return s === "unknown" && !OHNE_ZUSTAND.includes(PS.domain(eid));
  };
  PS.istAn = (eid) => {
    const s = PS.s(eid), d = PS.domain(eid);
    if (s == null) return false;
    if (d === "lock") return s === "unlocked" || s === "open" || s === "opening";
    if (d === "cover") return s === "open" || s === "opening";
    if (d === "alarm_control_panel") return s.startsWith("armed");
    if (d === "media_player") return s === "playing";
    if (d === "vacuum") return s === "cleaning";
    if (d === "climate") return s !== "off";
    if (d === "person" || d === "device_tracker") return s === "home";
    if (d === "timer") return s === "active";
    return ["on", "open", "home", "playing", "active", "heat", "cleaning"].includes(s);
  };
  PS.zahl = (v, stellen) => {
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    const d = stellen != null ? stellen : n % 1 === 0 || Math.abs(n) >= 100 ? 0 : 1;
    return n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  PS.zeitRelativ = (iso) => {
    const t = new Date(iso).getTime(); if (!t) return "";
    const s = Math.round((Date.now() - t) / 1000), z = Math.abs(s), vor = s >= 0;
    const f = z < 60 ? "gerade eben" : z < 3600 ? `${Math.round(z / 60)} min` : z < 86400 ? `${Math.round(z / 3600)} h` : `${Math.round(z / 86400)} Tagen`;
    return z < 60 ? f : vor ? `vor ${f}` : `in ${f}`;
  };
  PS.uhrzeit = (d) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  const TEXTE = {
    on: "An", off: "Aus", open: "Offen", closed: "Geschlossen", opening: "Öffnet", closing: "Schließt", locked: "Verriegelt",
    unlocked: "Entriegelt", locking: "Verriegelt …", unlocking: "Entriegelt …", jammed: "Blockiert", unavailable: "Nicht erreichbar",
    unknown: "Unbekannt", home: "Zuhause", not_home: "Unterwegs", playing: "Spielt", paused: "Pausiert", idle: "Bereit",
    standby: "Standby", buffering: "Lädt", armed_home: "Scharf · Zuhause", armed_away: "Scharf · Abwesend", armed_night: "Scharf · Nacht",
    armed_vacation: "Scharf · Urlaub", armed_custom_bypass: "Scharf", disarmed: "Unscharf", triggered: "Ausgelöst", arming: "Wird scharf",
    pending: "Verzögerung", disarming: "Wird unscharf", cleaning: "Saugt", docked: "Angedockt", returning: "Fährt zurück", error: "Fehler",
    heat: "Heizen", cool: "Kühlen", auto: "Automatik", heat_cool: "Heizen/Kühlen", dry: "Trocknen", fan_only: "Lüften", active: "Läuft",
    above_horizon: "Über dem Horizont", below_horizon: "Unter dem Horizont", charging: "Lädt", problem: "Problem",
    sunny: "Sonnig", clear: "Klar", "clear-night": "Klare Nacht", cloudy: "Bewölkt", partlycloudy: "Teils bewölkt", rainy: "Regen",
    pouring: "Starkregen", snowy: "Schnee", "snowy-rainy": "Schneeregen", fog: "Nebel", hail: "Hagel", lightning: "Gewitter",
    "lightning-rainy": "Gewitter, Regen", windy: "Windig", "windy-variant": "Windig", exceptional: "Unwetter",
  };
  const BIN = {
    door: ["Zu", "Offen"], window: ["Zu", "Offen"], opening: ["Zu", "Offen"], garage_door: ["Zu", "Offen"], motion: ["Ruhig", "Bewegung"],
    occupancy: ["Frei", "Belegt"], presence: ["Abwesend", "Anwesend"], moisture: ["Trocken", "Nass"], smoke: ["OK", "Rauch"],
    battery: ["OK", "Schwach"], connectivity: ["Getrennt", "Verbunden"], problem: ["OK", "Problem"], lock: ["Verriegelt", "Entriegelt"],
    plug: ["Ausgesteckt", "Eingesteckt"], power: ["Aus", "Strom"], running: ["Aus", "Läuft"], vibration: ["Ruhig", "Vibration"],
    sound: ["Ruhig", "Geräusch"], light: ["Dunkel", "Hell"], heat: ["Normal", "Heiß"], cold: ["Normal", "Kalt"], gas: ["OK", "Gas"],
    safety: ["Sicher", "Unsicher"], tamper: ["OK", "Manipulation"], update: ["Aktuell", "Update"], carbon_monoxide: ["OK", "CO"],
  };
  PS.text = (eid, roh) => {
    const st = PS.z[eid]; if (!st) return "–";
    const s = roh !== undefined ? roh : st.s, a = st.a || {}, d = PS.domain(eid);
    if ((d === "scene" || d === "script" || d === "button" || d === "input_button") && s === "unknown") return "Bereit";
    if (s === "unavailable" || s === "unknown") return TEXTE[s];
    if (d === "binary_sensor") { const p = BIN[a.device_class]; return p ? p[s === "on" ? 1 : 0] : TEXTE[s] || s; }
    if (d === "light" && s === "on" && a.brightness != null) return `${Math.round((a.brightness / 255) * 100)} %`;
    if (d === "cover" && a.current_position != null && s === "open") return `Offen · ${a.current_position} %`;
    if (d === "climate") {
      const ist = a.current_temperature != null ? `${PS.zahl(a.current_temperature, 1)}°` : "";
      return s === "off" ? `Aus${ist ? " · " + ist : ""}` : `${ist}${a.temperature != null ? " → " + PS.zahl(a.temperature, 1) + "°" : ""}`;
    }
    if (d === "media_player" && s === "playing" && a.media_title) return a.media_title;
    if (d === "fan" && s === "on" && a.percentage != null) return `${a.percentage} %`;
    if (d === "timer" && s === "active" && a.finishes_at) return `bis ${PS.uhrzeit(new Date(a.finishes_at))}`;
    if (d === "scene" || d === "button" || d === "input_button") return s && s.length > 15 ? PS.zeitRelativ(s) : "–";
    if (d === "update") return s === "on" ? `Neu: ${a.latest_version || "Update"}` : "Aktuell";
    if (d === "sensor" || d === "number" || d === "input_number" || d === "counter") {
      if (a.device_class === "timestamp" || (typeof s === "string" && /^\d{4}-\d\d-\d\dT/.test(s))) return PS.zeitRelativ(s);
      if (s !== "" && isFinite(Number(s))) {
        const stellen = a.display_precision ?? ((PS.reg[eid] || {}).dp ?? undefined);
        return `${PS.zahl(s, stellen)}${a.unit_of_measurement ? " " + a.unit_of_measurement : ""}`;
      }
    }
    return TEXTE[s] || s;
  };

  // ------------------------------------------------------------ Symbole (MDI wie in Lovelace)
  let MDI = null;
  function mdiMap() {
    if (MDI) return MDI;
    MDI = new Map(); let cp = 0;
    for (const t of (window.MDI_ROH || "").split(",")) { const i = t.lastIndexOf(":"); cp += parseInt(t.slice(i + 1), 16); MDI.set(t.slice(0, i), cp); }
    return MDI;
  }
  PS.ic = (name, klasse = "") => {
    const n = String(name || "help-circle-outline").replace(/^mdi:/, "");
    const cp = mdiMap().get(n) || mdiMap().get("help-circle-outline");
    return `<i class="mdi ${klasse}" aria-hidden="true">${String.fromCodePoint(cp)}</i>`;
  };
  const DOMAIN_IC = {
    light: ["lightbulb-outline", "lightbulb"], switch: ["toggle-switch-variant-off", "toggle-switch-variant"], fan: ["fan-off", "fan"],
    lock: ["lock", "lock-open-variant"], cover: ["window-shutter", "window-shutter-open"], climate: ["thermostat", "thermostat"],
    media_player: ["speaker-off", "speaker-play"], vacuum: ["robot-vacuum", "robot-vacuum"], scene: ["palette", "palette"],
    script: ["script-text-play-outline", "script-text-play"], automation: ["robot-off-outline", "robot"],
    input_boolean: ["toggle-switch-off-outline", "toggle-switch"], button: ["gesture-tap-button", "gesture-tap-button"],
    input_button: ["gesture-tap-button", "gesture-tap-button"], alarm_control_panel: ["shield-off-outline", "shield-home"],
    camera: ["cctv", "cctv"], person: ["account-outline", "account"], device_tracker: ["lan-disconnect", "lan-connect"],
    todo: ["clipboard-list-outline", "clipboard-list"], calendar: ["calendar", "calendar"], update: ["package", "package-up"],
    number: ["ray-vertex", "ray-vertex"], input_number: ["ray-vertex", "ray-vertex"], select: ["format-list-bulleted", "format-list-bulleted"],
    input_select: ["format-list-bulleted", "format-list-bulleted"], timer: ["timer-outline", "timer"], counter: ["counter", "counter"],
    input_text: ["form-textbox", "form-textbox"], input_datetime: ["calendar-clock", "calendar-clock"], siren: ["bullhorn-outline", "bullhorn"],
    humidifier: ["air-humidifier-off", "air-humidifier"], water_heater: ["water-boiler-off", "water-boiler"], sun: ["weather-sunny", "weather-sunny"],
    weather: ["weather-partly-cloudy", "weather-partly-cloudy"], event: ["gesture-tap", "gesture-tap"], remote: ["remote", "remote"],
    image: ["image", "image"], valve: ["valve-closed", "valve-open"], lawn_mower: ["robot-mower", "robot-mower"], zone: ["map-marker", "map-marker"],
  };
  const SENSOR_IC = {
    temperature: "thermometer", humidity: "water-percent", power: "flash", energy: "lightning-bolt", battery: "battery", illuminance: "brightness-5",
    pressure: "gauge", carbon_dioxide: "molecule-co2", pm25: "blur", pm10: "blur", voltage: "sine-wave", current: "current-ac",
    timestamp: "clock-outline", duration: "timer-outline", monetary: "cash", signal_strength: "wifi", distance: "map-marker-distance",
    speed: "speedometer", wind_speed: "weather-windy", precipitation: "weather-rainy", gas: "meter-gas", water: "water",
    volatile_organic_compounds: "air-filter", aqi: "air-filter", frequency: "sine-wave", data_rate: "transfer", enum: "format-list-bulleted",
  };
  const BIN_IC = {
    door: ["door-closed", "door-open"], window: ["window-closed-variant", "window-open-variant"], opening: ["square-outline", "square-off-outline"],
    garage_door: ["garage", "garage-open"], motion: ["motion-sensor-off", "motion-sensor"], occupancy: ["home-outline", "home"],
    presence: ["home-outline", "home"], moisture: ["water-off", "water-alert"], smoke: ["smoke-detector", "smoke-detector-alert"],
    battery: ["battery", "battery-alert"], connectivity: ["close-network-outline", "check-network-outline"], problem: ["check-circle", "alert-circle"],
    plug: ["power-plug-off", "power-plug"], power: ["power-plug-off", "power-plug"], running: ["stop", "play"], lock: ["lock", "lock-open-variant"],
    light: ["brightness-5", "brightness-7"], update: ["package", "package-up"], vibration: ["crop-portrait", "vibrate"],
  };
  const WETTER_IC = {
    "clear-night": "weather-night", cloudy: "weather-cloudy", exceptional: "alert-circle-outline", fog: "weather-fog", hail: "weather-hail",
    lightning: "weather-lightning", "lightning-rainy": "weather-lightning-rainy", partlycloudy: "weather-partly-cloudy", pouring: "weather-pouring",
    rainy: "weather-rainy", snowy: "weather-snowy", "snowy-rainy": "weather-snowy-rainy", sunny: "weather-sunny", windy: "weather-windy",
    "windy-variant": "weather-windy-variant",
  };
  PS.wetterIcon = (zustand) => WETTER_IC[zustand] || "weather-partly-cloudy";
  PS.iconName = (eid) => {
    const st = PS.z[eid] || {}, a = st.a || {}, d = PS.domain(eid), an = PS.istAn(eid);
    if (a.icon) return a.icon;
    const r = PS.reg[eid]; if (r && r.i) return r.i;
    if (d === "sensor") {
      if (a.device_class === "battery" && isFinite(Number(st.s))) {
        const n = Math.round(Number(st.s) / 10) * 10;
        return n >= 100 ? "battery" : n <= 0 ? "battery-outline" : `battery-${n}`;
      }
      return SENSOR_IC[a.device_class] || (a.unit_of_measurement === "%" ? "percent-outline" : "eye");
    }
    if (d === "binary_sensor") { const p = BIN_IC[a.device_class]; return p ? p[st.s === "on" ? 1 : 0] : st.s === "on" ? "checkbox-marked-circle" : "radiobox-blank"; }
    if (d === "weather") return PS.wetterIcon(st.s);
    if (d === "cover" && ["garage", "door", "gate"].includes(a.device_class)) return an ? "garage-open" : "garage";
    if (d === "cover" && ["curtain"].includes(a.device_class)) return an ? "curtains" : "curtains-closed";
    if (d === "alarm_control_panel" && st.s === "triggered") return "bell-ring";
    if (d === "alarm_control_panel" && st.s === "armed_away") return "shield-lock";
    if (d === "alarm_control_panel" && st.s === "armed_night") return "shield-moon";
    const p = DOMAIN_IC[d]; return p ? p[an ? 1 : 0] : "eye";
  };
  PS.icon = (eid, klasse) => PS.ic(PS.iconName(eid), klasse);

  // ------------------------------------------------------------ Bedienung
  PS.toast = (text, fehler = false) => {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = text; el.classList.toggle("fehler", fehler); el.classList.add("zeigen");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("zeigen"), fehler ? 5000 : 2600);
  };
  PS.welle = (el, ev) => {
    if (!el || !ev || document.body.classList.contains("ohne-animation")) return;
    const r = el.getBoundingClientRect(), s = Math.max(r.width, r.height), w = document.createElement("span");
    w.className = "welle"; w.style.width = w.style.height = s + "px";
    w.style.left = ev.clientX - r.left - s / 2 + "px"; w.style.top = ev.clientY - r.top - s / 2 + "px";
    el.appendChild(w); setTimeout(() => w.remove(), 650);
  };
  // Kritische Aktionen (Entriegeln, Türöffner, Unscharf) lösen erst nach 2 s Halten aus, wie an den Panels.
  // Geprüft wird beim Drücken, nicht beim Aufbau: Ein Schloss wechselt seinen Zustand, die Kachel bleibt.
  PS.kritisch = (eid) => {
    const d = PS.domain(eid);
    return (d === "lock" && PS.s(eid) !== "unlocked" && PS.s(eid) !== "open") || eid === PS.opt.tueroeffner;
  };
  // Schalter mit Freigabe (Server-Hauptschalter im Büro): schaltbar nur, solange der Freigabe-Helfer an ist
  PS.freigabe = (eid) => (PS.einst.freigaben || {})[eid] || null;
  PS.halten = (el, ms, aktion, bedingung) => {
    let t = null, sofort = false;
    const ab = () => { clearTimeout(t); t = null; el.classList.remove("haelt"); };
    if (!el.querySelector(".halten")) el.insertAdjacentHTML("afterbegin", '<span class="halten"></span>');
    el.style.setProperty("--halte", ms + "ms");
    el.addEventListener("pointerdown", (ev) => {
      sofort = !!bedingung && !bedingung();
      if (sofort) return;
      ev.preventDefault(); el.classList.add("haelt");
      t = setTimeout(() => { ab(); aktion(); }, ms);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((n) => el.addEventListener(n, () => { if (t) { ab(); PS.toast("Zum Auslösen 2 Sekunden halten"); } }));
    el.addEventListener("click", () => { if (sofort) { sofort = false; aktion(); } });
  };
  // Tippen und langes Drücken unterscheiden (lang = Mehr Infos)
  PS.tippen = (el, kurz, lang) => {
    let t = null, langAus = false, start = null;
    el.addEventListener("pointerdown", (ev) => {
      langAus = false; start = [ev.clientX, ev.clientY];
      if (lang) t = setTimeout(() => { langAus = true; lang(ev); }, 550);
    });
    el.addEventListener("pointermove", (ev) => {
      if (t && start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 12) { clearTimeout(t); t = null; }
    });
    const ende = () => { clearTimeout(t); t = null; };
    el.addEventListener("pointerup", ende); el.addEventListener("pointercancel", ende); el.addEventListener("pointerleave", ende);
    el.addEventListener("click", (ev) => { if (langAus) { ev.preventDefault(); return; } kurz(ev); });
    el.addEventListener("contextmenu", (ev) => ev.preventDefault());
  };
  PS.umschalten = (eid) => {
    const d = PS.domain(eid), s = PS.s(eid);
    switch (d) {
      case "light": case "switch": case "fan": case "input_boolean": case "siren": case "humidifier": case "automation":
        return PS.dienst(d, "toggle", { entity_id: eid });
      case "cover": return PS.dienst("cover", "toggle", { entity_id: eid });
      case "lock": return PS.dienst("lock", s === "locked" ? "unlock" : "lock", { entity_id: eid });
      case "scene": return PS.dienst("scene", "turn_on", { entity_id: eid }).then(() => PS.toast(`${PS.name(eid)} aktiviert`));
      case "script": return PS.dienst("script", "turn_on", { entity_id: eid }).then(() => PS.toast(`${PS.name(eid)} gestartet`));
      case "button": case "input_button": return PS.dienst(d, "press", { entity_id: eid }).then(() => PS.toast(`${PS.name(eid)} ausgelöst`));
      case "media_player": return PS.dienst("media_player", "media_play_pause", { entity_id: eid });
      case "vacuum": return PS.dienst("vacuum", s === "cleaning" ? "return_to_base" : "start", { entity_id: eid });
      case "valve": return PS.dienst("valve", "toggle", { entity_id: eid });
      default: return null;
    }
  };
  PS.direktBedienbar = (eid) =>
    ["light", "switch", "fan", "input_boolean", "siren", "humidifier", "cover", "lock", "scene", "script", "button", "input_button", "media_player", "vacuum", "valve"].includes(PS.domain(eid));

  // Lichtgruppen (Helfer): Die Raumgruppe (Name = Bereichsname) steht als „Alle Lichter“ vorn; Untergruppen wie
  // „Deckenlampe Esstisch“ ersetzen ihre Einzellampen, die über den Dialog der Gruppe erreichbar bleiben.
  PS.lichtAuswahl = (ids, bereichName) => {
    const lichter = ids.filter((e) => e.startsWith("light."));
    const istGruppe = (e) => Array.isArray(PS.a(e).entity_id) && PS.a(e).entity_id.length > 0;
    const gruppen = lichter.filter(istGruppe);
    const inGruppe = new Set(gruppen.flatMap((g) => PS.a(g).entity_id));
    const nameKlein = String(bereichName || "").toLowerCase();
    const raum = gruppen.find((g) => !inGruppe.has(g) && PS.name(g).toLowerCase() === nameKlein) || null;
    const versteckt = new Set(gruppen.filter((g) => g !== raum).flatMap((g) => PS.a(g).entity_id));
    return { raum, sichtbar: lichter.filter((e) => e !== raum && !versteckt.has(e)) };
  };

  // Kachel für eine Entität (überall gleich aufgebaut, damit Aktualisierungen nur Klassen und Texte ändern)
  PS.kachelHTML = (eid, opts = {}) =>
    `<button class="kachel" data-eid="${PS.esc(eid)}"${opts.bereich ? ` data-bereich="${PS.esc(opts.bereich)}"` : ""}${opts.titel ? ` data-titel="${PS.esc(opts.titel)}"` : ""} style="--i:${opts.i || 0}">${PS.icon(eid)}<b></b><small></small><span class="balken"></span></button>`;
  PS.kachelAktualisieren = (el, bereichName) => {
    const eid = el.dataset.eid, st = PS.z[eid], d = PS.domain(eid);
    const icon = el.querySelector(".mdi"); if (icon) icon.outerHTML = PS.icon(eid);
    el.querySelector("b").textContent = el.dataset.titel || PS.kurzname(eid, bereichName);
    el.querySelector("small").textContent = PS.text(eid);
    el.classList.toggle("an", PS.istAn(eid) && d !== "person");
    el.classList.toggle("weg", !st || PS.nichtDa(eid));
    const frei = PS.freigabe(eid);
    el.classList.toggle("gesperrt", !!frei && PS.s(frei) !== "on");
    el.classList.toggle("freigegeben", !!frei && PS.s(frei) === "on");
    el.classList.toggle("alarm", (d === "alarm_control_panel" && st && st.s === "triggered") || (d === "binary_sensor" && st && st.s === "on" && ["smoke", "moisture", "gas", "safety", "carbon_monoxide"].includes((st.a || {}).device_class)));
    const a = (st || {}).a || {};
    let pct = 0;
    if (d === "light" && st && st.s === "on") pct = a.brightness != null ? (a.brightness / 255) * 100 : 100;
    else if (d === "cover" && a.current_position != null) pct = a.current_position;
    else if (d === "fan" && st && st.s === "on") pct = a.percentage ?? 100;
    else if (d === "media_player" && a.volume_level != null && st.s === "playing") pct = a.volume_level * 100;
    el.style.setProperty("--pct", pct + "%");
  };
  PS.kachelVerdrahten = (el) => {
    PS.kachelAktualisieren(el, el.dataset.bereich || undefined);
    const eid = el.dataset.eid;
    if (el._verdrahtet) return; el._verdrahtet = true;
    if (PS.domain(eid) === "lock" || eid === PS.opt.tueroeffner) {
      PS.halten(el, 2000, () => PS.umschalten(eid), () => PS.kritisch(eid));
      el.addEventListener("contextmenu", (ev) => { ev.preventDefault(); PS.mehrInfos(eid); });
      return;
    }
    PS.tippen(el, (ev) => {
      PS.welle(el, ev);
      if (PS.freigabe(eid)) PS.mehrInfos(eid);
      else if (PS.direktBedienbar(eid)) PS.umschalten(eid); else PS.mehrInfos(eid);
    }, () => PS.mehrInfos(eid));
  };
  // Alle Kacheln im Container an Zustandsänderungen koppeln
  PS.kachelnBinden = (container) => {
    container.querySelectorAll(".kachel[data-eid]").forEach((el) => PS.kachelVerdrahten(el));
  };
  PS.on("diff", (ids) => {
    document.querySelectorAll(".kachel[data-eid]").forEach((el) => {
      if (ids.has(el.dataset.eid) || (PS.freigabe(el.dataset.eid) && ids.has(PS.freigabe(el.dataset.eid)))) PS.kachelAktualisieren(el, el.dataset.bereich || undefined);
    });
  });

  PS.ringSVG = (anteil, extraKlasse = "") => {
    const R = 52, U = 2 * Math.PI * R, a = anteil == null ? 1 : Math.max(0, Math.min(1, anteil));
    return `<svg viewBox="0 0 120 120" class="${extraKlasse}"><circle class="spur" cx="60" cy="60" r="${R}"/><circle class="wert" cx="60" cy="60" r="${R}" stroke-dasharray="${U.toFixed(1)}" stroke-dashoffset="${(U * (1 - a)).toFixed(1)}"/></svg>`;
  };
  PS.ringSetzen = (svg, anteil) => {
    const c = svg && svg.querySelector(".wert"); if (!c) return;
    const U = 2 * Math.PI * 52, a = anteil == null ? 1 : Math.max(0, Math.min(1, anteil));
    c.style.strokeDashoffset = (U * (1 - a)).toFixed(1);
  };

  // Kleines, sicheres Markdown (Text wird zuerst maskiert): Überschriften, fett, kursiv, Listen, Absätze
  PS.markdown = (md) => {
    const inline = (t) => PS.esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/\b_([^_\n]+)_\b/g, "<i>$1</i>").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    const bloecke = String(md || "").replace(/\r/g, "").split(/\n{2,}/);
    return bloecke.map((b) => {
      const h = b.match(/^(#{1,4})\s+(.*)$/);
      if (h && !b.includes("\n")) return `<h4>${inline(h[2])}</h4>`;
      const zeilen = b.split("\n");
      if (zeilen.every((z) => /^\s*[-*·]\s+/.test(z))) return `<ul>${zeilen.map((z) => `<li>${inline(z.replace(/^\s*[-*·]\s+/, ""))}</li>`).join("")}</ul>`;
      return `<p>${zeilen.map(inline).join("<br>")}</p>`;
    }).join("");
  };
  // Hinweiston über die Lautsprecher des Panels (Web Audio, ohne Datei): dreistimmiger Gong.
  // Chromium spielt Ton erst nach einer Berührung ab; im Kiosk mit --autoplay-policy=no-user-gesture-required sofort.
  let audio = null;
  const audioCtx = () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; } return audio; };
  addEventListener("pointerdown", () => { const c = audioCtx(); if (c && c.state === "suspended") c.resume().catch(() => {}); }, { passive: true });
  PS.ton = () => {
    const c = audioCtx(); if (!c) return;
    if (c.state === "suspended") c.resume().catch(() => {});
    const laut = Math.max(0.05, Math.min(1, (PS.einst.ton_lautstaerke ?? 70) / 100)) * 0.5;
    const jetzt = c.currentTime + 0.05;
    [[880, 0], [1108.7, 0.18], [1318.5, 0.36]].forEach(([hz, ab]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = hz;
      g.gain.setValueAtTime(0, jetzt + ab);
      g.gain.linearRampToValueAtTime(laut, jetzt + ab + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, jetzt + ab + 1.1);
      o.connect(g).connect(c.destination); o.start(jetzt + ab); o.stop(jetzt + ab + 1.2);
    });
  };
  // Wiederholung (höchstens 3×, alle 20 s), bis die Meldung geöffnet, bestätigt oder geschlossen ist
  let tonTimer = null, tonFuer = null;
  PS.alarmTon = (m) => {
    if (!m || m.prio !== "high" || PS.einst.ton_hoch === false) return;
    if (PS.s("input_boolean.alles_stumm") === "on" && !m.sicherheit) return;
    PS.tonStopp(); tonFuer = m.id;
    let n = 0;
    const spielen = () => {
      if (tonFuer !== m.id || !(PS.popups || []).some((x) => x.id === m.id)) return PS.tonStopp();
      PS.ton(); if (++n < 3) tonTimer = setTimeout(spielen, 20000);
    };
    spielen();
  };
  PS.tonStopp = () => { clearTimeout(tonTimer); tonTimer = null; tonFuer = null; };
  PS.kameraUrl = (eid) => "api/kamera?eid=" + encodeURIComponent(eid) + "&t=" + Date.now();
  // Livebild (MJPEG); fällt bei Fehlern auf Einzelbilder zurück, die nacheinander (nie überlappend) geladen werden.
  PS.kameraStarten = (img, eid) => {
    PS.kameraStoppen(img);
    let aktiv = true, fehler = 0;
    const einzelbild = () => {
      if (!aktiv || !img.isConnected) return;
      img.onload = () => { if (aktiv) img._t = setTimeout(einzelbild, 800); };
      img.onerror = () => { if (aktiv) img._t = setTimeout(einzelbild, 3000); };
      img.src = PS.bildUrl(`/api/camera_proxy/${eid}`);
    };
    img.onerror = () => { if (++fehler === 1 && aktiv) einzelbild(); };
    img.onload = null;
    img.src = PS.kameraUrl(eid);
    img._stop = () => { aktiv = false; clearTimeout(img._t); img.onload = img.onerror = null; img.removeAttribute("src"); };
  };
  // Livestream (HLS) für eine Kamera in einem Container: zuerst das letzte Standbild, dann das Video, sobald die
  // Kamera wach ist. Ohne Stream (oder bei Fehlern) Einzelbilder. Akkukameras daher nur auf Antippen und im Overlay.
  PS.kameraLive = (box, eid) => {
    PS.kameraLiveStoppen(box.parentElement || box);
    box.classList.add("kamera", "live"); box.classList.remove("laeuft");
    box.innerHTML = `<img alt=""><video muted autoplay playsinline></video><span class="status">Kamera wird geweckt …</span>`;
    const img = box.querySelector("img"), video = box.querySelector("video"), status = box.querySelector(".status");
    img.src = PS.bildUrl(`/api/camera_proxy/${eid}`);
    let hls = null, aus = false;
    const ersatz = () => { if (aus) return; if (hls) { hls.destroy(); hls = null; } status.textContent = "Einzelbilder"; PS.kameraStarten(img, eid); };
    video.addEventListener("playing", () => { box.classList.add("laeuft"); status.textContent = "Live"; });
    PS.anfrage({ typ: "kamera_stream", entity_id: eid }).then((url) => {
      if (aus) return;
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls({ enableWorker: false, lowLatencyMode: true, liveSyncDurationCount: 2, maxBufferLength: 6 });
        hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d && d.fatal) ersatz(); });
        hls.loadSource(url); hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = url;
      else ersatz();
    }).catch(ersatz);
    // Wacht die Kamera nicht binnen 25 s auf, bleibt es bei Einzelbildern
    setTimeout(() => { if (!aus && !box.classList.contains("laeuft")) ersatz(); }, 25000);
    box._stop = () => { aus = true; if (hls) hls.destroy(); video.removeAttribute("src"); try { video.load(); } catch { /* egal */ } PS.kameraStoppen(img); };
  };
  PS.kameraLiveStoppen = (root) => { if (root) root.querySelectorAll(".kamera.live").forEach((b) => { if (b._stop) { b._stop(); b._stop = null; } }); };
  // Kacheln: nur ein Standbild, alle 30 s erneuert (weckt Akkukameras nicht dauernd)
  PS.kameraVorschau = (img, eid) => {
    PS.kameraStoppen(img);
    let aktiv = true;
    const laden = () => { if (!aktiv || !img.isConnected) return; img.onload = img.onerror = () => { if (aktiv) img._t = setTimeout(laden, 30000); }; img.src = PS.bildUrl(`/api/camera_proxy/${eid}`); };
    laden();
    img._stop = () => { aktiv = false; clearTimeout(img._t); img.onload = img.onerror = null; };
  };
  PS.kameraStoppen = (img) => { if (img && img._stop) { img._stop(); img._stop = null; } };
  PS.bildUrl = (pfad) => "api/bild?pfad=" + encodeURIComponent(pfad) + "&t=" + Date.now();
  PS.verbinden = verbinden;
})();
