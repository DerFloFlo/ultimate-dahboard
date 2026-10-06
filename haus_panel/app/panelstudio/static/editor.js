/* Haus Eichner Panel – Editor (Ingress). */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MODULE = { raeume: "Räume", klima: "Klima", licht: "Licht", sicherheit: "Sicherheit", medien: "Medien", listen: "Listen", energie: "Energie", wartung: "Wartung", suche: "Suche" };
  const KARTEN = { meldung: "Panel-Meldungen", eil: "Eilmeldung", warnung: "Warnung", termin: "Termin", arbeit: "Fahrten", wetter: "Wetter", muell: "Müll", fertig: "Gerät fertig", lueften: "Lüften", pollen: "Pollen", eigen: "Eigener Hinweis", offen: "Türen und Fenster", akku: "Batterien", update: "Updates", waesche: "Waschmaschine", trockner: "Trockner", robo: "Saugroboter", beamer: "Beamer", musik: "Musik" };
  const ZAHLEN = ["verweildauer_s", "ruhe_nach_s", "bedienung_zurueck_s", "ruhe_helligkeit", "nacht_helligkeit", "ereignis_dauer_s", "ton_lautstaerke"];
  let daten = null, bereiche = [], ws = null, wsId = 1, moduleReihe = [];

  async function laden(nurStatus = false) {
    const r = await fetch("api/einstellungen");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const neu = await r.json();
    if (nurStatus && daten) { daten.verbunden = neu.verbunden; daten.panels = neu.panels; status(); return; }
    daten = neu;
    zeigen();
  }
  function status() {
    const st = $("#status");
    st.textContent = daten.verbunden ? `Verbunden · ${daten.panels} Anzeige${daten.panels === 1 ? "" : "n"} offen · ${daten.version}` : "Home Assistant nicht erreichbar";
    st.className = "status " + (daten.verbunden ? "ok" : "fehler");
  }
  const LOKAL = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-f:]+\]?|[^.]+|.+\.(local|lan|home|internal|fritz\.box))$/i;
  function adressen() {
    const hosts = [...(daten.hosts || [])];
    const h = location.hostname;
    if (h && LOKAL.test(h) && !hosts.includes(h)) hosts.unshift(h);
    if (!hosts.length) hosts.push("homeassistant.local");
    return hosts.map((x) => `http://${x.includes(":") ? "[" + x + "]" : x}:${daten.port}/?token=${encodeURIComponent(daten.token)}`);
  }
  function kopieren(text, knopf) {
    const fertig = () => { knopf.textContent = "Kopiert"; setTimeout(() => { knopf.textContent = "Kopieren"; }, 2000); };
    const notfall = () => {
      const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
      let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      t.remove(); if (ok) fertig(); else knopf.textContent = "Bitte lange drücken";
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(fertig, notfall); else notfall();
  }
  function adressenZeigen() {
    const ul = $("#adressen");
    ul.innerHTML = adressen().map((a, i) => `<li><a href="${esc(a)}" target="_blank" rel="noopener">${esc(a)}</a><button type="button" class="kopieren" data-i="${i}">Kopieren</button></li>`).join("");
    ul.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => kopieren(adressen()[+b.dataset.i], b)));
  }
  function zeigen() {
    const e = daten.einstellungen;
    adressenZeigen();
    ZAHLEN.forEach((k) => { $("#" + k).value = e[k]; });
    $("#animationen").checked = e.animationen !== false;
    $("#ton_hoch").checked = e.ton_hoch !== false;
    $("#schnellzugriff").value = (e.schnellzugriff || []).join("\n");
    $("#raum_schalter").value = Object.entries(e.raum_schalter || {}).map(([b, ids]) => `${b}: ${ids.join(", ")}`).join("\n");
    $("#szenen_angeheftet").value = (e.szenen_angeheftet || []).join("\n");
    $("#szenen_aus").value = (e.szenen_aus || []).join("\n");
    $("#material_modus").value = e.material_modus || "auto";
    ["material_fest", "wartung_ignorieren", "aussen_feuchte"].forEach((k) => { $("#" + k).value = (e[k] || []).join("\n"); });
    $("#gruss").checked = e.gruss !== false;
    moduleReihe = [...e.module, ...Object.keys(MODULE).filter((m) => !e.module.includes(m))].map((m) => ({ m, an: e.module.includes(m) }));
    modulListe();
    haken("#karten_aus", Object.entries(KARTEN), (k) => !(e.karten_aus || []).includes(k), "karte");
    raeume();
    $("#optionen").innerHTML = Object.entries(daten.optionen).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(Array.isArray(v) ? v.join(", ") || "–" : v || "–")}</dd>`).join("");
    status();
  }
  function raeume() {
    if (!daten || !bereiche.length) return;
    const e = daten.einstellungen, liste = bereiche.map((b) => [b.id, b.name]);
    haken("#start_raeume", liste, (k) => (e.start_raeume || []).includes(k), "start");
    haken("#bereiche_ausblenden", liste, (k) => (e.bereiche_ausblenden || []).includes(k), "aus");
  }
  function haken(sel, eintraege, an, praefix) {
    $(sel).innerHTML = eintraege.map(([k, t]) => `<label><input type="checkbox" id="${praefix}-${esc(k)}" value="${esc(k)}"${an(k) ? " checked" : ""}> ${esc(t)}</label>`).join("");
  }
  function gewaehlt(sel) { return [...document.querySelectorAll(sel + " input:checked")].map((i) => i.value); }
  function modulListe() {
    $("#module").innerHTML = moduleReihe.map((x, i) => `<li><input type="checkbox" id="mod-${x.m}" ${x.an ? "checked" : ""}><span>${MODULE[x.m]}</span><button type="button" data-i="${i}" data-r="-1" aria-label="nach oben">↑</button><button type="button" data-i="${i}" data-r="1" aria-label="nach unten">↓</button></li>`).join("");
    $("#module").querySelectorAll("input").forEach((inp, i) => inp.addEventListener("change", () => { moduleReihe[i].an = inp.checked; }));
    $("#module").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.i, j = i + +b.dataset.r; if (j < 0 || j >= moduleReihe.length) return;
      [moduleReihe[i], moduleReihe[j]] = [moduleReihe[j], moduleReihe[i]]; modulListe();
    }));
  }

  async function speichern(ev) {
    ev.preventDefault();
    const neu = {};
    ZAHLEN.forEach((k) => { neu[k] = Number($("#" + k).value); });
    neu.animationen = $("#animationen").checked;
    neu.ton_hoch = $("#ton_hoch").checked;
    neu.schnellzugriff = $("#schnellzugriff").value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    neu.raum_schalter = {};
    $("#raum_schalter").value.split("\n").forEach((z) => {
      const [b, rest] = z.split(":"); if (!b || !rest) return;
      neu.raum_schalter[b.trim()] = rest.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    });
    neu.szenen_angeheftet = $("#szenen_angeheftet").value.split(/\s+/).map((x) => x.trim()).filter(Boolean);
    neu.szenen_aus = $("#szenen_aus").value.split(/\s+/).map((x) => x.trim()).filter(Boolean);
    neu.material_modus = $("#material_modus").value;
    ["material_fest", "wartung_ignorieren", "aussen_feuchte"].forEach((k) => { neu[k] = $("#" + k).value.split(/\s+/).map((x) => x.trim()).filter(Boolean); });
    neu.gruss = $("#gruss").checked;
    neu.module = moduleReihe.filter((x) => x.an).map((x) => x.m);
    neu.karten_aus = Object.keys(KARTEN).filter((k) => !gewaehlt("#karten_aus").includes(k));
    if (bereiche.length) { neu.start_raeume = gewaehlt("#start_raeume"); neu.bereiche_ausblenden = gewaehlt("#bereiche_ausblenden"); }
    const r = await fetch("api/einstellungen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(neu) });
    const out = $("#gespeichert");
    if (!r.ok) { out.textContent = "Nicht gespeichert: HTTP " + r.status; return; }
    const j = await r.json();
    daten.einstellungen = j.einstellungen; zeigen();
    out.textContent = j.abgewiesen && j.abgewiesen.length ? `Gespeichert. Nicht übernommen: ${j.abgewiesen.join(", ")}` : `Gespeichert um ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}. Die Panels übernehmen es sofort.`;
  }

  // WebSocket nur für Entitätsliste, Bereiche und den Ereignistest
  function verbinden() {
    const url = new URL("api/ws", location.href); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.typ === "init") {
        bereiche = m.bereiche || [];
        $("#entitaeten").innerHTML = Object.keys(m.zustaende || {}).sort().map((e) => `<option value="${esc(e)}">${esc((m.zustaende[e].a || {}).friendly_name || "")}</option>`).join("");
        raeume();
      }
    };
    ws.onclose = () => setTimeout(verbinden, 3000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#form").addEventListener("submit", speichern);
    $("#hinzu").addEventListener("click", () => {
      const v = $("#neu-entitaet").value.trim(); if (!v) return;
      $("#schnellzugriff").value = ($("#schnellzugriff").value.trim() + "\n" + v).trim(); $("#neu-entitaet").value = "";
    });
    $("#token-neu").addEventListener("click", async () => {
      const b = $("#token-neu");
      if (b.dataset.sicher !== "1") { b.dataset.sicher = "1"; b.textContent = "Wirklich? Nochmals klicken"; setTimeout(() => { b.dataset.sicher = ""; b.textContent = "Neuen Schlüssel erzeugen"; }, 4000); return; }
      const r = await fetch("api/token", { method: "POST" }); const j = await r.json();
      daten.token = j.token; zeigen(); $("#token-hinweis").hidden = false; b.dataset.sicher = ""; b.textContent = "Neuen Schlüssel erzeugen";
    });
    $("#test-ereignis").addEventListener("click", () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ typ: "ereignis_test", id: wsId++ })); });
    laden().catch((e) => { $("#status").textContent = "Fehler: " + e.message; $("#status").className = "status fehler"; });
    verbinden();
    setInterval(() => laden(true).catch(() => {}), 20000);
  });
})();
