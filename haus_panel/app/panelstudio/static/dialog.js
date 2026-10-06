/* Haus Eichner Panel – Bediendialog „Mehr Infos“ je Gerätetyp, Schieber, Verlaufsdiagramm. */
(function () {
  "use strict";
  const PS = window.PS, $ = (s, r = document) => r.querySelector(s);
  let offenFuer = null;

  // ------------------------------------------------------------ Schieber (Tippen oder Ziehen, Wert beim Loslassen)
  PS.schieber = (o) => {
    const el = document.createElement("div");
    el.className = "schieber" + (o.klasse ? " " + o.klasse : "");
    el.innerHTML = `<div class="fuell"></div>${o.klasse === "ct" ? '<div class="marke"></div>' : ""}<div class="txt"><span>${PS.esc(o.label || "")}</span><span class="v"></span></div>`;
    let wert = o.wert;
    const setzen = (v) => {
      wert = Math.max(o.min, Math.min(o.max, Math.round(v / o.schritt) * o.schritt));
      el.style.setProperty("--pct", ((wert - o.min) / (o.max - o.min)) * 100 + "%");
      el.querySelector(".v").textContent = o.text ? o.text(wert) : wert;
    };
    setzen(wert ?? o.min);
    const ausPos = (ev) => { const r = el.getBoundingClientRect(); return o.min + ((ev.clientX - r.left) / r.width) * (o.max - o.min); };
    el.addEventListener("pointerdown", (ev) => { el.setPointerCapture(ev.pointerId); el.classList.add("zieht"); setzen(ausPos(ev)); });
    el.addEventListener("pointermove", (ev) => { if (el.classList.contains("zieht")) setzen(ausPos(ev)); });
    const fertig = () => { if (!el.classList.contains("zieht")) return; el.classList.remove("zieht"); o.beiEnde(wert); };
    el.addEventListener("pointerup", fertig); el.addEventListener("pointercancel", fertig);
    el.setzen = setzen;
    return el;
  };

  // ------------------------------------------------------------ Verlauf
  // Heizphasen eines Thermostats (hvac_action „heating“) als Zeitintervalle
  async function heizphasen(klima, start, ende) {
    const r = await PS.anfrage({ typ: "ws", befehl: { type: "history/history_during_period", start_time: start.toISOString(), end_time: ende.toISOString(), entity_ids: [klima], minimal_response: false, no_attributes: false, include_start_time_state: true, significant_changes_only: false } });
    const roh = ((r || {})[klima] || []).map((p) => [((p.lu || p.lc || 0) * 1000) || Date.parse(p.last_updated || p.last_changed), p.a || p.attributes || {}]).filter((p) => p[0]);
    const pkt = roh.map(([t, a]) => [t, a.hvac_action]);
    const phasen = [];
    let ab = null, letzte;
    pkt.forEach(([t, akt]) => {
      if (akt === undefined) akt = letzte; letzte = akt;
      if (akt === "heating" && ab == null) ab = Math.max(t, start.getTime());
      if (akt !== "heating" && ab != null) { phasen.push([ab, t]); ab = null; }
    });
    if (ab != null) phasen.push([ab, ende.getTime()]);
    // Isttemperatur des Thermostats, falls der Raum keinen eigenen Temperatursensor hat
    const temps = roh.map(([t, a]) => [t, Number(a.current_temperature)]).filter((p) => isFinite(p[1]));
    return { phasen, temps };
  }
  PS.diagramm = async (box, eid, stunden = 24, klima = null) => {
    box.innerHTML = '<div class="leer">Verlauf wird geladen …</div>';
    const ende = new Date(), start = new Date(ende - stunden * 3600e3);
    try {
      const eigen = PS.domain(eid) === "climate";
      const [r, hz] = await Promise.all([
        eigen ? {} : PS.anfrage({ typ: "ws", befehl: { type: "history/history_during_period", start_time: start.toISOString(), end_time: ende.toISOString(), entity_ids: [eid], minimal_response: true, no_attributes: true, include_start_time_state: true, significant_changes_only: false } }),
        klima ? heizphasen(klima, start, ende).catch(() => ({ phasen: [], temps: [] })) : { phasen: [], temps: [] },
      ]);
      const phasen = hz.phasen;
      const pkt = eid === klima ? hz.temps : ((r || {})[eid] || []).map((p) => [((p.lu || p.lc || 0) * 1000) || Date.parse(p.last_updated || p.last_changed), Number(p.s ?? p.state)]).filter((p) => isFinite(p[1]) && p[0]);
      if (pkt.length < 2) { box.innerHTML = '<div class="leer">Kein Zahlenverlauf vorhanden.</div>'; return; }
      pkt.push([ende.getTime(), pkt[pkt.length - 1][1]]);
      const xs = pkt.map((p) => p[0]), ys = pkt.map((p) => p[1]);
      const x0 = start.getTime(), x1 = ende.getTime(), lo = Math.min(...ys), hi = Math.max(...ys), sp = hi - lo || 1;
      const W = 600, H = 150, X = (x) => ((x - x0) / (x1 - x0)) * W, Y = (y) => H - 14 - ((y - lo) / sp) * (H - 34);
      let d = `M${X(xs[0]).toFixed(1)},${Y(ys[0]).toFixed(1)}`;
      for (let i = 1; i < pkt.length; i++) d += `H${X(xs[i]).toFixed(1)}V${Y(ys[i]).toFixed(1)}`;
      const einheit = eid === klima ? "°C" : PS.a(eid).unit_of_measurement || "";
      const baender = phasen.map(([a, b]) => `<rect class="heizt" x="${X(a).toFixed(1)}" y="0" width="${Math.max(1.5, X(b) - X(a)).toFixed(1)}" height="${H - 14}"/>`).join("");
      const heizMin = Math.round(phasen.reduce((s, [a, b]) => s + (b - a), 0) / 60e3);
      box.innerHTML = `<svg class="diagramm" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${baender}<defs><linearGradient id="verlauf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#784295"/><stop offset="1" stop-color="#784295" stop-opacity="0"/></linearGradient></defs>
        <path class="flaeche" d="${d}V${H}H0Z"/><path class="linie" d="${d}"/>
        <text x="4" y="12">${PS.zahl(hi)} ${PS.esc(einheit)}</text><text x="4" y="${H - 2}">${PS.zahl(lo)} ${PS.esc(einheit)}</text><text x="${W - 4}" y="${H - 2}" text-anchor="end">jetzt</text><text x="${W / 2}" y="${H - 2}" text-anchor="middle">−${stunden / 2} h</text></svg>${klima ? `<div class="heiz-legende"><i></i>${phasen.length ? `Geheizt: ${heizMin >= 60 ? `${Math.floor(heizMin / 60)} h ${heizMin % 60} min` : `${heizMin} min`} in ${stunden} h · ${phasen.slice(-3).map(([a, b]) => `${PS.uhrzeit(new Date(a))}–${b >= ende.getTime() - 60e3 ? "jetzt" : PS.uhrzeit(new Date(b))}`).join(", ")}` : `In den letzten ${stunden} h nicht geheizt`}</div>` : ""}`;
    } catch (e) { box.innerHTML = `<div class="leer">Verlauf nicht verfügbar: ${PS.esc(e.message)}</div>`; }
  };

  // ------------------------------------------------------------ Dialog
  function schliessen() {
    $("#dialog-grund").classList.remove("offen"); offenFuer = null;
    document.querySelectorAll("#dialog img").forEach(PS.kameraStoppen);
    PS.kameraLiveStoppen($("#dialog"));
    document.querySelectorAll("#dialog video.aufnahme").forEach((v) => { v.pause(); v.removeAttribute("src"); v.load(); });
  }
  PS.dialogSchliessen = schliessen;
  // Kameraaufnahme (Reolink-Medienquelle) im Dialog abspielen; die App reicht das Video samt Spulen durch
  PS.aufnahmeZeigen = (titel, unter, id) => {
    delete $("#dialog").dataset.popup; offenFuer = null;
    const dlg = $("#dialog");
    dlg.querySelectorAll("img").forEach(PS.kameraStoppen);
    PS.kameraLiveStoppen(dlg);
    dlg.innerHTML = `<div class="kopf">${PS.ic("filmstrip", "gr")}<h2>${PS.esc(titel)}<small>${PS.esc(unter)}</small></h2><button class="zu" aria-label="Schließen">${PS.ic("close")}</button></div>
      <video class="aufnahme" controls autoplay playsinline preload="auto" src="api/video?id=${encodeURIComponent(id)}"></video>`;
    dlg.querySelector(".zu").addEventListener("click", schliessen);
    const v = dlg.querySelector("video");
    v.addEventListener("error", () => v.insertAdjacentHTML("afterend", '<div class="leer">Die Aufnahme lässt sich nicht laden. Die Kamera schläft möglicherweise; ein zweiter Versuch hilft meist.</div>'), { once: true });
    $("#dialog-grund").classList.add("offen");
  };
  // Panel-Meldung wie an den Panels Büro und Bad: Symbol, Titel, Text, Zeit und Priorität, Bestätigen/Später bzw. OK.
  // Ein Browser-Mod-Popup mit gleicher Kennung liefert den ausführlichen Text und ggf. eine Kamera dazu.
  const M_ICON = { info: "information-outline", kohle: "fire", alarm: "shield-alert-outline", tuer: "door-open", lueften: "window-open-variant",
    warnung: "alert-outline", termin: "calendar-clock-outline", muell: "trash-can-outline", fertig: "check-circle-outline", wetter: "weather-partly-cloudy" };
  const M_FARBE = { high: "var(--krit)", normal: "var(--warn)", low: "var(--lavender)" };
  const M_PRIO = { high: "Priorität hoch", normal: "Priorität normal", low: "Priorität niedrig" };
  PS.meldungIcon = (icon) => M_ICON[icon] || "information-outline";
  PS.meldungFarbe = (prio) => M_FARBE[prio] || M_FARBE.normal;
  PS.popupZeigen = (id) => {
    const m = (PS.popups || []).find((x) => x.id === id); if (!m) return;
    offenFuer = null;
    const dlg = $("#dialog");
    dlg.querySelectorAll("img").forEach(PS.kameraStoppen);
    PS.kameraLiveStoppen(dlg);
    const zeit = new Date(m.seit * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    dlg.innerHTML = `<div class="meldung-ansicht" style="--farbe:${PS.meldungFarbe(m.prio)}">
      <button class="zu" aria-label="Schließen">${PS.ic("close")}</button>
      <div class="m-icon">${PS.ic(PS.meldungIcon(m.icon))}</div>
      <h2>${PS.esc(m.titel)}</h2>
      ${m.text ? `<p class="m-text">${PS.esc(m.text)}</p>` : ""}
      <div class="m-wann">${zeit} · ${M_PRIO[m.prio] || ""}</div></div>`;
    dlg.querySelector(".zu").addEventListener("click", () => { PS.tonStopp(); schliessen(); });
    if (m.details) { const md = document.createElement("div"); md.className = "md"; md.innerHTML = PS.markdown(m.details); dlg.appendChild(md); }
    if (m.kamera) { const k = document.createElement("div"); dlg.appendChild(k); PS.kameraLive(k, m.kamera); }
    const r = reihe(); r.classList.add("m-knoepfe");
    const ok = () => { PS.tonStopp(); return PS.anfrage({ typ: "popup_schliessen", popup: m.id }).catch(() => {}).then(schliessen); };
    if (m.bestaetigen) {
      r.appendChild(knopf("Bestätigen", "check", () => PS.tonStopp() || PS.dienst(PS.domain(m.bestaetigen), "press", { entity_id: m.bestaetigen }).then(() => { PS.toast("Bestätigt"); schliessen(); }), "gut"));
      r.appendChild(knopf("Später", "clock-outline", () => { PS.tonStopp(); schliessen(); }));
    } else {
      r.appendChild(knopf("OK", "check", ok, "primaer"));
    }
    // Zusätzliche Knöpfe des Popups (ohne Doppel zum Bestätigen-Knopf)
    m.knoepfe.filter((b) => b.domain && b.domain !== "browser_mod" && !(m.bestaetigen && (b.data || {}).entity_id === m.bestaetigen)).forEach((b) => {
      r.appendChild(knopf(b.text, null, () => PS.dienst(b.domain, b.service, b.data || {}).then(() => { PS.toast(`${b.text} ausgeführt`); schliessen(); })));
    });
    dlg.appendChild(r);
    $("#dialog-grund").classList.add("offen");
    dlg.dataset.popup = m.id;
  };
  PS.on("popups", () => {
    const dlg = $("#dialog"), id = dlg.dataset.popup;
    if (id && $("#dialog-grund").classList.contains("offen") && !(PS.popups || []).some((x) => x.id === id)) schliessen();
  });

  PS.mehrInfos = (eid) => {
    delete $("#dialog").dataset.popup; offenFuer = eid; zeichnen(true); $("#dialog-grund").classList.add("offen"); };
  PS.on("diff", (ids) => {
    if (offenFuer && PS.freigabe(offenFuer) && ids.has(PS.freigabe(offenFuer))) zeichnen(true);
    else if (offenFuer && ids.has(offenFuer)) zeichnen(false);
  });
  // Gesperrter Schalter: erst Freigabe erteilen (2 s halten), dann schalten (2 s halten). Die Freigabe läuft über
  // den Timer in Home Assistant ab; das Backend weist Schaltbefehle ohne Freigabe ebenfalls ab.
  function freigabeBedienung(box, eid) {
    const frei = PS.freigabe(eid), offen = PS.s(frei) === "on";
    const timer = "timer." + frei.split(".")[1], ende = PS.z[timer] && PS.s(timer) === "active" ? Date.parse(PS.a(timer).finishes_at) : null;
    box.appendChild(Object.assign(document.createElement("div"), {
      className: "freigabe-hinweis" + (offen ? " offen" : ""),
      innerHTML: `${PS.ic(offen ? "lock-open-variant-outline" : "lock-outline")}<span><b>${offen ? "Freigabe erteilt" : "Gesperrt"}</b><small>${offen ? (ende ? `Schalten möglich bis ${PS.uhrzeit(new Date(ende))}` : "Schalten jetzt möglich") : "Dieser Schalter versorgt Server und Router. Schalten nur mit Freigabe."}</small></span>`,
    }));
    if (!offen) {
      const b = knopf("Freigabe erteilen (halten)", "lock-open-alert-outline", null, "primaer");
      PS.halten(b, 2000, () => PS.dienst("input_boolean", "turn_on", { entity_id: frei }).then(() => PS.toast("Freigabe erteilt")));
      box.appendChild(reihe(b));
      return;
    }
    const b = knopf(PS.istAn(eid) ? "Ausschalten (halten)" : "Einschalten (halten)", "power", null, "gefahr");
    PS.halten(b, 2000, () => PS.dienst(PS.domain(eid), PS.istAn(eid) ? "turn_off" : "turn_on", { entity_id: eid }).then(() => PS.toast(`${PS.name(eid)} ${PS.istAn(eid) ? "aus" : "ein"}geschaltet`)));
    const zu = knopf("Freigabe zurücknehmen", "lock-outline", () => PS.dienst("input_boolean", "turn_off", { entity_id: frei }));
    box.appendChild(reihe(b, zu));
  }

  function knopf(text, icon, fn, klasse = "") {
    const b = document.createElement("button");
    b.className = "knopf " + klasse; b.innerHTML = (icon ? PS.ic(icon) : "") + (text ? `<span>${PS.esc(text)}</span>` : "");
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function reihe(...kinder) { const r = document.createElement("div"); r.className = "reihe"; kinder.filter(Boolean).forEach((k) => r.appendChild(k)); return r; }
  const svc = (d, s, data = {}) => () => PS.dienst(d, s, data);

  function zeichnen(neu) {
    const eid = offenFuer, st = PS.z[eid]; const dlg = $("#dialog");
    if (!st) { schliessen(); return; }
    // Bei laufender Bedienung (Schieber) nicht neu aufbauen; Kameras laufen weiter
    if (!neu && (dlg.querySelector(".schieber.zieht") || PS.domain(eid) === "camera" || PS.domain(eid) === "climate" || Date.now() - PS.letzteBeruehrung < 2500)) return;
    dlg.querySelectorAll("img").forEach(PS.kameraStoppen);
    PS.kameraLiveStoppen(dlg);
    const a = st.a || {}, d = PS.domain(eid), bereich = PS.bereichVon(eid);
    dlg.innerHTML = `<div class="kopf">${PS.icon(eid, "gr")}<h2>${PS.esc(PS.name(eid))}<small>${PS.esc([bereich && PS.bereichName(bereich), PS.text(eid), st.lc && "seit " + PS.zeitRelativ(st.lc).replace("vor ", "")].filter(Boolean).join(" · "))}</small></h2><button class="zu" aria-label="Schließen">${PS.ic("close")}</button></div>`;
    dlg.querySelector(".zu").addEventListener("click", schliessen);
    const box = document.createElement("div"); box.style.cssText = "display:flex;flex-direction:column;gap:1.1rem";
    dlg.appendChild(box);
    const E = { entity_id: eid };
    const unterstuetzt = (bit) => ((a.supported_features || 0) & bit) !== 0;

    switch (d) {
      case "light": {
        box.appendChild(reihe(knopf(st.s === "on" ? "Ausschalten" : "Einschalten", st.s === "on" ? "lightbulb-off-outline" : "lightbulb-on", svc("light", "toggle", E), "primaer")));
        const modi = a.supported_color_modes || [];
        if (modi.some((m) => m !== "onoff")) box.appendChild(PS.schieber({ label: "Helligkeit", min: 1, max: 100, schritt: 1, wert: st.s === "on" ? Math.round(((a.brightness || 255) / 255) * 100) : 0, text: (v) => v + " %", beiEnde: (v) => PS.dienst("light", "turn_on", { ...E, brightness_pct: v }) }));
        if (modi.includes("color_temp")) {
          const lo = a.min_color_temp_kelvin || 2200, hi = a.max_color_temp_kelvin || 6500;
          box.appendChild(PS.schieber({ klasse: "ct", label: "Farbtemperatur", min: lo, max: hi, schritt: 50, wert: a.color_temp_kelvin || Math.round((lo + hi) / 2), text: (v) => v + " K", beiEnde: (v) => PS.dienst("light", "turn_on", { ...E, color_temp_kelvin: v }) }));
        }
        if (modi.some((m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m))) {
          const f = document.createElement("div"); f.className = "farben";
          [[0, 100], [25, 100], [45, 100], [120, 80], [180, 80], [210, 90], [260, 80], [290, 70], [320, 70], [30, 30]].forEach(([h, s]) => {
            const b = document.createElement("button"); b.style.background = `hsl(${h} ${s}% 60%)`; b.setAttribute("aria-label", "Farbe");
            b.addEventListener("click", () => PS.dienst("light", "turn_on", { ...E, hs_color: [h, s] })); f.appendChild(b);
          });
          box.appendChild(f);
        }
        if (Array.isArray(a.entity_id) && a.entity_id.length) {
          const r = document.createElement("div"); r.className = "raster";
          r.innerHTML = a.entity_id.filter((m) => PS.z[m]).map((m, i) => PS.kachelHTML(m, { i, bereich: PS.bereichName(PS.bereichVon(m)) })).join("");
          const t = document.createElement("div"); t.className = "leer"; t.style.padding = "0"; t.textContent = "Einzeln steuern";
          box.append(t, r);
        }
        if (a.effect_list && a.effect_list.length) box.appendChild(reihe(...a.effect_list.slice(0, 12).map((ef) => knopf(ef, null, svc("light", "turn_on", { ...E, effect: ef }), a.effect === ef ? "aktiv" : ""))));
        break;
      }
      case "climate": box.appendChild(PS.klimaSteuerung(eid)); break;
      case "cover": {
        box.appendChild(reihe(knopf("Öffnen", "arrow-up", svc("cover", "open_cover", E)), knopf("Stopp", "stop", svc("cover", "stop_cover", E)), knopf("Schließen", "arrow-down", svc("cover", "close_cover", E))));
        if (a.current_position != null) box.appendChild(PS.schieber({ label: "Position", min: 0, max: 100, schritt: 5, wert: a.current_position, text: (v) => v + " %", beiEnde: (v) => PS.dienst("cover", "set_cover_position", { ...E, position: v }) }));
        if (a.current_tilt_position != null) box.appendChild(PS.schieber({ label: "Lamellen", min: 0, max: 100, schritt: 5, wert: a.current_tilt_position, text: (v) => v + " %", beiEnde: (v) => PS.dienst("cover", "set_cover_tilt_position", { ...E, tilt_position: v }) }));
        break;
      }
      case "fan": {
        box.appendChild(reihe(knopf(st.s === "on" ? "Ausschalten" : "Einschalten", "power", svc("fan", "toggle", E), "primaer")));
        if (a.percentage != null || unterstuetzt(1)) box.appendChild(PS.schieber({ label: "Stufe", min: 0, max: 100, schritt: a.percentage_step || 10, wert: a.percentage || 0, text: (v) => v + " %", beiEnde: (v) => PS.dienst("fan", "set_percentage", { ...E, percentage: v }) }));
        if (a.preset_modes) box.appendChild(reihe(...a.preset_modes.map((m) => knopf(m, null, svc("fan", "set_preset_mode", { ...E, preset_mode: m }), a.preset_mode === m ? "aktiv" : ""))));
        if (a.oscillating != null) box.appendChild(reihe(knopf(a.oscillating ? "Schwenken aus" : "Schwenken an", "arrow-oscillating", svc("fan", "oscillate", { ...E, oscillating: !a.oscillating }))));
        break;
      }
      case "media_player": box.appendChild(PS.medienSteuerung(eid, true)); break;
      case "lock": {
        const auf = knopf("Entriegeln (halten)", "lock-open-variant", null, "gefahr"); PS.halten(auf, 2000, svc("lock", "unlock", E));
        const r = reihe(knopf("Verriegeln", "lock", svc("lock", "lock", E), "primaer"), auf);
        if (unterstuetzt(1)) { const o = knopf("Öffnen (halten)", "door-open", null, "gefahr"); PS.halten(o, 2000, svc("lock", "open", E)); r.appendChild(o); }
        box.appendChild(r); break;
      }
      case "alarm_control_panel": box.appendChild(PS.alarmSteuerung(eid)); break;
      case "vacuum": {
        box.appendChild(reihe(knopf("Start", "play", svc("vacuum", "start", E), "primaer"), knopf("Pause", "pause", svc("vacuum", "pause", E)), knopf("Zur Station", "home-import-outline", svc("vacuum", "return_to_base", E)), knopf("Finden", "map-marker-question", svc("vacuum", "locate", E))));
        if (a.fan_speed_list) box.appendChild(reihe(...a.fan_speed_list.map((f) => knopf(f, null, svc("vacuum", "set_fan_speed", { ...E, fan_speed: f }), a.fan_speed === f ? "aktiv" : ""))));
        const knoepfe = Object.keys(PS.z).filter((b) => b.startsWith("button.") && PS.reg[b] && PS.reg[eid] && PS.reg[b].d && PS.reg[b].d === PS.reg[eid].d && PS.sichtbar(b));
        if (knoepfe.length) box.appendChild(reihe(...knoepfe.map((b) => knopf(PS.kurzname(b, PS.name(eid).split(" ")[0]), "gesture-tap-button", svc("button", "press", { entity_id: b })))));
        break;
      }
      case "camera": {
        const k = document.createElement("div"); box.appendChild(k); PS.kameraLive(k, eid); break;
      }
      case "number": case "input_number": {
        const min = Number(a.min ?? 0), max = Number(a.max ?? 100), step = Number(a.step ?? 1);
        box.appendChild(PS.schieber({ label: a.unit_of_measurement || "Wert", min, max, schritt: step, wert: Number(st.s), text: (v) => PS.zahl(v) + (a.unit_of_measurement ? " " + a.unit_of_measurement : ""), beiEnde: (v) => PS.dienst(d, "set_value", { ...E, value: v }) }));
        break;
      }
      case "select": case "input_select":
        box.appendChild(reihe(...(a.options || []).map((o) => knopf(o, null, svc(d, "select_option", { ...E, option: o }), st.s === o ? "aktiv" : "")))); break;
      case "input_text": {
        const f = document.createElement("input"); f.className = "feld"; f.value = st.s; f.maxLength = a.max || 255;
        box.appendChild(f); box.appendChild(reihe(knopf("Speichern", "content-save", () => PS.dienst("input_text", "set_value", { ...E, value: f.value }).then(() => PS.toast("Gespeichert")), "primaer")));
        break;
      }
      case "timer":
        box.appendChild(reihe(knopf("Start", "play", svc("timer", "start", E), "primaer"), knopf("Pause", "pause", svc("timer", "pause", E)), knopf("Abbrechen", "stop", svc("timer", "cancel", E)))); break;
      case "counter":
        box.appendChild(reihe(knopf("", "minus", svc("counter", "decrement", E), "rund"), knopf("", "plus", svc("counter", "increment", E), "rund"), knopf("Zurücksetzen", "restore", svc("counter", "reset", E)))); break;
      case "update":
        if (st.s === "on") box.appendChild(reihe(knopf(`Installieren (${a.latest_version || "neu"})`, "download", svc("update", "install", E), "primaer")));
        if (a.release_summary) { const p = document.createElement("div"); p.className = "leer"; p.textContent = a.release_summary; box.appendChild(p); }
        break;
      case "scene": box.appendChild(reihe(knopf("Aktivieren", "play", svc("scene", "turn_on", E), "primaer"))); break;
      case "script": box.appendChild(reihe(knopf("Ausführen", "play", svc("script", "turn_on", E), "primaer"), st.s === "on" ? knopf("Stoppen", "stop", svc("script", "turn_off", E)) : null)); break;
      case "automation": box.appendChild(reihe(knopf(st.s === "on" ? "Deaktivieren" : "Aktivieren", "power", svc("automation", "toggle", E)), knopf("Jetzt ausführen", "play", svc("automation", "trigger", E), "primaer"))); break;
      case "button": case "input_button": {
        const b = knopf("Auslösen", "gesture-tap-button", null, "primaer");
        if (eid === PS.opt.tueroeffner) PS.halten(b, 2000, svc(d, "press", E)); else b.addEventListener("click", svc(d, "press", E));
        box.appendChild(reihe(b)); break;
      }
      case "switch": case "input_boolean": case "siren": case "humidifier": case "valve":
        if (PS.freigabe(eid)) { freigabeBedienung(box, eid); break; }
        box.appendChild(reihe(knopf(PS.istAn(eid) ? "Ausschalten" : "Einschalten", "power", svc(d, "toggle", E), "primaer"))); break;
      case "weather": {
        const g = document.createElement("div"); g.className = "gross-wert"; g.textContent = `${PS.zahl(a.temperature, 1)}${a.temperature_unit || "°C"}`; box.appendChild(g);
        break;
      }
    }

    // Zahlen: Verlauf
    const zahlWert = st.s !== "" && isFinite(Number(st.s)) && ["sensor", "number", "input_number", "counter"].includes(d);
    if (d === "sensor" || d === "binary_sensor") { const g = document.createElement("div"); g.className = "gross-wert"; g.textContent = PS.text(eid); box.prepend(g); }
    if (zahlWert || d === "climate") {
      const v = document.createElement("div"); box.appendChild(v);
      const quelle = d === "climate" ? Object.keys(PS.reg).find((e) => PS.reg[e].b === bereich && e.startsWith("sensor.") && PS.a(e).device_class === "temperature") : eid;
      PS.diagramm(v, quelle || eid, 24, d === "climate" ? eid : null);
    }
    // Attribute
    const attrs = Object.entries(a).filter(([k]) => !["friendly_name", "icon", "entity_picture", "supported_features", "supported_color_modes", "_gross", "attribution"].includes(k));
    if (attrs.length) {
      const det = document.createElement("details");
      det.innerHTML = `<summary>Attribute (${attrs.length})</summary><dl class="attribute">${attrs.slice(0, 60).map(([k, v]) => `<dt>${PS.esc(k)}</dt><dd>${PS.esc(typeof v === "object" ? JSON.stringify(v).slice(0, 300) : v)}</dd>`).join("")}</dl>`;
      box.appendChild(det);
    }
    PS.kachelnBinden(dlg);
  }

  // ------------------------------------------------------------ Bausteine, die auch Module nutzen
  PS.klimaSteuerung = (eid) => {
    const st = PS.z[eid], a = st.a || {}, E = { entity_id: eid };
    const istPM = eid.startsWith("climate.pm_");
    const el = document.createElement("div"); el.className = "gross"; el.dataset.klima = eid;
    // In der kompakten Darstellung öffnet der Titel alle Modi (Dialog)
    setTimeout(() => { const t = el.querySelector(".titel"); if (t && el.classList.contains("kompakt")) t.addEventListener("click", () => PS.mehrInfos(eid)); }, 0);
    const soll = a.temperature, ist = a.current_temperature;
    const lo = a.min_temp ?? 5, hi = a.max_temp ?? 30, schritt = a.target_temp_step || 0.5;
    const anteil = ist != null ? (ist - lo) / (hi - lo) : null;
    const heizt = a.hvac_action === "heating";
    el.innerHTML = `<div class="titel">${PS.icon(eid)}<span>${PS.esc(PS.kurzname(eid).replace(/^PM\s+/, ""))}</span><small>${PS.esc(a.hvac_action === "heating" ? "heizt" : a.hvac_action === "idle" ? "bereit" : PS.text(eid, st.s))}${a.preset_mode ? " · " + PS.esc(a.preset_mode) : ""}</small></div>
      <div class="thermo"><div class="ring ${heizt ? "" : "kalt"}">${PS.ringSVG(anteil)}<div class="innen"><b class="tabular">${ist != null ? PS.zahl(ist, 1) + "°" : "–"}</b><small>${a.current_humidity != null ? PS.zahl(a.current_humidity, 0) + " % rF" : "Ist"}</small></div></div>
      <div class="spalte-r"><div class="soll"></div><div class="modi reihe"></div></div></div>`;
    let wunsch = soll, timer = null;
    const sollEl = el.querySelector(".soll");
    const anzeigen = () => { sollEl.querySelector("b").textContent = wunsch != null ? PS.zahl(wunsch, 1) + "°" : "–"; };
    const senden = () => {
      if (istPM) PS.dienst("pm_heizung", "set_overlay", { ...E, temperatur: wunsch, dauer: 120 }).then(() => PS.toast(`${PS.zahl(wunsch, 1)}° für 2 Stunden`));
      else PS.dienst("climate", "set_temperature", { ...E, temperature: wunsch });
    };
    const aendern = (delta) => { if (wunsch == null) return; wunsch = Math.max(lo, Math.min(hi, Math.round((wunsch + delta) / schritt) * schritt)); anzeigen(); clearTimeout(timer); timer = setTimeout(() => { timer = null; senden(); }, 1500); };
    const minus = knopf("", "minus", () => aendern(-schritt), "rund"), plus = knopf("", "plus", () => aendern(schritt), "rund");
    const b = document.createElement("b"); sollEl.append(minus, b, plus); anzeigen();
    const modi = el.querySelector(".modi");
    if (istPM) {
      modi.append(knopf("Boost 30 min", "fire", svc("pm_heizung", "boost", { ...E, dauer: 30 })), knopf("Zurück zum Plan", "calendar-sync", svc("pm_heizung", "clear_overlay", E)));
    }
    (a.preset_modes || []).forEach((m) => modi.appendChild(knopf(m, null, svc("climate", "set_preset_mode", { ...E, preset_mode: m }), a.preset_mode === m ? "aktiv" : "")));
    if (!istPM && (a.hvac_modes || []).length > 1) (a.hvac_modes || []).forEach((m) => modi.appendChild(knopf(PS.text(eid, m), null, svc("climate", "set_hvac_mode", { ...E, hvac_mode: m }), st.s === m ? "aktiv" : "")));
    // Aktualisierung an Ort und Stelle (kein Neuaufbau, laufende Eingaben bleiben)
    el.aktualisieren = () => {
      const n = PS.z[eid]; if (!n) return; const na = n.a || {};
      el.querySelector(".titel small").textContent = `${na.hvac_action === "heating" ? "heizt" : na.hvac_action === "idle" ? "bereit" : PS.text(eid, n.s)}${na.preset_mode ? " · " + na.preset_mode : ""}`;
      el.querySelector(".thermo .innen b").textContent = na.current_temperature != null ? PS.zahl(na.current_temperature, 1) + "°" : "–";
      el.querySelector(".thermo .ring").classList.toggle("kalt", na.hvac_action !== "heating");
      PS.ringSetzen(el.querySelector(".thermo .ring svg"), na.current_temperature != null ? (na.current_temperature - lo) / (hi - lo) : null);
      if (!timer) { wunsch = na.temperature; anzeigen(); }
      modi.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("aktiv", b.dataset.preset === na.preset_mode));
    };
    modi.querySelectorAll(".knopf").forEach((b) => { const t = b.textContent.trim(); if ((a.preset_modes || []).includes(t)) b.dataset.preset = t; });
    return el;
  };

  PS.medienSteuerung = (eid, gross) => {
    const st = PS.z[eid], a = st.a || {}, E = { entity_id: eid };
    const el = document.createElement("div"); el.className = "gross"; el.dataset.medien = eid; el.dataset.gross = gross ? "1" : "";
    const bild = a.entity_picture ? `style="background-image:url('${PS.esc(PS.bildUrl(a.entity_picture).replace(/&t=\d+/, ""))}')"` : "";
    el.innerHTML = `<div class="titel">${PS.icon(eid)}<span>${PS.esc(PS.name(eid))}</span><small>${PS.esc(PS.text(eid, st.s))}</small></div>
      ${gross || a.media_title ? `<div class="medien-bild" ${bild}>${bild ? "" : PS.ic("music-note")}</div>` : ""}
      ${a.media_title ? `<div><b style="font-size:1.4rem">${PS.esc(a.media_title)}</b><div class="leer" style="padding:0">${PS.esc([a.media_artist, a.media_album_name].filter(Boolean).join(" · "))}</div></div>` : ""}`;
    el.appendChild(reihe(
      knopf("", "skip-previous", svc("media_player", "media_previous_track", E), "rund"),
      knopf("", st.s === "playing" ? "pause" : "play", svc("media_player", "media_play_pause", E), "rund primaer"),
      knopf("", "skip-next", svc("media_player", "media_next_track", E), "rund"),
      knopf("", "power", svc("media_player", st.s === "off" ? "turn_on" : "turn_off", E), "rund"),
    ));
    if (a.volume_level != null) el.appendChild(PS.schieber({ label: "Lautstärke", min: 0, max: 100, schritt: 2, wert: Math.round(a.volume_level * 100), text: (v) => v + " %", beiEnde: (v) => PS.dienst("media_player", "volume_set", { ...E, volume_level: v / 100 }) }));
    if (gross && a.source_list && a.source_list.length) el.appendChild(reihe(...a.source_list.slice(0, 16).map((q) => knopf(q, null, svc("media_player", "select_source", { ...E, source: q }), a.source === q ? "aktiv" : ""))));
    return el;
  };

  PS.alarmSteuerung = (eid) => {
    const st = PS.z[eid], a = st.a || {}, E = { entity_id: eid };
    const el = document.createElement("div"); el.className = "gross"; el.dataset.alarm = eid;
    el.innerHTML = `<div class="titel">${PS.icon(eid)}<span>${PS.esc(PS.name(eid))}</span><small>${PS.esc(PS.text(eid))}</small></div>`;
    let code = "";
    el.codeAktiv = () => code.length > 0;
    const brauchtCode = !!a.code_format;
    const anzeige = document.createElement("div"); anzeige.className = "gross-wert"; anzeige.style.fontSize = "2.2rem";
    const zeig = () => { anzeige.textContent = brauchtCode ? (code ? "•".repeat(code.length) : "Code eingeben") : ""; };
    const mit = (data) => (brauchtCode && code ? { ...data, code } : data);
    const tun = (service) => PS.dienst("alarm_control_panel", service, mit(E)).then(() => { code = ""; zeig(); });
    const r = reihe();
    if (st.s === "disarmed") {
      r.append(knopf("Scharf · Zuhause", "shield-home", () => tun("alarm_arm_home"), "primaer"), knopf("Scharf · Abwesend", "shield-lock", () => tun("alarm_arm_away")), knopf("Scharf · Nacht", "shield-moon", () => tun("alarm_arm_night")));
    } else {
      const aus = knopf("Unscharf (halten)", "shield-off", null, "gefahr"); PS.halten(aus, 2000, () => tun("alarm_disarm")); r.append(aus);
    }
    if (brauchtCode) {
      el.appendChild(anzeige); zeig();
      const t = document.createElement("div"); t.className = "tastatur";
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].forEach((z) => {
        const b = document.createElement("button"); b.textContent = z;
        b.addEventListener("click", () => { if (z === "⌫") code = code.slice(0, -1); else if (z !== "✓") code = (code + z).slice(0, 12); zeig(); });
        t.appendChild(b);
      });
      el.appendChild(t);
    }
    el.appendChild(r);
    return el;
  };

  // Große Karten (Klima, Medien, Alarm) gezielt nachführen statt ganze Seiten neu aufzubauen
  PS.on("diff", (ids) => {
    document.querySelectorAll("[data-klima]").forEach((el) => { if (ids.has(el.dataset.klima) && el.aktualisieren) el.aktualisieren(); });
    document.querySelectorAll("[data-medien]").forEach((el) => {
      if (!ids.has(el.dataset.medien) || el.querySelector(".schieber.zieht") || !PS.z[el.dataset.medien]) return;
      el.replaceWith(PS.medienSteuerung(el.dataset.medien, !!el.dataset.gross));
    });
    document.querySelectorAll("[data-alarm]").forEach((el) => {
      if (!ids.has(el.dataset.alarm) || (el.codeAktiv && el.codeAktiv()) || !PS.z[el.dataset.alarm]) return;
      el.replaceWith(PS.alarmSteuerung(el.dataset.alarm));
    });
  });

  document.addEventListener("DOMContentLoaded", () => {
    $("#dialog-grund").addEventListener("click", (ev) => { if (ev.target.id === "dialog-grund") schliessen(); });
  });
})();
