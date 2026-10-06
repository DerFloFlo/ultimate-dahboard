/* Haus Eichner Panel – Modulseiten im Drei-Spalten-Muster (wie die Raumansicht): links der Gesamtzustand, Mitte die
   häufigste Bedienung, rechts Ergänzendes. Die bisherigen vollständigen Listen bleiben unter „Alle …“ erreichbar. */
(function () {
  "use strict";
  const PS = window.PS;
  const E = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const alle = () => Object.keys(PS.z);
  const dom = (d) => (e) => PS.domain(e) === d;
  const nameSort = (x, y) => PS.name(x).localeCompare(PS.name(y), "de");
  const num = (e) => Number(PS.s(e));

  // ------------------------------------------------------------ Bausteine
  const box = (titel, klein) => E(`<section class="r-box"><h3><span>${PS.esc(titel)}</span>${klein ? `<small>${PS.esc(klein)}</small>` : ""}</h3></section>`);
  const raster = (ids, klasse = "mini", bereichName) => {
    const r = E(`<div class="raster ${klasse}">${ids.map((e, i) => PS.kachelHTML(e, { i, bereich: bereichName })).join("")}</div>`);
    return r;
  };
  // Ring immer quadratisch (aspect-ratio), damit er im echten Render nicht gestaucht wird
  const ring = (anteil, farbe, wert, unter) => E(`<div class="ring r-ring" style="--farbe:${farbe}">${PS.ringSVG(anteil)}<div class="innen"><b class="tabular">${PS.esc(wert)}</b>${unter ? `<small>${PS.esc(unter)}</small>` : ""}</div></div>`);
  const knopf = (text, icon, fn, klasse = "") => { const b = E(`<button class="knopf ${klasse}">${icon ? PS.ic(icon) : ""}<span>${PS.esc(text)}</span></button>`); if (fn) b.addEventListener("click", fn); return b; };
  const balken = (name, wert, anteil, farbe, eid) => {
    const z = E(`<div class="balken-zeile"${eid ? ` data-eid="${PS.esc(eid)}"` : ""}><span>${PS.esc(name)}</span><span class="w">${PS.esc(wert)}</span><div class="bar"><i style="width:${Math.max(1, Math.min(100, anteil * 100))}%${farbe ? `;background:${farbe}` : ""}"></i></div></div>`);
    if (eid) z.addEventListener("click", () => PS.mehrInfos(eid));
    return z;
  };
  const alleKnopf = (text, modul) => knopf(text, "view-grid-outline", () => PS.unterseite(`${PS.module[modul].titel} · alle`, (el) => PS.module[modul]._alle(el)), "r-alles");
  function seite(el, modul) {
    el.classList.add("raumseite");
    const g = E('<div class="raum-ansicht"><div class="r-spalte"></div><div class="r-spalte"></div><div class="r-spalte"></div></div>');
    el.appendChild(g);
    return g.children;
  }

  // ------------------------------------------------------------ Klima
  function klima(el) {
    const [l, m, r] = seite(el, "klima");
    m.parentElement.classList.add("breit-mitte");
    const thermo = alle().filter(dom("climate")).filter((e) => PS.sichtbar(e) && !PS.nichtDa(e)).sort(nameSort);
    const ist = thermo.map((e) => PS.a(e).current_temperature).filter((v) => v != null);
    const innen = ist.length ? ist.reduce((a, b) => a + b, 0) / ist.length : null;
    const w = PS.opt.wetter_entitaet, aussen = PS.opt.aussentemperatur && PS.z[PS.opt.aussentemperatur] ? num(PS.opt.aussentemperatur) : PS.a(w).temperature;
    const b1 = box("Zuhause", PS.z["input_boolean.pm_heizperiode"] ? (PS.s("input_boolean.pm_heizperiode") === "on" ? "Heizperiode" : "Sommerbetrieb") : "");
    const kopf = E('<div class="r-zustand"></div>');
    kopf.append(ring(innen != null ? (innen - 15) / 10 : null, "var(--warn)", innen != null ? PS.zahl(innen, 1) + "°" : "–", "innen"),
      E(`<div><div class="r-zahl tabular">${aussen != null ? PS.zahl(aussen, 1) + "°" : "–"}<small> außen</small></div><div class="r-unter">${PS.esc(PS.z[w] ? PS.text(w) : "")}</div></div>`));
    b1.appendChild(kopf);
    const schalter = ["input_boolean.pm_heizperiode", ...alle().filter((e) => e.startsWith("switch.pm_") && PS.sichtbar(e)).sort(nameSort)].filter((e) => PS.z[e]);
    if (schalter.length) b1.appendChild(raster(schalter));
    l.appendChild(b1);
    if (PS.z["sensor.pm_klima_empfehlung"]) {
      const b2 = box("Empfehlung", "PM Klima");
      b2.appendChild(E(`<div class="r-text">${PS.esc(PS.text("sensor.pm_klima_empfehlung"))}</div>`));
      l.appendChild(b2);
    }
    const b3 = box("Heizung", `${thermo.length} Räume`);
    const g = E('<div class="r-thermos"></div>');
    thermo.forEach((t) => { const c = PS.klimaSteuerung(t); c.classList.add("kompakt"); g.appendChild(c); });
    b3.appendChild(g);
    const pm = thermo.filter((t) => t.startsWith("climate.pm_"));
    if (pm.length) b3.appendChild(E('<div class="reihe"></div>')).append(
      knopf("Alle: Zurück zum Plan", "calendar-sync", () => PS.dienst("pm_heizung", "clear_overlay", { entity_id: pm }).then(() => PS.toast("Alle Räume wieder nach Plan"))));
    m.appendChild(b3);
    // Luft: ein Außenwert (lokale Wetterstation, DWD als Rückfall), innen je Raum und Messgröße ein Sensor
    const aussenF = (PS.einst.aussen_feuchte || []).find((e) => PS.z[e] && !PS.nichtDa(e) && isFinite(num(e)));
    const grenze = { carbon_dioxide: 1400, pm25: 50, humidity: 100 };
    const jeRaum = new Map();
    alle().filter((e) => e.startsWith("sensor.") && PS.sichtbar(e) && !PS.nichtDa(e) && isFinite(num(e)) && grenze[PS.a(e).device_class])
      .filter((e) => { const b = PS.bereichVon(e); return b && !/balkon|garten|terrasse|aussen|außen/i.test(b + " " + PS.bereichName(b)); })
      .sort(nameSort)
      .forEach((e) => { const k = PS.bereichVon(e) + "|" + PS.a(e).device_class; if (!jeRaum.has(k)) jeRaum.set(k, e); });
    const innenLuft = [...jeRaum.values()].sort((x, y) => num(y) / grenze[PS.a(y).device_class] - num(x) / grenze[PS.a(x).device_class]).slice(0, aussenF ? 5 : 6);
    const b4 = box("Luft");
    if (aussenF) b4.appendChild(balken("Außen", PS.text(aussenF), num(aussenF) / 100, "var(--info)", aussenF));
    innenLuft.forEach((e) => {
      const dc = PS.a(e).device_class, a = num(e) / grenze[dc];
      const was = { carbon_dioxide: " · CO₂", pm25: " · Feinstaub", humidity: "" }[dc];
      b4.appendChild(balken(`${PS.bereichName(PS.bereichVon(e))}${was}`, PS.text(e), a, a > 0.7 ? "var(--warn)" : "var(--gut)", e));
    });
    if (aussenF || innenLuft.length) r.appendChild(b4);
    const ger = alle().filter((e) => (dom("fan")(e) || dom("humidifier")(e)) && PS.sichtbar(e));
    if (ger.length) { const b5 = box("Geräte"); b5.appendChild(raster(ger.sort(nameSort))); r.appendChild(b5); }
    r.appendChild(alleKnopf("Alle Klimawerte", "klima"));
  }

  // ------------------------------------------------------------ Licht
  function licht(el) {
    const [l, m, r] = seite(el, "licht");
    const bereiche = PS.bereiche.filter((b) => !(PS.einst.bereiche_ausblenden || []).includes(b.id));
    const je = bereiche.map((b) => ({ b, a: PS.lichtAuswahl(alle().filter((e) => PS.bereichVon(e) === b.id && PS.sichtbar(e)), b.name) })).filter((x) => x.a.raum || x.a.sichtbar.length);
    const einzel = je.flatMap((x) => x.a.sichtbar);
    const an = einzel.filter((e) => PS.s(e) === "on");
    const b1 = box("Gerade an");
    const kopf = E('<div class="r-zustand"></div>');
    kopf.append(ring(einzel.length ? an.length / einzel.length : 0, "#ffd58a", String(an.length), `von ${einzel.length}`),
      E(`<div class="r-unter">${PS.esc(je.filter((x) => x.a.sichtbar.some((e) => PS.s(e) === "on")).map((x) => `${x.b.name} ${x.a.sichtbar.filter((e) => PS.s(e) === "on").length}`).join(" · ") || "Alles aus")}</div>`));
    b1.appendChild(kopf);
    const aus = knopf(`Alle aus (halten)`, "lightbulb-group-off", null, "gefahr");
    PS.halten(aus, 1200, () => PS.dienst("light", "turn_off", { entity_id: an }).then(() => PS.toast("Alle Lichter aus")));
    if (an.length) b1.appendChild(aus);
    l.appendChild(b1);
    // Häufigste Szenen im ganzen Haus
    const stat = (PS.szenen || {}).stat || {}, h = new Date().getHours();
    const punkte = (e) => { const s = stat[e]; if (!s) return 0; let p = s.n; for (let d = -2; d <= 2; d++) p += (s.h[(h + d + 24) % 24] || 0) * (d === 0 ? 3 : 2); return p; };
    const szenen = alle().filter((e) => dom("scene")(e) && PS.sichtbar(e) && PS.s(e) !== "unavailable").sort((x, y) => punkte(y) - punkte(x)).slice(0, 6);
    if (szenen.length) { const b2 = box("Szenen", "am häufigsten"); b2.appendChild(raster(szenen)); l.appendChild(b2); }
    // Mitte: je Raum eine Kachel (Raumgruppe, sonst die einzige Lampe bzw. Untergruppe)
    const b3 = box("Räume", "Raumgruppen");
    const r3 = E('<div class="raster r-lichter"></div>');
    je.forEach(({ b, a }) => {
      const eid = a.raum || (a.sichtbar.length === 1 ? a.sichtbar[0] : null);
      if (eid) { r3.insertAdjacentHTML("beforeend", PS.kachelHTML(eid, { titel: b.name })); return; }
      const k = E(`<button class="kachel"><i class="mdi">${""}</i><b>${PS.esc(b.name)}</b><small>${a.sichtbar.filter((e) => PS.s(e) === "on").length} von ${a.sichtbar.length} an</small></button>`);
      k.querySelector(".mdi").outerHTML = PS.ic("lightbulb-group-outline");
      k.addEventListener("click", () => PS.module.raeume.unterseite(b.id));
      r3.appendChild(k);
    });
    b3.appendChild(r3);
    m.appendChild(b3);
    const auto = alle().filter((e) => dom("automation")(e) && PS.sichtbar(e) && /licht|lamp|light/i.test(e + " " + PS.name(e))).sort(nameSort).slice(0, 6);
    if (auto.length) { const b4 = box("Automatik"); b4.appendChild(raster(auto)); r.appendChild(b4); }
    r.appendChild(alleKnopf("Alle Lampen", "licht"));
  }

  // ------------------------------------------------------------ Sicherheit
  function sicherheit(el) {
    const [l, m, r] = seite(el, "sicherheit");
    const alarm = alle().filter(dom("alarm_control_panel")).filter(PS.sichtbar);
    // Hauptanlage aus den Optionen zuerst, weitere Anlagen (z. B. Alarm Oma) darunter
    const haupt = PS.opt.alarm_entitaet;
    alarm.sort((x, y) => (y === haupt) - (x === haupt)).slice(0, 2).forEach((a) => l.appendChild(PS.alarmSteuerung(a)));
    const zugang = [...alle().filter(dom("lock")), ...(PS.opt.tueroeffner && PS.z[PS.opt.tueroeffner] ? [PS.opt.tueroeffner] : [])].filter(PS.sichtbar);
    const rauch = rauchmelderBox(); if (rauch) l.appendChild(rauch);
    if (zugang.length) { const b = box("Zugang"); b.appendChild(raster(zugang)); l.appendChild(b); }
    const bs = (k) => alle().filter((e) => e.startsWith("binary_sensor.") && PS.sichtbar(e) && !PS.nichtDa(e) && k.includes(PS.a(e).device_class));
    const kontakte = bs(["door", "window", "opening", "garage_door"]).sort((x, y) => (PS.s(y) === "on") - (PS.s(x) === "on") || nameSort(x, y));
    const offen = kontakte.filter((e) => PS.s(e) === "on").length;
    const b2 = box("Türen und Fenster", offen ? `${offen} offen` : "alles zu");
    b2.appendChild(raster(kontakte.slice(0, 9), "mini r3"));
    const bew = bs(["motion", "occupancy", "presence"]).sort((x, y) => (PS.s(y) === "on") - (PS.s(x) === "on") || (Date.parse(PS.st(y).lc) || 0) - (Date.parse(PS.st(x).lc) || 0));
    b2.appendChild(E('<h3 class="unter"><span>Bewegung</span></h3>'));
    b2.appendChild(raster(bew.slice(0, 6), "mini r3"));
    m.appendChild(b2);
    const kam = PS.opt.ereignis_kamera && PS.z[PS.opt.ereignis_kamera] ? PS.opt.ereignis_kamera : alle().find((e) => dom("camera")(e) && PS.sichtbar(e));
    if (kam) {
      const b3 = box(PS.name(kam), "antippen für Live");
      const k = E(`<div class="kamera"><img alt=""><span>${PS.esc(PS.name(kam))}</span></div>`);
      k.addEventListener("click", () => PS.mehrInfos(kam));
      b3.appendChild(k); r.appendChild(b3);
      setTimeout(() => PS.kameraVorschau(k.querySelector("img"), kam), 50);
    }
    r.appendChild(aufnahmenBox());
    const b4 = box("Letzte Ereignisse");
    const liste = E('<div class="liste"><div class="leer">Wird geladen …</div></div>');
    b4.appendChild(liste); r.appendChild(b4);
    const relevant = new Set([...kontakte, ...bew, ...zugang, ...alarm, ...(PS.opt.ereignis_ausloeser || [])]);
    PS.anfrage({ typ: "rest", pfad: `logbook/${new Date(Date.now() - 12 * 3600e3).toISOString()}` }).then((res) => {
      const ev = (res || []).filter((x) => relevant.has(x.entity_id)).slice(-6).reverse();
      liste.innerHTML = ev.map((x) => `<div class="zeile">${PS.z[x.entity_id] ? PS.icon(x.entity_id) : PS.ic("history")}<span class="n">${PS.esc(x.name || x.entity_id)}<small>${PS.esc(x.message || PS.text(x.entity_id, x.state))}</small></span><span class="w">${PS.uhrzeit(new Date(x.when))}</span></div>`).join("") || '<div class="leer">Keine Ereignisse in den letzten 12 Stunden.</div>';
    }).catch(() => { liste.innerHTML = '<div class="leer">Protokoll nicht verfügbar.</div>'; });
    r.appendChild(alleKnopf("Alle Melder und Kameras", "sicherheit"));
  }

  // ------------------------------------------------------------ Rauchmelder (Sicherheit)
  // Je Melder: Zustand, Batterie (Batterie-Melder oder Prozentsensor desselben Geräts) und Testalarm-Knopf des Geräts
  const geraetVon = (e) => (PS.reg[e] || {}).d;
  const geschwister = (e) => { const d = geraetVon(e); return d ? Object.keys(PS.reg).filter((x) => x !== e && PS.reg[x].d === d && PS.z[x]) : []; };
  const etageVon = (e) => { const b = PS.bereiche.find((x) => x.id === PS.bereichVon(e)); return b ? { name: b.etage || "Ohne Etage", level: b.etage_level ?? -99, raum: b.name } : { name: "Ohne Etage", level: -99, raum: "" }; };
  function rauchmelderDaten() {
    return alle().filter((e) => e.startsWith("binary_sensor.") && PS.a(e).device_class === "smoke" && !/smokedetectionsystem/.test(e)).map((e) => {
      const g = geschwister(e);
      const battBin = g.find((x) => x.startsWith("binary_sensor.") && PS.a(x).device_class === "battery");
      const battPct = g.find((x) => x.startsWith("sensor.") && PS.a(x).device_class === "battery" && isFinite(num(x)));
      const test = g.find((x) => x.startsWith("button.") && /test/.test(x));
      const weg = PS.nichtDa(e), alarm = PS.s(e) === "on";
      const schwach = (battBin && PS.s(battBin) === "on") || (battPct && num(battPct) < 20);
      const et = etageVon(e);
      return { e, test, alarm, weg, schwach, et, name: PS.name(e).replace(/^(RM|Twinguard)\s+/i, "").replace(/\s*Rauch$/i, "").trim() || et.raum,
        batt: battPct ? `${PS.zahl(num(battPct), 0)} %` : battBin ? (PS.s(battBin) === "on" ? "schwach" : PS.s(battBin) === "off" ? "ok" : "–") : "–" };
    }).sort((x, y) => (y.alarm - x.alarm) || (y.weg - x.weg) || (y.schwach - x.schwach) || (y.et.level - x.et.level) || x.name.localeCompare(y.name, "de"));
  }
  function rauchmelderZeile(d, mitTest) {
    const st = d.alarm ? ["Rauch!", "var(--krit)", "smoke-detector-variant-alert"] : d.weg ? ["nicht erreichbar", "var(--warn)", "smoke-detector-variant-off"] : d.schwach ? ["Batterie schwach", "var(--warn)", "battery-alert-variant-outline"] : ["OK", "var(--gut)", "smoke-detector-variant"];
    const z = E(`<div class="zeile" data-eid="${PS.esc(d.e)}"><span style="color:${st[1]}">${PS.ic(st[2])}</span><span class="n">${PS.esc(d.name)}<small>${PS.esc(d.et.raum || d.et.name)} · Batterie ${PS.esc(d.batt)}</small></span><span class="w" style="color:${st[1]}">${PS.esc(st[0])}</span></div>`);
    z.addEventListener("click", (ev) => { if (!ev.target.closest(".knopf")) PS.mehrInfos(d.e); });
    if (mitTest && d.test && !d.weg) {
      const t = knopf("", "bell-ring-outline", null, "rund");
      t.setAttribute("aria-label", "Testalarm (2 s halten)");
      PS.halten(t, 2000, () => PS.dienst("button", "press", { entity_id: d.test }).then(() => PS.toast(`Testalarm: ${d.name}`)));
      z.appendChild(t);
    }
    return z;
  }
  function rauchmelderBox() {
    const daten = rauchmelderDaten();
    if (!daten.length) return null;
    const alarm = daten.filter((d) => d.alarm).length, problem = daten.filter((d) => d.weg || d.schwach).length;
    const b = box("Rauchmelder", `${daten.length} Melder`);
    const kopf = E('<div class="r-zustand"></div>');
    kopf.append(ring((daten.length - alarm - problem) / daten.length, alarm ? "var(--krit)" : problem ? "var(--warn)" : "var(--gut)", String(daten.length - alarm - problem), `von ${daten.length}`),
      E(`<div><div class="r-zahl klein">${alarm ? `${alarm} × Rauch erkannt` : problem ? `${problem} ${problem === 1 ? "Melder braucht" : "Melder brauchen"} Aufmerksamkeit` : "Alles ruhig"}</div><div class="r-unter">${alarm || problem ? "" : "Alle Melder bereit, Batterien in Ordnung."}</div></div>`));
    b.appendChild(kopf);
    const liste = E('<div class="liste"></div>');
    daten.filter((d) => d.alarm || d.weg || d.schwach).slice(0, 4).forEach((d) => liste.appendChild(rauchmelderZeile(d, false)));
    if (liste.children.length) b.appendChild(liste);
    b.appendChild(knopf("Alle Rauchmelder", "smoke-detector-variant", () => PS.unterseite("Rauchmelder", rauchmelderSeite), "r-alles"));
    return b;
  }
  function rauchmelderSeite(el) {
    const daten = rauchmelderDaten();
    el.classList.add("raumseite");
    const g = E('<div class="raum-ansicht rauchmelder"></div>');
    const etagen = [...new Map(daten.map((d) => [d.et.name, d.et.level])).entries()].sort((x, y) => y[1] - x[1]);
    etagen.forEach(([name]) => {
      const b = box(name, `${daten.filter((d) => d.et.name === name).length} Melder`);
      const liste = E('<div class="liste"></div>');
      daten.filter((d) => d.et.name === name).forEach((d) => liste.appendChild(rauchmelderZeile(d, true)));
      b.appendChild(liste); g.appendChild(b);
    });
    g.appendChild(E('<div class="r-unter">Testalarm: Glocke 2 Sekunden halten. Der Melder piept dabei laut.</div>'));
    el.appendChild(g);
  }

  // ------------------------------------------------------------ Signalstärke (Wartung)
  // Meross (%), Shelly & Co. (dBm), Bosch (Kommunikationsqualität), Zigbee (Linkqualität 0–255)
  const QUALI = { good: 1, normal: 0.6, bad: 0.15 };
  function signalDaten() {
    return alle().filter((e) => e.startsWith("sensor.") && !PS.nichtDa(e)).map((e) => {
      const a = PS.a(e), v = num(e), id = e.toLowerCase();
      let anteil = null, text = PS.text(e);
      if (a.device_class === "signal_strength" && /dbm/i.test(a.unit_of_measurement || "") && isFinite(v)) { anteil = Math.max(0, Math.min(1, (v + 100) / 60)); text = `${PS.zahl(v, 0)} dBm`; }
      else if (/signal_strength|wifi_signal|_signal$/.test(id) && a.unit_of_measurement === "%" && isFinite(v)) { anteil = v / 100; text = `${PS.zahl(v, 0)} %`; }
      else if (/communication_quality/.test(id) && PS.s(e) in QUALI) { anteil = QUALI[PS.s(e)]; text = { good: "gut", normal: "mittel", bad: "schlecht" }[PS.s(e)]; }
      else if (/linkquality|link_quality/.test(id) && isFinite(v)) { anteil = v / 255; text = `${PS.zahl(v, 0)} LQI`; }
      if (anteil == null) return null;
      const d = geraetVon(e);
      const name = (d && PS.geraete && PS.geraete[d]) || PS.name(e).replace(/\s*(Signal Strength|RSSI|Communication Quality|Signalstärke)$/i, "");
      return { e, anteil, text, name };
    }).filter(Boolean).sort((x, y) => x.anteil - y.anteil);
  }
  const signalFarbe = (a) => a < 0.3 ? "var(--krit)" : a < 0.5 ? "var(--warn)" : "var(--gut)";
  function signalBox() {
    const daten = signalDaten();
    if (!daten.length) return null;
    const schwach = daten.filter((d) => d.anteil < 0.3).length;
    const b = box("Signalstärke", schwach ? `${schwach} schwach` : "schwächste zuerst");
    daten.slice(0, 6).forEach((d) => b.appendChild(balken(d.name, d.text, d.anteil, signalFarbe(d.anteil), d.e)));
    if (daten.length > 6) b.appendChild(knopf(`Alle ${daten.length} Geräte`, "wifi-strength-4", () => PS.unterseite("Signalstärke", (el) => {
      const g = box("Signalstärke", `${daten.length} Geräte`);
      signalDaten().forEach((d) => g.appendChild(balken(d.name, d.text, d.anteil, signalFarbe(d.anteil), d.e)));
      el.appendChild(g);
    }), "r-alles"));
    return b;
  }

  // Aufnahmen der Reolink-Kamera (Medienquelle): heute und gestern, antippen spielt sie ab
  const ART = { person: "Person", motion: "Bewegung", vehicle: "Fahrzeug", pet: "Tier", animal: "Tier", visitor: "Klingel", face: "Gesicht", package: "Paket" };
  function aufnahmeZeile(a, tag) {
    const [uhr, dauer, ...arten] = String(a.titel || "").split(" ");
    const sek = (dauer || "").split(":").reduce((s, x) => s * 60 + Number(x || 0), 0);
    const was = [...new Set(arten.map((x) => ART[x.toLowerCase()] || x))].join(", ") || "Aufnahme";
    const z = E(`<div class="zeile">${PS.ic(/Person|Klingel|Gesicht/.test(was) ? "account-outline" : "motion-sensor")}<span class="n">${PS.esc(was)}<small>${PS.esc(tag)} · ${sek >= 60 ? `${Math.floor(sek / 60)} min ${sek % 60} s` : `${sek} s`}</small></span><span class="w tabular">${PS.esc((uhr || "").slice(0, 5))}</span></div>`);
    z.addEventListener("click", () => PS.aufnahmeZeigen(`${was} · ${(uhr || "").slice(0, 5)}`, tag, a.id));
    return z;
  }
  const tagName = (titel) => {
    const [j, m, t] = String(titel).split("/").map(Number), d = new Date(j, m - 1, t), h = new Date(); h.setHours(0, 0, 0, 0);
    const diff = Math.round((h - d) / 86400e3);
    return diff === 0 ? "Heute" : diff === 1 ? "Gestern" : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
  };
  async function tagLaden(t) { const r = await PS.anfrage({ typ: "aufnahmen", tag: t.id }); return ((r || {}).aufnahmen || []).slice().reverse(); }
  function aufnahmenBox() {
    const b = box("Aufnahmen", "antippen zum Abspielen");
    const liste = E('<div class="liste"><div class="leer">Wird geladen …</div></div>');
    b.appendChild(liste);
    PS.anfrage({ typ: "aufnahmen" }).then(async (res) => {
      const kam = ((res || {}).kameras || [])[0];
      if (!kam || !kam.tage.length) { liste.innerHTML = '<div class="leer">Keine Aufnahmen gefunden.</div>'; return; }
      const zeilen = [];
      for (const t of kam.tage.slice(0, 2)) { (await tagLaden(t)).forEach((a) => zeilen.push([a, tagName(t.titel)])); if (zeilen.length >= 5) break; }
      liste.innerHTML = zeilen.length ? "" : '<div class="leer">Heute und gestern keine Aufnahmen.</div>';
      zeilen.slice(0, 5).forEach(([a, tag]) => liste.appendChild(aufnahmeZeile(a, tag)));
      b.appendChild(knopf("Alle Aufnahmen", "filmstrip-box-multiple", () => PS.unterseite(`Aufnahmen · ${kam.titel}`, (el) => aufnahmenSeite(el, kam)), "r-alles"));
    }).catch(() => { liste.innerHTML = '<div class="leer">Aufnahmen nicht verfügbar.</div>'; });
    return b;
  }
  function aufnahmenSeite(el, kam) {
    const chips = E(`<div class="tabs r-chips" style="flex-wrap:wrap;margin-bottom:1.2rem">${kam.tage.slice(0, 14).map((t, i) => `<button data-i="${i}" class="${i === 0 ? "aktiv" : ""}">${PS.esc(tagName(t.titel))}</button>`).join("")}</div>`);
    const liste = E('<div class="liste r-aufnahmen"></div>');
    const zeigen = (i) => {
      chips.querySelectorAll("button").forEach((x) => x.classList.toggle("aktiv", Number(x.dataset.i) === i));
      liste.innerHTML = '<div class="leer">Wird geladen …</div>';
      const t = kam.tage[i];
      tagLaden(t).then((a) => { liste.innerHTML = a.length ? "" : '<div class="leer">An diesem Tag keine Aufnahmen.</div>'; a.forEach((x) => liste.appendChild(aufnahmeZeile(x, tagName(t.titel)))); })
        .catch(() => { liste.innerHTML = '<div class="leer">Aufnahmen nicht verfügbar.</div>'; });
    };
    chips.querySelectorAll("button").forEach((x) => x.addEventListener("click", () => zeigen(Number(x.dataset.i))));
    el.append(chips, liste);
    zeigen(0);
  }

  // ------------------------------------------------------------ Energie (nach dem eingebauten Energie-Dashboard)
  const FARBEN = ["#b07fd0", "#8fb4ff", "#5fd3a0", "#f0b44c", "#ef6a7a", "#d9a7ff", "#7fd3e8", "#C5C0D3"];
  const ZEITRAUM = { heute: "Heute", gestern: "Gestern", woche: "Woche", monat: "Monat" };
  let zeitraum = "heute";
  function grenzen(z) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    if (z === "gestern") { const s = new Date(t.getTime() - 86400e3); return [s, t, "hour"]; }
    if (z === "woche") { const s = new Date(t); s.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return [s, new Date(s.getTime() + 7 * 86400e3), "day"]; }
    if (z === "monat") { const s = new Date(t.getFullYear(), t.getMonth(), 1); return [s, new Date(t.getFullYear(), t.getMonth() + 1, 1), "day"]; }
    return [t, new Date(t.getTime() + 86400e3), "hour"];
  }
  async function energie(el) {
    const [l, m, r] = seite(el, "energie");
    let prefs;
    try { prefs = await PS.anfrage({ typ: "ws", befehl: { type: "energy/get_prefs" } }); } catch { prefs = null; }
    const geraete = (prefs && prefs.device_consumption) || [];
    const wasser = ((prefs && prefs.energy_sources) || []).filter((s) => s.type === "water");
    const gas = ((prefs && prefs.energy_sources) || []).filter((s) => s.type === "gas");
    const netz = ((prefs && prefs.energy_sources) || []).filter((s) => s.type === "grid");
    if (!geraete.length && !netz.length) {
      l.appendChild(E('<div class="leer">Im Energie-Dashboard von Home Assistant sind keine Geräte oder Zähler eingerichtet. Angezeigt wird nur die Leistung.</div>'));
    }
    // Links: Zeitraum, Summe, Wasser/Gas
    const b1 = box("Verbrauch");
    const chips = E(`<div class="tabs r-chips">${Object.entries(ZEITRAUM).map(([k, t]) => `<button data-k="${k}" class="${k === zeitraum ? "aktiv" : ""}">${t}</button>`).join("")}</div>`);
    chips.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { zeitraum = b.dataset.k; PS.neuZeichnen(); }));
    const summeEl = E('<div class="r-zahl tabular">…</div>');
    b1.append(chips, summeEl, E('<div class="r-unter">Summe der Geräte aus dem Energie-Dashboard</div>'));
    l.appendChild(b1);
    const wEl = wasser.length || gas.length ? box(wasser.length ? "Wasser" : "Gas") : null;
    if (wEl) l.appendChild(wEl);
    // Mitte: Diagramm
    const b2 = box("Verlauf", ZEITRAUM[zeitraum]);
    const dia = E('<div class="r-diagramm"><div class="leer">Wird geladen …</div></div>');
    const legende = E('<div class="r-legende"></div>');
    b2.append(dia, legende);
    m.appendChild(b2);
    // Rechts: Geräte mit Verbrauch und Leistung (Hierarchie wie im Energie-Dashboard)
    const b3 = box("Geräte", "Verbrauch · Leistung");
    r.appendChild(b3);
    r.appendChild(alleKnopf("Alle Zähler und Leistungen", "energie"));

    const [start, ende, periode] = grenzen(zeitraum);
    const ids = [...geraete.map((g) => g.stat_consumption), ...wasser.map((w) => w.stat_energy_from), ...gas.map((g) => g.stat_energy_from)];
    let stats = {};
    try {
      stats = (await PS.anfrage({ typ: "ws", befehl: { type: "recorder/statistics_during_period", start_time: start.toISOString(), end_time: ende.toISOString(), statistic_ids: ids, period: periode, types: ["change"] } })) || {};
    } catch { stats = {}; }
    const summe = (id) => (stats[id] || []).reduce((s, p) => s + (p.change || 0), 0);
    const oben = geraete.filter((g) => !g.included_in_stat);
    const gesamt = oben.reduce((s, g) => s + summe(g.stat_consumption), 0);
    summeEl.innerHTML = `${PS.zahl(gesamt, gesamt < 10 ? 2 : 1)}<small> kWh</small>`;
    if (wEl) {
      [...wasser, ...gas].forEach((w) => {
        const v = summe(w.stat_energy_from), e = w.stat_energy_from;
        const einheit = PS.z[e] ? PS.a(e).unit_of_measurement || "" : "m³";
        wEl.appendChild(balken(PS.z[e] ? PS.name(e) : e.split(":").pop().replace(/_/g, " "), `${PS.zahl(v, 2)} ${einheit}`, 1, "var(--info)", PS.z[e] ? e : null));
      });
    }
    // Geräte-Liste: Oberste Ebene, darunter enthaltene Geräte eingerückt
    const name = (g) => g.name || (PS.z[g.stat_consumption] ? PS.name(g.stat_consumption) : g.stat_consumption);
    const max = Math.max(0.001, ...geraete.map((g) => summe(g.stat_consumption)));
    const farbe = new Map(oben.map((g, i) => [g.stat_consumption, FARBEN[i % FARBEN.length]]));
    const zeile = (g, ein) => {
      const leistung = g.stat_rate && PS.z[g.stat_rate] ? ` · ${PS.text(g.stat_rate)}` : "";
      const z = balken(name(g), `${PS.zahl(summe(g.stat_consumption), 2)} kWh${leistung}`, summe(g.stat_consumption) / max, farbe.get(g.stat_consumption) || "var(--leise)", PS.z[g.stat_consumption] ? g.stat_consumption : g.stat_rate);
      if (ein) z.classList.add("eingerueckt");
      return z;
    };
    oben.sort((x, y) => summe(y.stat_consumption) - summe(x.stat_consumption)).forEach((g) => {
      b3.appendChild(zeile(g, false));
      geraete.filter((k) => k.included_in_stat === g.stat_consumption).forEach((k) => b3.appendChild(zeile(k, true)));
    });
    // Gestapeltes Säulendiagramm je Stunde bzw. Tag (oberste Ebene, wie im Energie-Dashboard)
    const zeiten = [...new Set(oben.flatMap((g) => (stats[g.stat_consumption] || []).map((p) => p.start)))].sort((a, b) => a - b);
    if (!zeiten.length) { dia.innerHTML = '<div class="leer">Für diesen Zeitraum liegen keine Werte vor.</div>'; return; }
    const werte = zeiten.map((t) => oben.map((g) => Math.max(0, ((stats[g.stat_consumption] || []).find((p) => p.start === t) || {}).change || 0)));
    const hoch = Math.max(0.001, ...werte.map((w) => w.reduce((a, b) => a + b, 0)));
    const W = 600, H = 220, B = W / zeiten.length;
    let svg = "";
    werte.forEach((w, i) => {
      let y = H - 18;
      w.forEach((v, j) => { const hh = (v / hoch) * (H - 34); y -= hh; if (hh > 0.3) svg += `<rect x="${(i * B + B * 0.15).toFixed(1)}" y="${y.toFixed(1)}" width="${(B * 0.7).toFixed(1)}" height="${hh.toFixed(1)}" rx="1.5" fill="${FARBEN[j % FARBEN.length]}"/>`; });
    });
    const label = (t) => (periode === "hour" ? `${new Date(t).getHours()}` : `${new Date(t).getDate()}.`);
    const schritt = Math.ceil(zeiten.length / 8);
    zeiten.forEach((t, i) => { if (i % schritt === 0) svg += `<text x="${(i * B + B / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">${label(t)}</text>`; });
    svg += `<text x="2" y="11">${PS.zahl(hoch, 2)} kWh</text>`;
    dia.innerHTML = `<svg class="diagramm saeulen" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg>`;
    legende.innerHTML = oben.map((g, j) => `<span><i style="background:${FARBEN[j % FARBEN.length]}"></i>${PS.esc(name(g))}</span>`).join("");
  }

  // ------------------------------------------------------------ Medien
  function medien(el) {
    const [l, m, r] = seite(el, "medien");
    const player = alle().filter(dom("media_player")).filter((e) => PS.sichtbar(e) && PS.s(e) !== "unavailable");
    const aktiv = player.filter((e) => PS.s(e) === "playing").concat(player.filter((e) => PS.s(e) === "paused"));
    if (aktiv[0]) l.appendChild(PS.medienSteuerung(aktiv[0], true));
    else { const b = box("Läuft gerade"); b.appendChild(E('<div class="leer">Gerade spielt nichts.</div>')); l.appendChild(b); }
    const tv = player.filter((e) => /tv|fire|samsung|fernseh/i.test(e + PS.name(e)));
    const lautsprecher = player.filter((e) => !tv.includes(e)).sort((x, y) => (PS.s(y) === "playing") - (PS.s(x) === "playing") || nameSort(x, y));
    const b2 = box("Lautsprecher", `${lautsprecher.filter((e) => PS.s(e) === "playing").length} spielen`);
    b2.appendChild(raster(lautsprecher.slice(0, 12), "mini r3"));
    if (tv.length) { b2.appendChild(E('<h3 class="unter"><span>Fernseher</span></h3>')); b2.appendChild(raster(tv.slice(0, 3), "mini r3")); }
    m.appendChild(b2);
    aktiv.slice(1, 3).forEach((p) => r.appendChild(PS.medienSteuerung(p, false)));
    const fern = alle().filter(dom("remote")).filter(PS.sichtbar);
    if (fern.length) { const b = box("Fernbedienungen"); b.appendChild(raster(fern)); r.appendChild(b); }
    r.appendChild(alleKnopf("Alle Player", "medien"));
  }

  // ------------------------------------------------------------ Listen
  function listen(el) {
    const [l, m, r] = seite(el, "listen");
    const todos = alle().filter(dom("todo")).filter(PS.sichtbar).sort((x, y) => (/einkauf|shopping/.test(y) - /einkauf|shopping/.test(x)) || nameSort(x, y));
    if (todos[0]) { const b = box(PS.name(todos[0]), `${PS.s(todos[0])} offen`); PS.baustein.todo(b, todos[0]); l.appendChild(b); }
    const b2 = box("Termine", "nächste 7 Tage"); PS.baustein.kalender(b2); m.appendChild(b2);
    const treffer = PS.z["sensor.pmn_angebote_treffer"];
    if (treffer) {
      const n = (PS.a("sensor.pmn_angebote_treffer").angebote || []).length, bring = (PS.a("sensor.pmn_angebote_treffer").bring || []).length;
      const b3 = box("Angebote", "Wunschliste");
      b3.appendChild(E(`<div class="r-zahl tabular">${n}<small> Treffer</small></div>`));
      b3.appendChild(E(`<div class="r-unter">${bring} davon auf der Einkaufsliste</div>`));
      r.appendChild(b3);
    }
    if (todos[1]) { const b4 = box(PS.name(todos[1]), `${PS.s(todos[1])} offen`); PS.baustein.todo(b4, todos[1]); r.appendChild(b4); }
    r.appendChild(alleKnopf("Alle Listen", "listen"));
  }

  // ------------------------------------------------------------ Wartung
  function wartung(el) {
    const [l, m, r] = seite(el, "wartung");
    // Systemzustand: Geräte, deren Entitäten alle nicht verfügbar sind (automatisch, ohne feste Liste)
    const ignoriert = new Set((PS.einst.wartung_ignorieren || []).map((e) => (PS.reg[e] || {}).d).filter(Boolean));
    const jeGeraet = new Map();
    Object.entries(PS.reg || {}).forEach(([e, r]) => {
      if (!r.d || !PS.z[e] || !(r.d in (PS.geraete || {})) || ignoriert.has(r.d)) return;
      if (!jeGeraet.has(r.d)) jeGeraet.set(r.d, []);
      jeGeraet.get(r.d).push(e);
    });
    const weg = [...jeGeraet.entries()].filter(([, es]) => es.every((e) => PS.s(e) === "unavailable"))
      .map(([d, es]) => ({ d, e: es.find((x) => !(PS.reg[x] || {}).ec) || es[0] }))
      .sort((x, y) => (Date.parse(PS.st(y.e).lc) || 0) - (Date.parse(PS.st(x.e).lc) || 0));
    const gesamt = jeGeraet.size, ok = gesamt - weg.length;
    const b1 = box("Systemzustand", "Geräte erreichbar");
    const kopf = E('<div class="r-zustand"></div>');
    kopf.append(ring(gesamt ? ok / gesamt : 1, weg.length ? "var(--warn)" : "var(--gut)", String(ok), `von ${gesamt}`),
      E(`<div><div class="r-zahl klein">${weg.length ? `${weg.length} ${weg.length === 1 ? "Gerät antwortet" : "Geräte antworten"} nicht` : "Alles nominal"}</div><div class="r-unter">${weg.length ? "" : "Alle Geräte melden sich."}</div></div>`));
    b1.appendChild(kopf);
    if (weg.length) b1.appendChild(E(`<div class="liste">${weg.slice(0, 5).map(({ d, e }) => `<div class="zeile" data-eid="${PS.esc(e)}">${PS.icon(e)}<span class="n">${PS.esc(PS.geraete[d] || PS.name(e))}<small>nicht erreichbar · ${PS.esc(PS.zeitRelativ(PS.st(e).lc))}</small></span></div>`).join("")}</div>`));
    b1.querySelectorAll("[data-eid]").forEach((z) => z.addEventListener("click", () => PS.mehrInfos(z.dataset.eid)));
    l.appendChild(b1);
    const upd = alle().filter((e) => e.startsWith("update.") && PS.s(e) === "on" && PS.sichtbar(e));
    const b2 = box("Updates", upd.length ? String(upd.length) : "alles aktuell");
    if (upd.length) b2.appendChild(raster(upd.slice(0, 6)));
    m.appendChild(b2);
    const batt = alle().filter((e) => e.startsWith("sensor.") && PS.a(e).device_class === "battery" && isFinite(num(e))).sort((x, y) => num(x) - num(y));
    const b3 = box("Batterien", "schwächste zuerst");
    batt.slice(0, 6).forEach((e) => b3.appendChild(balken(PS.name(e), `${PS.zahl(num(e), 0)} %`, num(e) / 100, num(e) < 20 ? "var(--krit)" : num(e) < 35 ? "var(--warn)" : null, e)));
    m.appendChild(b3);
    const mat = PS.verbrauchsmaterial();
    const b4 = box("Verbrauchsmaterial", PS.einst.material_modus === "manuell" ? "feste Auswahl" : "automatisch");
    mat.slice(0, 7).forEach(({ e, rest, text, name }) => b4.appendChild(balken(name, text, rest == null ? 1 : rest, rest == null ? null : rest < 0.1 ? "var(--krit)" : rest < 0.25 ? "var(--warn)" : "var(--gut)", e)));
    if (mat.length) r.appendChild(b4);
    const sig = signalBox(); if (sig) r.appendChild(sig);
    r.appendChild(alleKnopf("Protokoll, Batterien und Automationen", "wartung"));
  }


  // ------------------------------------------------------------ Luftqualität je Raum
  // Skalen mit Eskalationsfarben. Grenzen: CO₂ nach Pettenkofer/UBA-Leitwerten, Feinstaub nach dem Europäischen
  // Luftqualitätsindex, VOC nach UBA (ppb) bzw. Sensirion-Index, AQI nach US-EPA, Allergen-Index nach Philips (1–12).
  const STUFE = ["#5fd3a0", "#b5d86a", "#f0d34c", "#f0964c", "#ef6a7a"];
  const SKALEN = {
    carbon_dioxide: { n: "CO₂", e: "ppm", min: 400, max: 2500, g: [[800, 0, "sehr gut"], [1000, 1, "gut"], [1400, 2, "mäßig"], [2000, 3, "erhöht"], [1 / 0, 4, "hoch – lüften"]] },
    pm25: { n: "Feinstaub PM2,5", e: "µg/m³", min: 0, max: 75, g: [[5, 0, "sehr gut"], [15, 1, "gut"], [25, 2, "mäßig"], [50, 3, "schlecht"], [1 / 0, 4, "sehr schlecht"]] },
    pm10: { n: "Feinstaub PM10", e: "µg/m³", min: 0, max: 150, g: [[15, 0, "sehr gut"], [45, 1, "gut"], [50, 2, "mäßig"], [100, 3, "schlecht"], [1 / 0, 4, "sehr schlecht"]] },
    voc_ppb: { n: "VOC", e: "ppb", min: 0, max: 3000, g: [[220, 0, "sehr gut"], [660, 1, "gut"], [1430, 2, "mäßig"], [2200, 3, "erhöht"], [1 / 0, 4, "hoch"]] },
    voc_index: { n: "VOC-Index", e: "", min: 0, max: 500, g: [[100, 0, "normal"], [150, 1, "leicht erhöht"], [250, 2, "erhöht"], [400, 3, "hoch"], [1 / 0, 4, "sehr hoch"]] },
    aqi: { n: "AQI", e: "", min: 0, max: 300, g: [[50, 0, "gut"], [100, 1, "mäßig"], [150, 2, "für Empfindliche"], [200, 3, "ungesund"], [1 / 0, 4, "sehr ungesund"]] },
    allergen: { n: "Allergen-Index", e: "", min: 1, max: 12, g: [[3, 0, "niedrig"], [6, 2, "mittel"], [9, 3, "hoch"], [1 / 0, 4, "sehr hoch"]] },
    humidity: { n: "Luftfeuchte", e: "%", min: 20, max: 80, g: [[30, 4, "zu trocken"], [40, 2, "trocken"], [60, 0, "ideal"], [65, 2, "erhöht"], [70, 3, "feucht"], [1 / 0, 4, "Schimmelrisiko"]] },
  };
  const URTEIL = { gut: [0, "check-circle-outline", "Luft gut"], mittel: [2, "alert-circle-outline", "Luft mittel"], schlecht: [4, "alert-outline", "Luft schlecht"] };
  function skalaHTML(art, v) {
    const s = SKALEN[art], idx = s.g.findIndex(([bis]) => v < bis), [, st, txt] = s.g[idx];
    let ab = s.min;
    const seg = s.g.map(([bis, f], i) => { const ende = Math.min(bis, s.max), w = Math.max(0, ende - ab); ab = ende; return `<i class="${i === idx ? "jetzt" : ""}" style="flex:${w};--f:${STUFE[f]}"></i>`; }).join("");
    const pos = Math.max(0, Math.min(100, ((v - s.min) / (s.max - s.min)) * 100));
    return { stufe: STUFE[st], txt, html: `<div class="skala" style="--stufe:${STUFE[st]}">${seg}<b style="left:${pos}%"></b></div>` };
  }
  PS.luftBox = (b, ids) => {
    const box = luftBauen(b, ids); if (box) box._raum = [b, ids]; return box;
  };
  function luftBauen(b, ids) {
    const pm = PS.z[`sensor.pm_${b}_luftqualitaet`] ? `sensor.pm_${b}_luftqualitaet` : null;
    const pa = pm ? PS.a(pm) : {};
    const sensor = (dc) => ids.find((e) => e.startsWith("sensor.") && PS.a(e).device_class === dc && !PS.nichtDa(e) && isFinite(num(e)));
    const werte = [];
    const nimm = (art, eid, v) => { if (v != null && isFinite(v)) werte.push({ art, eid, v: Number(v) }); };
    const co2 = sensor("carbon_dioxide"); nimm("carbon_dioxide", co2 || pm, co2 ? num(co2) : pa.co2);
    const pm25 = sensor("pm25"); nimm("pm25", pm25 || pm, pm25 ? num(pm25) : pa.pm25);
    const pm10 = sensor("pm10"); if (pm10) nimm("pm10", pm10, num(pm10));
    const voc = sensor("volatile_organic_compounds_parts") || sensor("volatile_organic_compounds");
    if (voc) nimm(PS.a(voc).unit_of_measurement === "ppb" ? "voc_ppb" : "voc_index", voc, num(voc));
    const aqi = sensor("aqi"); if (aqi) nimm("aqi", aqi, num(aqi));
    const allergen = ids.find((e) => e.startsWith("sensor.") && /allergen/.test(e) && isFinite(num(e))); if (allergen) nimm("allergen", allergen, num(allergen));
    const feuchte = PS.raumWerte(b).feuchte ?? pa.feuchte_innen; nimm("humidity", pm, feuchte);
    if (!pm && werte.filter((w) => w.art !== "humidity").length === 0) return null;
    const box = E('<section class="r-box luft-box"><h3><span>Luftqualität</span><small></small></h3><div class="luft-kopf"></div><div class="luft-werte"></div></section>');
    const kopf = box.querySelector(".luft-kopf");
    if (pm) {
      const [st, icon, text] = URTEIL[PS.s(pm)] || [1, "information-outline", PS.text(pm)];
      const gruende = (pa.gruende || []).slice(0, 2).join(" · ") || (pa.lueften_noetig ? "Lüften empfohlen" : "Keine Auffälligkeiten");
      kopf.innerHTML = `<span class="luft-urteil" style="--stufe:${STUFE[st]}">${PS.ic(icon)}${PS.esc(text)}</span><span class="luft-gruende">${PS.esc(gruende)}</span>`;
      if (pa.taupunkt != null) box.querySelector("h3 small").textContent = `Taupunkt ${PS.zahl(pa.taupunkt, 1)}°`;
    } else kopf.remove();
    const liste = box.querySelector(".luft-werte");
    werte.forEach(({ art, eid, v }) => {
      const s = SKALEN[art], k = skalaHTML(art, v);
      const z = E(`<div class="luft-wert" style="--stufe:${k.stufe}"><span class="n">${s.n}</span><span class="v tabular">${PS.zahl(v, Number.isInteger(v) || ["carbon_dioxide", "aqi", "humidity"].includes(art) || v >= 100 ? 0 : 1)}${s.e ? `<small>${s.e}</small>` : ""}</span>${k.html}<span class="st">${PS.esc(k.txt)}</span></div>`);
      if (eid) z.addEventListener("click", () => PS.mehrInfos(eid));
      liste.appendChild(z);
    });
    box.dataset.luft = [pm, co2, pm25, pm10, voc, aqi, allergen].filter(Boolean).join(",");
    return box;
  }
  // Luftwerte an Ort und Stelle nachführen (Box neu aufbauen, ohne Einblendung)
  PS.on("diff", (ids) => {
    document.querySelectorAll(".luft-box[data-luft]").forEach((box) => {
      if (!box.dataset.luft.split(",").some((e) => ids.has(e)) || !box._raum) return;
      const neu = PS.luftBox(box._raum[0], box._raum[1]);
      if (neu) { neu.style.animation = "none"; box.replaceWith(neu); }
    });
  });

  // ------------------------------------------------------------ Einhängen: neue Seite, alte Liste unter „Alle …“
  const NEU = { klima, licht, sicherheit, energie, medien, listen, wartung };
  Object.entries(NEU).forEach(([k, fn]) => {
    const mod = PS.module[k]; if (!mod) return;
    mod._alle = mod.render;
    mod.render = (el, arg) => fn(el, arg);
  });
})();
