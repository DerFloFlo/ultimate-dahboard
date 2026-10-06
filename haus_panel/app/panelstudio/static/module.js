/* Haus Eichner Panel – Module. Jedes Modul baut seine Inhalte aus der Registry auf, damit keine Funktion
   aus dem bisherigen Dashboard verloren geht: neue Geräte erscheinen automatisch an der passenden Stelle. */
(function () {
  "use strict";
  const PS = window.PS;
  const E = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const alle = () => Object.keys(PS.z);
  // Bereich laut Registry plus zugeordnete Schalter aus dem Editor; ein zugeordneter Schalter erscheint nur dort
  const raumSchalter = () => PS.einst.raum_schalter || {};
  const zugeordnet = () => new Set(Object.values(raumSchalter()).flat());
  const imBereich = (b) => {
    const extra = (raumSchalter()[b] || []).filter((e) => PS.z[e]);
    const fest = zugeordnet();
    return [...new Set([...alle().filter((e) => PS.bereichVon(e) === b && PS.sichtbar(e) && !fest.has(e)), ...extra])];
  };
  const dom = (d) => (e) => PS.domain(e) === d;
  const bereicheSortiert = () => {
    const ordnung = PS.einst.bereiche_reihenfolge || [], aus = new Set(PS.einst.bereiche_ausblenden || []);
    return PS.bereiche.filter((b) => !aus.has(b.id)).sort((x, y) => {
      const ix = ordnung.indexOf(x.id), iy = ordnung.indexOf(y.id);
      if (ix !== iy) return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy);
      return (x.etage_level ?? 0) - (y.etage_level ?? 0) || String(x.name).localeCompare(y.name, "de");
    });
  };
  function gruppe(titel, inhalt, aktion) {
    const g = E(`<section class="gruppe"><h3><span>${PS.esc(titel)}</span></h3></section>`);
    if (aktion) { aktion.classList.add("aktion"); g.querySelector("h3").appendChild(aktion); }
    if (typeof inhalt === "string") g.insertAdjacentHTML("beforeend", inhalt); else if (inhalt) g.appendChild(inhalt);
    return g;
  }
  function kachelRaster(ids, bereichName, breit = false) {
    if (!ids.length) return null;
    return E(`<div class="raster${breit ? " breit" : ""}">${ids.map((e, i) => PS.kachelHTML(e, { i, bereich: bereichName })).join("")}</div>`);
  }
  function knopf(text, icon, fn, klasse = "") {
    const b = E(`<button class="knopf ${klasse}">${icon ? PS.ic(icon) : ""}${text ? `<span>${PS.esc(text)}</span>` : ""}</button>`);
    if (fn) b.addEventListener("click", fn); return b;
  }
  const sortName = (bn) => (x, y) => PS.kurzname(x, bn).localeCompare(PS.kurzname(y, bn), "de");
  // Übersichten (Räume, Medien, Energie …) bei Änderungen höchstens alle 5 s still neu aufbauen.
  // Große Karten (Klima, Medien, Alarm) und Kacheln aktualisieren sich selbst an Ort und Stelle.
  let neuTimer = null, beobachtet = null, letzterAufbau = 0;
  PS.on("diff", (ids) => {
    if (!beobachtet || neuTimer || !document.body.classList.contains("offen")) return;
    if (![...ids].some(beobachtet)) return;
    const versuch = () => {
      const warten = Math.max(5000 - (Date.now() - letzterAufbau), 3000 - (Date.now() - PS.letzteBeruehrung));
      if (warten > 0) { neuTimer = setTimeout(versuch, warten); return; }
      neuTimer = null; letzterAufbau = Date.now(); PS.neuZeichnen();
    };
    neuTimer = setTimeout(versuch, 800);
  });
  const beobachten = (fn) => { beobachtet = fn; letzterAufbau = Date.now(); };
  PS.on("seite", () => { beobachtet = null; clearTimeout(neuTimer); neuTimer = null; });

  // ------------------------------------------------------------ Räume
  const ABSCHNITTE = [
    ["Licht", (e) => dom("light")(e)],
    ["Klima", (e) => dom("climate")(e) || dom("fan")(e) || dom("humidifier")(e) || dom("water_heater")(e)],
    ["Rollos und Fenster", (e) => dom("cover")(e) || dom("valve")(e)],
    ["Medien", (e) => dom("media_player")(e) || dom("remote")(e)],
    ["Szenen", (e) => dom("scene")(e) || dom("script")(e)],
    ["Schalter", (e) => ["switch", "input_boolean", "lock", "vacuum", "siren", "button", "input_button", "lawn_mower"].includes(PS.domain(e))],
    ["Einstellungen", (e) => ["number", "input_number", "select", "input_select", "input_text", "input_datetime", "timer", "counter"].includes(PS.domain(e))],
    ["Kameras", (e) => dom("camera")(e)],
    ["Sensoren", (e) => dom("sensor")(e) || dom("binary_sensor")(e) || dom("event")(e)],
  ];
  // ------------------------------------------------------------ Raumansicht (drei Spalten, ein Bildschirm)
  const szenenPunkte = (e, stunde) => {
    const st = ((PS.szenen || {}).stat || {})[e]; if (!st) return 0;
    let p = st.n;
    for (let d = -2; d <= 2; d++) p += (st.h[(stunde + d + 24) % 24] || 0) * (d === 0 ? 3 : 2);
    return p;
  };
  // Häufigste Szenen zuerst, gewichtet nach Tageszeit; angeheftete stehen immer vorn
  PS.lieblingsSzenen = (b) => {
    const aus = new Set(PS.einst.szenen_aus || []);
    const szenen = alle().filter((e) => dom("scene")(e) && PS.bereichVon(e) === b && PS.sichtbar(e) && !aus.has(e) && PS.s(e) !== "unavailable");
    const fest = (PS.einst.szenen_angeheftet || []).filter((e) => szenen.includes(e));
    const h = new Date().getHours();
    const rest = szenen.filter((e) => !fest.includes(e)).sort((x, y) => szenenPunkte(y, h) - szenenPunkte(x, h) || sortName()(x, y));
    return [...fest, ...rest];
  };
  const SZENE_NEUTRAL = ["#443171", "#262252"];
  function szeneKnopf(e, bereichName, aktiv) {
    const f = ((PS.szenen || {}).farben || {})[e] || [];
    const [c1, c2] = f.length ? [f[0], f[1] || "#262252"] : SZENE_NEUTRAL;
    const st = ((PS.szenen || {}).stat || {})[e];
    const unter = aktiv ? "aktiv" : st && st.n ? `${st.n}× in 30 Tagen` : "";
    const k = E(`<button class="szene${aktiv ? " aktiv" : ""}" data-szene="${PS.esc(e)}" style="--c1:${PS.esc(c1)};--c2:${PS.esc(c2)}"><b>${PS.esc(PS.kurzname(e, bereichName))}</b><small>${PS.esc(unter)}</small></button>`);
    PS.tippen(k, (ev) => { PS.welle(k, ev); PS.dienst("scene", "turn_on", { entity_id: e }).then(() => PS.toast(`${PS.kurzname(e, bereichName)} aktiviert`)); }, () => PS.mehrInfos(e));
    return k;
  }
  function szenenBox(b, name) {
    const box = E(`<section class="r-box"><h3><span>Szenen</span><small>nach Häufigkeit</small></h3><div class="szenen"></div></section>`);
    box.aktualisieren = () => {
      const liste = PS.lieblingsSzenen(b);
      const zeit = (e) => Date.parse(PS.s(e)) || 0;
      const zuletzt = liste.reduce((m, e) => (zeit(e) > zeit(m || "") ? e : m), null);
      const aktiv = zuletzt && Date.now() - zeit(zuletzt) < 12 * 3600e3 ? zuletzt : null;
      const raster = box.querySelector(".szenen"); raster.innerHTML = "";
      liste.slice(0, 6).forEach((e) => raster.appendChild(szeneKnopf(e, name, e === aktiv)));
      box.querySelector(".mehr-szenen")?.remove();
      const oben = new Set(liste.slice(0, 6));
      const weitere = alle().filter((e) => dom("scene")(e) && PS.bereichVon(e) === b && PS.sichtbar(e) && !oben.has(e)).sort(sortName(name));
      if (weitere.length) box.appendChild(knopf(`Weitere Szenen (${weitere.length})`, "palette-outline", () => PS.unterseite(`${name} · Szenen`, (el) => { el.appendChild(kachelRaster(weitere, name)); }), "mehr-szenen"));
      if (!liste.length) raster.innerHTML = '<div class="leer">Keine Szenen in diesem Raum.</div>';
    };
    box.dataset.raumSzenen = b;
    box.aktualisieren();
    return box;
  }
  PS.on("szenen", () => document.querySelectorAll("[data-raum-szenen]").forEach((x) => x.aktualisieren && x.aktualisieren()));
  PS.on("diff", (ids) => {
    if (![...ids].some((e) => e.startsWith("scene."))) return;
    document.querySelectorAll("[data-raum-szenen]").forEach((x) => x.aktualisieren && x.aktualisieren());
  });

  function lichtBox(ids, name) {
    const { raum, sichtbar } = PS.lichtAuswahl(ids, name);
    const box = E(`<section class="r-box"><h3><span>Licht</span></h3></section>`);
    if (!raum && !sichtbar.length) { box.appendChild(E('<div class="leer">Keine Lampen in diesem Raum.</div>')); return box; }
    const ziel = raum ? [raum] : sichtbar;
    const hell = () => {
      const an = ziel.flatMap((e) => (Array.isArray(PS.a(e).entity_id) ? [e] : [e])).filter((e) => PS.s(e) === "on");
      if (!an.length) return 0;
      return Math.round(an.reduce((s, e) => s + (PS.a(e).brightness ?? 255), 0) / an.length / 2.55);
    };
    const kopf = E(`<div class="r-master"></div>`);
    if (raum) kopf.insertAdjacentHTML("beforeend", PS.kachelHTML(raum, { bereich: name, titel: "Alle Lichter" }));
    else {
      const alleAn = sichtbar.some((e) => PS.s(e) === "on");
      kopf.appendChild(knopf(alleAn ? "Alle aus" : "Alle an", "lightbulb-group", () => PS.dienst("light", sichtbar.some((e) => PS.s(e) === "on") ? "turn_off" : "turn_on", { entity_id: sichtbar }), "r-alle"));
    }
    const regler = PS.schieber({ label: "Helligkeit", min: 1, max: 100, schritt: 1, wert: hell(), text: (v) => v + " %", beiEnde: (v) => PS.dienst("light", "turn_on", { entity_id: ziel, brightness_pct: v }) });
    kopf.appendChild(regler);
    box.appendChild(kopf);
    box.dataset.lichtZiel = ziel.join(",");
    box.aktualisieren = () => { if (!regler.classList.contains("zieht")) regler.setzen(hell() || 1); };
    if (sichtbar.length) {
      box.appendChild(E('<h3 class="unter"><span>Einzeln</span></h3>'));
      box.appendChild(E(`<div class="raster r-lichter">${[...sichtbar].sort(sortName(name)).map((e, i) => PS.kachelHTML(e, { i, bereich: name })).join("")}</div>`));
    }
    return box;
  }
  PS.on("diff", (ids) => {
    document.querySelectorAll("[data-licht-ziel]").forEach((x) => { if (x.dataset.lichtZiel.split(",").some((e) => ids.has(e)) && x.aktualisieren) x.aktualisieren(); });
  });

  function raumKompakt(el, b) {
    const name = PS.bereichName(b), ids = imBereich(b);
    el.classList.add("raumseite");
    const g = E('<div class="raum-ansicht"><div class="r-spalte"></div><div class="r-spalte"></div><div class="r-spalte"></div></div>');
    const [links, mitte, rechts] = g.children;
    // Links: Klima und Szenen
    ids.filter(dom("climate")).forEach((k) => { const c = PS.klimaSteuerung(k); c.classList.add("kompakt"); links.appendChild(c); });
    links.appendChild(szenenBox(b, name));
    // Mitte: Licht und Luftqualität
    mitte.appendChild(lichtBox(ids, name));
    const luft = PS.luftBox(b, ids);
    if (luft) mitte.appendChild(luft);
    // Rechts: Modi (zugeordnete Schalter), Medien, Zustand, Geräte
    const modi = (raumSchalter()[b] || []).filter((e) => PS.z[e]);
    if (modi.length) { const z = E('<section class="r-box"><h3><span>Modi</span></h3></section>'); z.appendChild(kachelRaster(modi, name)); z.lastElementChild.classList.add("mini"); rechts.appendChild(z); }
    const medien = ids.filter(dom("media_player")).filter((e) => ["playing", "paused", "on", "idle", "buffering"].includes(PS.s(e)));
    medien.slice(0, 1).forEach((m) => rechts.appendChild(PS.medienSteuerung(m, false)));
    const zustand = ids.filter((e) => (e.startsWith("binary_sensor.") && ["door", "window", "opening", "motion", "occupancy", "presence", "moisture", "smoke"].includes(PS.a(e).device_class))
);  // Luftwerte stehen in der Luft-Box
    if (zustand.length) { const z = E('<section class="r-box"><h3><span>Zustand</span></h3></section>'); z.appendChild(kachelRaster(zustand.slice(0, 6).sort(sortName(name)), name)); z.lastElementChild.classList.add("mini"); rechts.appendChild(z); }
    // Geräte; Wake-on-LAN-Knöpfe (PC starten) gehören dazu und stehen vorn
    const wol = (e) => PS.domain(e) === "button" && /(^|_)wol(_|$)|wake_on_lan/.test(e);
    const geraete = ids.filter((e) => (["switch", "input_boolean", "fan", "cover", "lock", "vacuum", "humidifier", "valve"].includes(PS.domain(e)) || wol(e)) && !PS.nichtDa(e) && !modi.includes(e)
      && !Object.values(PS.einst.freigaben || {}).includes(e));  // Freigabe-Helfer nur über den Dialog des Schalters
    if (geraete.length) { const z = E('<section class="r-box"><h3><span>Geräte</span></h3></section>'); z.appendChild(kachelRaster(geraete.sort((x, y) => wol(y) - wol(x) || sortName(name)(x, y)).slice(0, 6), name)); z.lastElementChild.classList.add("mini"); rechts.appendChild(z); }
    rechts.appendChild(knopf(`Alle Geräte im Raum`, "view-grid-outline", () => PS.unterseite(`${name} · alle Geräte`, (x) => raumAlles(x, b)), "r-alles"));
    el.appendChild(g);
  }

  function raumAlles(el, b) {
    const name = PS.bereichName(b);
    const ids = imBereich(b);
    const klima = ids.filter(dom("climate"));
    if (klima.length) { const r = E('<div class="raster breit"></div>'); klima.forEach((k) => r.appendChild(PS.klimaSteuerung(k))); el.appendChild(gruppe("Heizung", r)); }
    const licht = PS.lichtAuswahl(ids, name);
    for (const [titel, filter] of ABSCHNITTE) {
      let teil = ids.filter(filter).filter((e) => !(titel === "Licht" && !licht.sichtbar.includes(e)) && !(titel === "Klima" && dom("climate")(e)));
      if (!teil.length && !(titel === "Licht" && licht.raum)) continue;
      teil.sort(sortName(name));
      if (titel === "Licht" && licht.raum) {
        const r = E(`<div class="raster">${PS.kachelHTML(licht.raum, { bereich: name, titel: "Alle Lichter" })}${teil.map((e, i) => PS.kachelHTML(e, { i: i + 1, bereich: name })).join("")}</div>`);
        el.appendChild(gruppe(titel, r));
        continue;
      }
      if (titel === "Kameras") {
        const r = E('<div class="raster breit"></div>');
        teil.forEach((c) => { const k = E(`<div class="kamera"><img alt=""><span>${PS.esc(PS.kurzname(c, name))}</span></div>`); k.addEventListener("click", () => PS.mehrInfos(c)); r.appendChild(k); setTimeout(() => PS.kameraVorschau(k.querySelector("img"), c), 50); });
        el.appendChild(gruppe(titel, r)); continue;
      }
      const aktion = titel === "Licht" && teil.length > 1 ? knopf("Alle aus", "lightbulb-group-off-outline", () => PS.dienst("light", "turn_off", { entity_id: teil })) : null;
      el.appendChild(gruppe(titel, kachelRaster(teil, name), aktion));
    }
    if (!ids.length) el.appendChild(E('<div class="leer">Diesem Bereich sind keine Geräte zugeordnet.</div>'));
  }
  function raumKarte(b, i) {
    const w = PS.raumWerte(b.id);
    const chips = [];
    if (w.lichterAn) chips.push(`<span class="chip an">${PS.ic("lightbulb")}${w.lichterAn}</span>`);
    const offen = w.ent.filter((e) => e.startsWith("binary_sensor.") && PS.s(e) === "on" && ["door", "window", "opening"].includes(PS.a(e).device_class));
    if (offen.length) chips.push(`<span class="chip warn">${PS.ic("window-open-variant")}${offen.length} offen</span>`);
    const bew = w.ent.find((e) => e.startsWith("binary_sensor.") && PS.s(e) === "on" && ["motion", "occupancy", "presence"].includes(PS.a(e).device_class));
    if (bew) chips.push(`<span class="chip">${PS.ic("motion-sensor")}Bewegung</span>`);
    const medien = w.ent.find((e) => e.startsWith("media_player.") && PS.s(e) === "playing");
    if (medien) chips.push(`<span class="chip an">${PS.ic("play")}${PS.esc(PS.kurzname(medien, b.name))}</span>`);
    if (w.klima && PS.a(w.klima).hvac_action === "heating") chips.push(`<span class="chip warn">${PS.ic("fire")}heizt</span>`);
    const k = E(`<div class="raum" style="--i:${i}"><div class="oben">${PS.ic(b.icon || "texture-box")}<b>${PS.esc(b.name)}</b></div>
      <div class="werte">${w.temp != null ? `<span>${PS.ic("thermometer")} ${PS.zahl(w.temp, 1)}°</span>` : ""}${w.feuchte != null ? `<span>${PS.ic("water-percent")} ${PS.zahl(w.feuchte, 0)} %</span>` : ""}</div>
      <div class="chips">${chips.join("")}</div></div>`);
    k.addEventListener("click", () => PS.unterseite(b.name, (el) => raumKompakt(el, b.id)));
    return k;
  }

  // ------------------------------------------------------------ Module
  PS.module = {
    raeume: {
      titel: "Räume", icon: "floor-plan",
      render(el) {
        const r = E('<div class="raster"></div>');
        bereicheSortiert().forEach((b, i) => r.appendChild(raumKarte(b, i)));
        el.appendChild(r);
        beobachten((e) => ["light", "climate", "binary_sensor", "media_player", "sensor"].includes(PS.domain(e)));
      },
      unterseite(b) { PS.unterseite(PS.bereichName(b), (el) => raumKompakt(el, b)); },
    },

    klima: {
      titel: "Klima", icon: "thermostat",
      render(el) {
        const thermo = alle().filter(dom("climate")).filter((e) => PS.sichtbar(e) && !PS.nichtDa(e));
        const r = E('<div class="raster breit"></div>'); thermo.sort(sortName()).forEach((t) => r.appendChild(PS.klimaSteuerung(t)));
        if (thermo.length) el.appendChild(gruppe("Heizung", r));
        const pmSchalter = alle().filter((e) => e.startsWith("switch.pm_") && PS.sichtbar(e));
        if (pmSchalter.length) el.appendChild(gruppe("PM Klima", kachelRaster(pmSchalter.sort(sortName()))));
        const empf = alle().find((e) => e === "sensor.pm_klima_empfehlung");
        if (empf) el.appendChild(gruppe("Empfehlung", kachelRaster([empf], undefined, true)));
        // Raumklima je Bereich
        const zeilen = bereicheSortiert().map((b) => ({ b, w: PS.raumWerte(b.id) })).filter((x) => x.w.temp != null || x.w.feuchte != null);
        el.appendChild(gruppe("Raumklima", E(`<div class="liste">${zeilen.map(({ b, w }) => `<div class="zeile" data-b="${PS.esc(b.id)}">${PS.ic(b.icon || "texture-box")}<span class="n">${PS.esc(b.name)}</span><span class="w">${w.temp != null ? PS.zahl(w.temp, 1) + "°" : ""}${w.feuchte != null ? " · " + PS.zahl(w.feuchte, 0) + " %" : ""}</span></div>`).join("")}</div>`)));
        el.querySelectorAll("[data-b]").forEach((z) => z.addEventListener("click", () => PS.module.raeume.unterseite(z.dataset.b)));
        const aussen = ["sensor.innen_hinterm_haus_temperature", "sensor.innen_hinterm_haus_humidity", "sensor.skoda_octavia_combi_aussentemperatur", "sensor.innen_pressure", "sensor.innen_co2"].filter((e) => PS.z[e] && !PS.nichtDa(e));
        if (aussen.length) el.appendChild(gruppe("Außen und Wetterstation", kachelRaster(aussen)));
        const luft = alle().filter((e) => e.startsWith("sensor.") && PS.sichtbar(e) && ["carbon_dioxide", "pm25", "volatile_organic_compounds", "aqi"].includes(PS.a(e).device_class));
        if (luft.length) el.appendChild(gruppe("Luftqualität", kachelRaster(luft.sort(sortName()))));
        const sonst = alle().filter((e) => (dom("fan")(e) || dom("humidifier")(e)) && PS.sichtbar(e));
        if (sonst.length) el.appendChild(gruppe("Lüfter und Luftreiniger", kachelRaster(sonst.sort(sortName()))));
        if (PS.klimaStudio) el.appendChild(gruppe("Heizpläne und Auswertungen", knopf("PM Klima Studio öffnen", "thermometer-lines", PS.klimaStudio, "primaer")));
      },
    },

    licht: {
      titel: "Licht", icon: "lightbulb-group",
      render(el) {
        const auswahl = new Map(bereicheSortiert().map((b) => [b.id, PS.lichtAuswahl(alle().filter((e) => PS.bereichVon(e) === b.id && PS.sichtbar(e)), b.name)]));
        const lichter = [...auswahl.values()].flatMap((x) => x.sichtbar);
        const an = lichter.filter((e) => PS.s(e) === "on");
        const allesAus = knopf(`Alle aus (${an.length})`, "lightbulb-group-off", null, "gefahr");
        PS.halten(allesAus, 1200, () => PS.dienst("light", "turn_off", { entity_id: an }).then(() => PS.toast("Alle Lichter aus")), () => an.length > 3);
        if (an.length) el.appendChild(gruppe("Gerade an", kachelRaster(an.sort(sortName())), allesAus));
        for (const b of bereicheSortiert()) {
          const { raum, sichtbar } = auswahl.get(b.id);
          const teil = [...sichtbar].sort(sortName(b.name));
          if (!teil.length && !raum) continue;
          const szenen = alle().filter((e) => dom("scene")(e) && PS.bereichVon(e) === b.id && PS.sichtbar(e)).sort(sortName(b.name));
          const r = E(`<div class="raster">${raum ? PS.kachelHTML(raum, { bereich: b.name, titel: "Alle Lichter" }) : ""}${[...teil, ...szenen].map((e, i) => PS.kachelHTML(e, { i: i + 1, bereich: b.name })).join("")}</div>`);
          el.appendChild(gruppe(b.name, r, !raum && teil.length > 1 ? knopf("Aus", "lightbulb-off-outline", () => PS.dienst("light", "turn_off", { entity_id: teil })) : null));
        }
      },
    },

    sicherheit: {
      titel: "Sicherheit", icon: "shield-home",
      zaehler: () => alle().filter((e) => e.startsWith("binary_sensor.") && PS.s(e) === "on" && ["smoke", "moisture", "gas", "carbon_monoxide", "safety"].includes(PS.a(e).device_class)).length,
      render(el) {
        const alarm = alle().filter(dom("alarm_control_panel")).filter(PS.sichtbar);
        if (alarm.length) { const r = E('<div class="raster breit"></div>'); alarm.forEach((a) => r.appendChild(PS.alarmSteuerung(a))); el.appendChild(gruppe("Alarmanlage", r)); }
        const zugang = [...alle().filter(dom("lock")), ...(PS.opt.tueroeffner && PS.z[PS.opt.tueroeffner] ? [PS.opt.tueroeffner] : [])].filter(PS.sichtbar);
        if (zugang.length) el.appendChild(gruppe("Zugang", kachelRaster(zugang)));
        const bs = (klassen) => alle().filter((e) => e.startsWith("binary_sensor.") && PS.sichtbar(e) && klassen.includes(PS.a(e).device_class));
        const kontakte = bs(["door", "window", "opening", "garage_door"]).sort((x, y) => (PS.s(y) === "on") - (PS.s(x) === "on") || sortName()(x, y));
        const offen = kontakte.filter((e) => PS.s(e) === "on");
        el.appendChild(gruppe(offen.length ? `Türen und Fenster · ${offen.length} offen` : "Türen und Fenster · alles zu", kachelRaster(kontakte)));
        const gefahr = bs(["smoke", "moisture", "gas", "carbon_monoxide", "safety", "tamper"]);
        if (gefahr.length) el.appendChild(gruppe("Melder", kachelRaster(gefahr.sort(sortName()))));
        const kameras = alle().filter(dom("camera")).filter((e) => PS.sichtbar(e) && !PS.nichtDa(e));
        if (kameras.length) {
          const r = E('<div class="raster breit"></div>');
          kameras.forEach((c) => { const k = E(`<div class="kamera"><img alt=""><span>${PS.esc(PS.name(c))}</span></div>`); k.addEventListener("click", () => PS.mehrInfos(c)); r.appendChild(k); setTimeout(() => PS.kameraVorschau(k.querySelector("img"), c), 50); });
          el.appendChild(gruppe("Kameras", r));
        }
        const aufnahme = alle().filter((e) => e.startsWith("switch.") && /aufzeichn|aufnahme|record|privacy|voralarm|sirene/i.test(e) && PS.sichtbar(e));
        if (aufnahme.length) el.appendChild(gruppe("Kamera-Einstellungen", kachelRaster(aufnahme.sort(sortName()))));
        const bewegung = bs(["motion", "occupancy", "presence"]).sort((x, y) => (PS.s(y) === "on") - (PS.s(x) === "on") || sortName()(x, y));
        if (bewegung.length) el.appendChild(gruppe("Bewegung", kachelRaster(bewegung)));
      },
    },

    medien: {
      titel: "Medien", icon: "play-circle",
      render(el) {
        const player = alle().filter(dom("media_player")).filter(PS.sichtbar);
        const aktiv = player.filter((p) => ["playing", "paused", "on", "idle", "buffering"].includes(PS.s(p)));
        const r = E('<div class="raster breit"></div>');
        aktiv.sort((x, y) => (PS.s(y) === "playing") - (PS.s(x) === "playing")).forEach((p) => r.appendChild(PS.medienSteuerung(p, false)));
        el.appendChild(gruppe("Aktiv", aktiv.length ? r : E('<div class="leer">Gerade spielt nichts.</div>')));
        const rest = player.filter((p) => !aktiv.includes(p));
        if (rest.length) el.appendChild(gruppe("Alle Player", kachelRaster(rest.sort(sortName()))));
        const fern = alle().filter(dom("remote")).filter(PS.sichtbar);
        if (fern.length) el.appendChild(gruppe("Fernbedienungen", kachelRaster(fern)));
        beobachten(dom("media_player"));
      },
    },

    listen: {
      titel: "Listen", icon: "clipboard-text",
      render(el) {
        const listen = alle().filter(dom("todo")).filter(PS.sichtbar).sort((x, y) => (y.includes("einkauf") || y.includes("shopping")) - (x.includes("einkauf") || x.includes("shopping")) || sortName()(x, y));
        const tabs = [...listen.map((l) => [l, PS.name(l)]), ["kalender", "Kalender"], ...(PS.z["sensor.pmn_angebote_alle"] ? [["angebote", "Angebote"]] : [])];
        const box = E("<div></div>"); el.appendChild(box);
        const wahl = (k) => { box.innerHTML = ""; if (k === "kalender") kalender(box); else if (k === "angebote") angebote(box); else todo(box, k); };
        PS.tabs(tabs, tabs[0] && tabs[0][0], wahl);
        if (tabs[0]) wahl(tabs[0][0]);
      },
    },

    energie: {
      titel: "Energie", icon: "lightning-bolt",
      render(el) {
        const leistung = alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "power" && PS.sichtbar(e) && isFinite(Number(PS.s(e))));
        leistung.sort((x, y) => Number(PS.s(y)) - Number(PS.s(x)));
        const max = Math.max(1, ...leistung.map((e) => Math.abs(Number(PS.s(e)))));
        const summe = leistung.reduce((s, e) => s + Math.max(0, Number(PS.s(e))), 0);
        const liste = E(`<div>${leistung.map((e) => `<div class="balken-zeile" data-eid="${PS.esc(e)}"><span>${PS.esc(PS.name(e))}</span><span class="w">${PS.esc(PS.text(e))}</span><div class="bar"><i style="width:${(Math.abs(Number(PS.s(e))) / max) * 100}%"></i></div></div>`).join("")}</div>`);
        liste.querySelectorAll("[data-eid]").forEach((z) => z.addEventListener("click", () => PS.mehrInfos(z.dataset.eid)));
        el.appendChild(gruppe(`Leistung jetzt · ${PS.zahl(summe, 0)} W gesamt`, leistung.length ? liste : E('<div class="leer">Keine Leistungssensoren gefunden.</div>')));
        if (leistung[0]) { const d = E("<div></div>"); el.appendChild(gruppe(`Verlauf 24 h · ${PS.name(leistung[0])}`, d)); PS.diagramm(d, leistung[0], 24); }
        const energie = alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "energy" && PS.sichtbar(e) && !PS.nichtDa(e));
        if (energie.length) el.appendChild(gruppe("Zähler", kachelRaster(energie.sort(sortName()))));
        const steckdosen = alle().filter((e) => e.startsWith("switch.") && PS.sichtbar(e) && leistung.some((l) => PS.reg[l] && PS.reg[e] && PS.reg[l].d && PS.reg[l].d === PS.reg[e].d));
        if (steckdosen.length) el.appendChild(gruppe("Geschaltete Verbraucher", kachelRaster(steckdosen.sort(sortName()))));
        beobachten((e) => leistung.includes(e));
      },
    },

    wartung: {
      titel: "Wartung", icon: "wrench",
      zaehler: () => wartungsListe().batterien.filter((e) => Number(PS.s(e)) < 20).length + alle().filter((e) => e.startsWith("update.") && PS.s(e) === "on" && PS.sichtbar(e)).length,
      render(el) {
        const tabs = [["uebersicht", "Übersicht"], ["batterien", "Batterien"], ["erreichbar", "Nicht erreichbar"], ["protokoll", "Protokoll"], ["automationen", "Automationen"]];
        const box = E("<div></div>"); el.appendChild(box);
        const wahl = (k) => { box.innerHTML = ""; ({ uebersicht, batterien, erreichbar, protokoll, automationen })[k](box); PS.kachelnBinden(box); };
        PS.tabs(tabs, "uebersicht", wahl); wahl("uebersicht");
      },
    },

    hinweise: {
      titel: "Meldungen", icon: "bell-outline", versteckt: true,
      render(el) {
        const pops = PS.popups || [];
        if (pops.length) {
          const pl = E('<div class="liste"></div>');
          pops.forEach((x) => {
            const z = E(`<div class="zeile">${PS.ic(PS.meldungIcon(x.icon))}<span class="n">${PS.esc(x.titel)}<small>${PS.esc([x.text, PS.zeitRelativ(new Date(x.seit * 1000).toISOString())].filter(Boolean).join(" · "))}</small></span></div>`);
            z.firstElementChild.style.color = PS.meldungFarbe(x.prio);
            z.addEventListener("click", () => PS.popupZeigen(x.id));
            pl.appendChild(z);
          });
          el.appendChild(gruppe(`Meldungen · ${pops.length}`, pl));
        }
        const m = PS.meldungen || [];
        const liste = E('<div class="liste"></div>');
        m.forEach((n) => {
          const z = E(`<div class="zeile">${PS.ic("bell-ring-outline")}<span class="n">${PS.esc(n.title || "Benachrichtigung")}<small>${PS.esc(String(n.message || "").replace(/[*_#`]/g, "").slice(0, 240))}</small></span></div>`);
          z.appendChild(knopf("", "close", () => PS.dienst("persistent_notification", "dismiss", { notification_id: n.notification_id }), "rund"));
          liste.appendChild(z);
        });
        el.appendChild(gruppe(m.length ? `Benachrichtigungen · ${m.length}` : "Benachrichtigungen", m.length ? liste : E('<div class="leer">Keine offenen Benachrichtigungen.</div>'),
          m.length > 1 ? knopf("Alle verwerfen", "notification-clear-all", () => Promise.all(m.map((n) => PS.dienst("persistent_notification", "dismiss", { notification_id: n.notification_id })))) : null));
        if (!pops.length && !m.length) el.querySelectorAll(".gruppe").forEach((g) => g.remove());
        if (!pops.length && !m.length) el.appendChild(E('<div class="leer">Keine Meldungen. Hinweise stehen im Karussell auf der Startseite.</div>'));
        beobachten(() => false);
      },
    },

    suche: {
      titel: "Suche", icon: "magnify",
      render(el) {
        const feld = E('<input class="feld" id="suche-feld" type="search" placeholder="Gerät, Raum oder Entität suchen" autocomplete="off">');
        const domains = [...new Set(alle().map(PS.domain))].sort();
        const chips = E(`<div class="tabs" style="flex-wrap:wrap">${["alle", ...domains].map((d) => `<button data-d="${d}" class="${d === "alle" ? "aktiv" : ""}">${d === "alle" ? "Alle" : d}</button>`).join("")}</div>`);
        const ergebnis = E('<div class="liste"></div>');
        el.append(feld, chips, ergebnis);
        let domain = "alle";
        const suchen = () => {
          const q = feld.value.trim().toLowerCase();
          const treffer = alle().filter((e) => (domain === "alle" || PS.domain(e) === domain) && (!q || e.includes(q) || PS.name(e).toLowerCase().includes(q) || String(PS.bereichName(PS.bereichVon(e)) || "").toLowerCase().includes(q)));
          treffer.sort(sortName());
          ergebnis.innerHTML = treffer.slice(0, 150).map((e) => `<div class="zeile" data-eid="${PS.esc(e)}">${PS.icon(e)}<span class="n">${PS.esc(PS.name(e))}<small>${PS.esc(e)}${PS.bereichVon(e) ? " · " + PS.esc(PS.bereichName(PS.bereichVon(e))) : ""}</small></span><span class="w">${PS.esc(PS.text(e))}</span></div>`).join("") + (treffer.length > 150 ? `<div class="leer">${treffer.length - 150} weitere Treffer. Bitte die Suche eingrenzen.</div>` : "") + (!treffer.length ? '<div class="leer">Keine Treffer.</div>' : "");
          ergebnis.querySelectorAll("[data-eid]").forEach((z) => z.addEventListener("click", () => PS.mehrInfos(z.dataset.eid)));
        };
        feld.addEventListener("input", suchen);
        chips.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { domain = b.dataset.d; chips.querySelectorAll("button").forEach((x) => x.classList.toggle("aktiv", x === b)); suchen(); }));
        suchen();
        setTimeout(() => feld.focus(), 400);
      },
    },
  };

  // ------------------------------------------------------------ Listen
  PS.baustein = { todo: (b, e) => todo(b, e), kalender: (b) => kalender(b), angebote: (b) => angebote(b), kachelRaster: (ids, bn, breit) => kachelRaster(ids, bn, breit), lieblingsSzenen: (b) => PS.lieblingsSzenen(b) };
  async function todo(box, eid) {
    const kopf = E(`<div class="reihe" style="margin-bottom:1rem"></div>`);
    const feld = E('<input class="feld" type="text" placeholder="Neuer Eintrag" style="flex:1;min-width:14rem">');
    kopf.append(feld, knopf("Hinzufügen", "plus", hinzu, "primaer"));
    const liste = E('<div class="liste"><div class="leer">Wird geladen …</div></div>');
    box.append(kopf, liste);
    feld.addEventListener("keydown", (ev) => { if (ev.key === "Enter") hinzu(); });
    async function hinzu() {
      const t = feld.value.trim(); if (!t) return;
      await PS.dienst("todo", "add_item", { entity_id: eid, item: t }); feld.value = ""; laden();
    }
    async function laden() {
      try {
        const r = await PS.anfrage({ typ: "ws", befehl: { type: "todo/item/list", entity_id: eid } });
        const items = (r && r.items) || [];
        const offen = items.filter((i) => i.status !== "completed"), fertig = items.filter((i) => i.status === "completed");
        liste.innerHTML = [...offen, ...fertig].map((i) => `<div class="zeile${i.status === "completed" ? " erledigt" : ""}" data-uid="${PS.esc(i.uid)}" data-s="${i.status}">${PS.ic(i.status === "completed" ? "checkbox-marked-circle-outline" : "checkbox-blank-circle-outline")}<span class="n">${PS.esc(i.summary)}${i.due ? `<small>fällig ${PS.esc(i.due)}</small>` : i.description ? `<small>${PS.esc(i.description)}</small>` : ""}</span></div>`).join("") || '<div class="leer">Die Liste ist leer.</div>';
        if (fertig.length) liste.appendChild(knopf(`Erledigte entfernen (${fertig.length})`, "broom", () => PS.dienst("todo", "remove_completed_items", { entity_id: eid }).then(laden)));
        liste.querySelectorAll("[data-uid]").forEach((z) => z.addEventListener("click", () => PS.dienst("todo", "update_item", { entity_id: eid, item: z.dataset.uid, status: z.dataset.s === "completed" ? "needs_action" : "completed" }).then(laden)));
      } catch (e) { liste.innerHTML = `<div class="leer">Liste nicht lesbar: ${PS.esc(e.message)}</div>`; }
    }
    laden();
  }
  async function kalender(box) {
    const kals = alle().filter(dom("calendar")).filter(PS.sichtbar);
    const liste = E('<div class="liste"><div class="leer">Termine werden geladen …</div></div>'); box.appendChild(liste);
    const start = new Date(); start.setHours(0, 0, 0, 0); const ende = new Date(start.getTime() + 8 * 86400e3);
    const alleTermine = [];
    await Promise.all(kals.map(async (k) => {
      try {
        const r = await PS.anfrage({ typ: "rest", pfad: `calendars/${k}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(ende.toISOString())}` });
        (r || []).forEach((t) => alleTermine.push({ ...t, k }));
      } catch { /* einzelne Kalender dürfen fehlen */ }
    }));
    const zeit = (t) => t.dateTime || t.date;
    alleTermine.sort((x, y) => String(zeit(x.start)).localeCompare(String(zeit(y.start))));
    let tag = "";
    liste.innerHTML = alleTermine.map((t) => {
      const s = new Date(zeit(t.start)), ganz = !t.start.dateTime;
      const tagTxt = s.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
      const kopf = tagTxt !== tag ? `<h3 style="margin:1.4rem 0 .4rem;font-size:1rem;letter-spacing:.16em;text-transform:uppercase;color:var(--akzent)">${PS.esc(tagTxt)}</h3>` : "";
      tag = tagTxt;
      return `${kopf}<div class="zeile">${PS.ic("calendar")}<span class="n">${PS.esc(t.summary)}<small>${PS.esc(PS.name(t.k))}${t.location ? " · " + PS.esc(t.location) : ""}</small></span><span class="w">${ganz ? "ganztägig" : PS.uhrzeit(s)}</span></div>`;
    }).join("") || '<div class="leer">Keine Termine in den nächsten 7 Tagen.</div>';
  }
  async function angebote(box) {
    const feld = E('<input class="feld" type="search" placeholder="Angebote durchsuchen (z. B. Kaffee)">');
    const liste = E('<div class="liste"><div class="leer">Angebote werden geladen …</div></div>');
    box.append(feld, liste);
    let daten = [];
    try { daten = ((await PS.anfrage({ typ: "attribute", entity_id: "sensor.pmn_angebote_alle" })) || {}).angebote || []; } catch { daten = []; }
    const wunsch = PS.z["sensor.einkaufsliste_begriffe"] ? String(PS.s("sensor.einkaufsliste_begriffe")).toLowerCase().split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [];
    const zeigen = () => {
      const q = feld.value.trim().toLowerCase();
      let t = daten.filter((a) => (q ? (a.such || a.titel || "").toLowerCase().includes(q) : wunsch.length ? wunsch.some((w) => (a.such || "").includes(w)) : true));
      t = t.slice(0, 120);
      liste.innerHTML = (q || !wunsch.length ? "" : '<div class="leer">Treffer zu Ihrer Einkaufsliste. Suche für alle Angebote.</div>') + t.map((a) => `<div class="zeile">${PS.ic("tag-outline")}<span class="n">${PS.esc(a.titel)}<small>${PS.esc(a.haendler)}${a.einheit ? " · " + PS.esc(a.einheit) : ""}${a.bis ? " · bis " + PS.esc(new Date(a.bis).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })) : ""}</small></span><span class="w">${a.preis != null ? PS.zahl(a.preis, 2) + " €" : ""}</span></div>`).join("") || '<div class="leer">Keine passenden Angebote.</div>';
    };
    feld.addEventListener("input", zeigen); zeigen();
  }

  // ------------------------------------------------------------ Wartung
  function wartungsListe() {
    const batterien = alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "battery" && isFinite(Number(PS.s(e)))).sort((x, y) => Number(PS.s(x)) - Number(PS.s(y)));
    return { batterien };
  }
  // Verbrauchsmaterial: Filter, Bürsten, Sensoren usw. mit Restanteil. „auto“ erkennt passende Sensoren,
  // „manuell“ zeigt nur die im Editor festgelegten (wie angeheftete Szenen).
  const LEBENSDAUER_H = [[/haupt.?b(ü|u)rste/i, 300], [/seiten.?b(ü|u)rste/i, 200], [/sensor/i, 30], [/wisch|mop/i, 180], [/filter/i, 150]]; // Roborock-Vorgaben
  const MATERIAL_RE = /filter|b(ü|u)rste|sensorzeit|wischtuch|mopp?|staubbeutel|verbrauchsmaterial/i;
  const MATERIAL_NICHT = /zahnb(ü|u)rste|reinigungszeit|anzahl|gesamt|feinstaub|status|fehler/i;
  PS.verbrauchsmaterial = () => {
    const eintrag = (e) => {
      const v = Number(PS.s(e)), einheit = PS.a(e).unit_of_measurement, n = PS.name(e);
      let rest = null, text = PS.text(e);
      if (einheit === "%" && isFinite(v)) rest = v / 100;
      else if (einheit === "h" && isFinite(v)) {
        const soll = (LEBENSDAUER_H.find(([re]) => re.test(e + " " + n)) || [])[1];
        rest = soll ? Math.min(1, v / soll) : null;
        text = v >= 48 ? `${Math.round(v / 24)} Tage` : `${Math.round(v)} h`;
      }
      return { e, rest, text, name: n.replace(/verbleibende (zeit (der|des) )?/i, "").replace(/\s+/g, " ").trim() };
    };
    if (PS.einst.material_modus === "manuell") return (PS.einst.material_fest || []).filter((e) => PS.z[e]).map(eintrag);
    const kandidaten = alle().filter((e) => e.startsWith("sensor.") && PS.sichtbar(e) && !PS.nichtDa(e)
      && MATERIAL_RE.test(e + " " + PS.name(e)) && !MATERIAL_NICHT.test(e + " " + PS.name(e)) && ["%", "h"].includes(PS.a(e).unit_of_measurement));
    // Doppelte Angaben (Prozent und „verbleibende Stunden“ desselben Filters): Prozent genügt
    return kandidaten.filter((e) => !(e.endsWith("_verbleibende_stunden") && kandidaten.includes(e.replace(/_verbleibende_stunden$/, ""))))
      .map(eintrag).sort((x, y) => (x.rest ?? 2) - (y.rest ?? 2));
  };
  function uebersicht(box) {
    const updates = alle().filter((e) => e.startsWith("update.") && PS.s(e) === "on" && PS.sichtbar(e));
    box.appendChild(gruppe(updates.length ? `Updates · ${updates.length}` : "Updates · alles aktuell", kachelRaster(updates)));
    const schwach = wartungsListe().batterien.filter((e) => Number(PS.s(e)) < 25);
    const binSchwach = alle().filter((e) => e.startsWith("binary_sensor.") && PS.a(e).device_class === "battery" && PS.s(e) === "on");
    box.appendChild(gruppe(schwach.length + binSchwach.length ? "Schwache Batterien" : "Batterien · alle über 25 %", kachelRaster([...schwach, ...binSchwach])));
    const material = PS.verbrauchsmaterial().map((x) => x.e);
    if (material.length) box.appendChild(gruppe("Verbrauchsmaterial", kachelRaster(material)));
    const probleme = alle().filter((e) => e.startsWith("binary_sensor.") && PS.a(e).device_class === "problem" && PS.s(e) === "on");
    if (probleme.length) box.appendChild(gruppe("Problem-Meldungen", kachelRaster(probleme)));
  }
  function batterien(box) {
    const { batterien } = wartungsListe();
    const l = E(`<div>${batterien.map((e) => { const v = Number(PS.s(e)); return `<div class="balken-zeile${v < 25 ? " niedrig" : ""}" data-eid="${PS.esc(e)}"><span>${PS.esc(PS.name(e))}</span><span class="w">${PS.zahl(v, 0)} %</span><div class="bar"><i style="width:${Math.max(2, v)}%"></i></div></div>`; }).join("")}</div>`);
    l.querySelectorAll("[data-eid]").forEach((z) => z.addEventListener("click", () => PS.mehrInfos(z.dataset.eid)));
    box.appendChild(gruppe(`Alle Batterien · ${batterien.length}`, l));
  }
  function erreichbar(box) {
    const weg = alle().filter((e) => PS.s(e) === "unavailable" && PS.sichtbar(e) && !["button", "scene", "event"].includes(PS.domain(e)));
    const nachBereich = {};
    weg.forEach((e) => { const b = PS.bereichVon(e) || "_"; (nachBereich[b] = nachBereich[b] || []).push(e); });
    if (!weg.length) box.appendChild(E('<div class="leer">Alle Geräte antworten.</div>'));
    Object.keys(nachBereich).sort().forEach((b) => box.appendChild(gruppe(b === "_" ? "Ohne Bereich" : PS.bereichName(b), kachelRaster(nachBereich[b].sort(sortName())))));
  }
  async function protokoll(box) {
    const liste = E('<div class="liste"><div class="leer">Protokoll wird geladen …</div></div>'); box.appendChild(liste);
    const start = new Date(Date.now() - 12 * 3600e3);
    try {
      const r = await PS.anfrage({ typ: "rest", pfad: `logbook/${start.toISOString()}` });
      const eintraege = (r || []).slice(-150).reverse();
      liste.innerHTML = eintraege.map((e) => `<div class="zeile"${e.entity_id ? ` data-eid="${PS.esc(e.entity_id)}"` : ""}>${e.entity_id && PS.z[e.entity_id] ? PS.icon(e.entity_id) : PS.ic("history")}<span class="n">${PS.esc(e.name || e.entity_id || "")}<small>${PS.esc(e.message || (e.state ? PS.text(e.entity_id || "", e.state) : ""))}</small></span><span class="w">${PS.uhrzeit(new Date(e.when))}</span></div>`).join("") || '<div class="leer">Keine Einträge.</div>';
      liste.querySelectorAll("[data-eid]").forEach((z) => z.addEventListener("click", () => { if (PS.z[z.dataset.eid]) PS.mehrInfos(z.dataset.eid); }));
    } catch (e) { liste.innerHTML = `<div class="leer">Protokoll nicht verfügbar: ${PS.esc(e.message)}</div>`; }
  }
  function automationen(box) {
    const auto = alle().filter((e) => (dom("automation")(e) || dom("script")(e)) && PS.sichtbar(e)).sort(sortName());
    box.appendChild(gruppe(`Automationen und Skripte · ${auto.length}`, kachelRaster(auto)));
  }
})();
