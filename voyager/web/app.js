// Voyager — live browser viewer. Loads the REAL Cook journal (cook.json) and runs
// the actual MVP sim engine (voyager/src/sim/*) client-side, unmodified — this is not
// a canned replay. If that path fails for any reason (served over file://, a fetch
// error, an old browser) it falls back to the pre-baked voyager/output/voyage.json
// so the viewer still opens and plays something.
//
// Run with: `cd voyager && python3 -m http.server 8787` then open
// http://localhost:8787/web/  (see ../ITERATION.md for details).

const SHIP_ICON = "⛵";

const els = {
  status: document.getElementById("statusline"),
  map: document.getElementById("map"),
  playbook: document.getElementById("pc-playbook"),
  name: document.getElementById("pc-name"),
  seed: document.getElementById("pc-seed"),
  sail: document.getElementById("pc-sail"),
  gazette: document.getElementById("pc-gazette"),
  note: document.getElementById("pc-note"),
  todayDate: document.getElementById("today-date"),
  todayPlace: document.getElementById("today-place"),
  narration: document.getElementById("today-narration"),
  beats: document.getElementById("today-beats"),
  pcBox: document.getElementById("today-pc"),
  barMood: document.getElementById("bar-mood"),
  barHealth: document.getElementById("bar-health"),
  feed: document.getElementById("feed"),
  play: document.getElementById("play"),
  scrub: document.getElementById("scrub"),
  scrubLabel: document.getElementById("scrub-label"),
  speed: document.getElementById("speed"),
  gazetteModal: document.getElementById("gazette-modal"),
  gazetteFrame: document.getElementById("gazette-frame"),
  gazetteClose: document.getElementById("gazette-close"),
};

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const app = {
  mode: null,          // "live" | "static"
  views: [],           // normalized per-day records, see normalizeLive/normalizeStatic
  gazetteRecords: [],  // records shaped for buildGazette (same length/order as views)
  meta: null,
  idx: 0,
  playing: false,
  timer: null,
  pcName: null,
  // live-mode only:
  lib: null,           // { buildVoyage, createVoyage, sailTo, makeRng, narrateDayOffline,
                        //   hasContent, makePC, PLAYBOOKS, buildGazette }
  rawCook: null,
};

function serActor(p) { return p ? { name: p.name, role: p.role, isPC: !!p.isPC } : null; }
function serBeat(b) {
  return {
    kind: b.kind, summary: b.summary || null, salience: +(b.salience || 0).toFixed(2),
    incident: !!b.incident, pcInvolved: !!b.pcInvolved,
    actors: (b.actors || []).map(serActor).filter(Boolean),
  };
}

// Turn one live engine DayRecord into the flat shape the UI renders, plus keep the
// raw record (rec) around for the Gazette generator.
function normalizeLive(rec, narrationText, hasContentFn) {
  return {
    day: rec.day, date: rec.date, longDate: rec.longDate,
    lat: rec.leg.lat ?? null, lng: rec.leg.lon ?? null,
    place: rec.leg.place, region: rec.leg.region, phase: rec.leg.phase,
    avgMood: rec.avgMood, avgHealth: rec.avgHealth,
    narration: narrationText,
    incidents: rec.incidents.map(serBeat),
    rawEvents: rec.rawEvents.map(serBeat),
    deaths: rec.deaths,
    hasContent: hasContentFn(rec),
  };
}

// Same shape from the pre-baked voyage.json (fallback / static mode).
function normalizeStatic(d) {
  return {
    day: d.day, date: d.date, longDate: d.longDate,
    lat: d.lat, lng: d.lng, place: d.place, region: d.region, phase: d.phase,
    avgMood: d.avgMood, avgHealth: d.avgHealth,
    narration: d.narration, incidents: d.incidents, rawEvents: d.rawEvents, deaths: d.deaths,
    hasContent: d.hasContent,
  };
}

// ---------------------------------------------------------------------------
// Boot: try the LIVE path (real sim, runs in the browser), else fall back.
// ---------------------------------------------------------------------------
async function boot() {
  try {
    const res = await fetch("./cook.json");
    if (!res.ok) throw new Error("cook.json " + res.status);
    const rawCook = await res.json();

    const [
      { buildVoyage },
      { createVoyage, sailTo },
      { makeRng },
      { narrateDayOffline, hasContent },
      { makePC, PLAYBOOKS },
      { buildGazette },
    ] = await Promise.all([
      import("../data/voyage-build.js"),
      import("../src/sim/engine.js"),
      import("../src/util/rng.js"),
      import("../src/narrate/narrator.js"),
      import("../src/ttrpg/characters.js"),
      import("../src/artifacts/gazette.js"),
    ]);

    app.mode = "live";
    app.rawCook = rawCook;
    app.lib = { buildVoyage, createVoyage, sailTo, makeRng, narrateDayOffline, hasContent, makePC, PLAYBOOKS, buildGazette };
    populatePlaybooks(PLAYBOOKS);
    setStatus("live sim — real crew & journal, running in this tab");
    await runLiveVoyage({ seed: 7, pc: null });
  } catch (err) {
    console.warn("Live sim path failed, falling back to pre-baked voyage.json:", err);
    await runStaticFallback(err);
  }
}

function populatePlaybooks(PLAYBOOKS) {
  els.playbook.innerHTML = Object.keys(PLAYBOOKS)
    .map((k) => `<option value="${k}">${k.replace("_", " ")}</option>`).join("");
  els.playbook.value = "Surgeon";
}

function setStatus(s) { els.status.textContent = s; }

// ---------------------------------------------------------------------------
// LIVE mode: build + run the actual sim in-browser.
// ---------------------------------------------------------------------------
async function runLiveVoyage({ seed, pc }) {
  const { buildVoyage, createVoyage, sailTo, makeRng, narrateDayOffline, hasContent, makePC } = app.lib;
  const { VOYAGE } = buildVoyage(app.rawCook);
  const pcs = pc ? [makePC(pc)] : [];
  const state = createVoyage({ voyage: VOYAGE, seed, personality: "cassandra", pcs });
  sailTo(state, VOYAGE.end);

  const rng = makeRng(typeof seed === "string" ? hashStr(seed) : seed);
  app.views = state.log.map((rec) => normalizeLive(rec, narrateDayOffline(rec, rng), hasContent));
  app.gazetteRecords = state.log; // real records, directly compatible with buildGazette
  app.meta = { ship: VOYAGE.ship, captain: VOYAGE.captain, start: VOYAGE.start, end: VOYAGE.end };
  app.pcName = pc ? pc.name : null;
  finishLoad(pc ? `sailing with ★ ${pc.name} (${pc.playbook})` : "sailing (no character yet — pick one above)");
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// STATIC fallback: pre-baked voyager/output/voyage.json (no live re-sim).
// ---------------------------------------------------------------------------
async function runStaticFallback(err) {
  try {
    const res = await fetch("./voyage.json");
    if (!res.ok) throw new Error("voyage.json " + res.status);
    const data = await res.json();
    app.mode = "static";
    app.views = data.days.map(normalizeStatic);
    app.gazetteRecords = data.days.map((d) => ({
      ...d, leg: { place: d.place, region: d.region, phase: d.phase, lat: d.lat, lon: d.lng },
    }));
    app.meta = { ship: data.meta.ship, captain: data.meta.captain, start: data.meta.start, end: data.meta.end };
    app.pcName = data.meta.pc ? data.meta.pc.name : null;
    els.playbook.innerHTML = Object.keys(data.playbooks || { Surgeon: 1 })
      .map((k) => `<option value="${k}">${k.replace("_", " ")}</option>`).join("");
    els.sail.disabled = true;
    els.sail.title = "Live re-simulation needs the dev server, see ITERATION.md";
    els.note.textContent = "Static playback (pre-generated " + (data.meta.pc ? data.meta.pc.name + ", " + data.meta.pc.playbook : "no character") +
      "). Serve voyager/ over http:// for live in-browser character creation.";
    setStatus("static playback (fallback) — " + (err ? err.message : ""));
    finishLoad("");
  } catch (err2) {
    setStatus("failed to load voyage data: " + err2.message);
    els.narration.textContent = "Could not load cook.json or voyage.json. Run `node src/export.js` from voyager/ and/or serve voyager/ over http:// (see ITERATION.md).";
  }
}

function finishLoad(note) {
  if (note) els.note.textContent = note;
  els.scrub.max = String(app.views.length - 1);
  els.scrub.value = "0";
  app.idx = 0;
  buildMap();
  els.feed.innerHTML = "";
  renderDay(0, { rebuildFeed: true });
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
let map, routeLine, shipMarker;

function isValidPoint(v) {
  return v.lat != null && v.lng != null && !Number.isNaN(v.lat) && !Number.isNaN(v.lng) && !(v.lat === 0 && v.lng === 0);
}

function buildMap() {
  const points = app.views.filter(isValidPoint).map((v) => [v.lat, v.lng]);
  if (!map) {
    map = L.map(els.map, { zoomControl: true, worldCopyJump: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 18,
    }).addTo(map);
  } else {
    if (routeLine) routeLine.remove();
    if (shipMarker) shipMarker.remove();
  }
  routeLine = L.polyline(points, { color: "#2b5e8c", weight: 2.5, opacity: .8, dashArray: "5 7" }).addTo(map);
  if (points.length) map.fitBounds(routeLine.getBounds().pad(0.12));
  const icon = L.divIcon({ className: "ship-leaflet-marker", html: `<div class="ship-marker">${SHIP_ICON}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
  shipMarker = L.marker(points[0] || [0, 0], { icon }).addTo(map);
}

function moveShip(v) {
  if (!isValidPoint(v)) return;
  shipMarker.setLatLng([v.lat, v.lng]);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function beatEl(b, dateLabel) {
  const cls = ["beat"];
  if (b.incident) cls.push("incident");
  if (b.pcInvolved) cls.push("pc");
  const who = b.pcInvolved ? "★ " : "";
  return `<div class="${cls.join(" ")}">${dateLabel ? `<b>${esc(dateLabel)}.</b> ` : ""}${who}${esc(b.summary || b.kind)}</div>`;
}

function renderDay(i, { rebuildFeed = false } = {}) {
  const v = app.views[i];
  if (!v) return;
  app.idx = i;
  els.scrub.value = String(i);
  els.scrubLabel.textContent = `${v.longDate} · day ${i + 1}/${app.views.length}`;
  els.todayDate.textContent = v.longDate;
  els.todayPlace.textContent = `${v.place}${v.phase ? " · " + v.phase : ""}`;
  els.barMood.style.width = Math.round((v.avgMood ?? 0) * 100) + "%";
  els.barHealth.style.width = Math.round((v.avgHealth ?? 0) * 100) + "%";
  els.narration.textContent = v.narration || "—";
  moveShip(v);

  const beats = [...v.incidents, ...v.rawEvents].sort((a, b) => (b.salience || 0) - (a.salience || 0));
  els.beats.innerHTML = beats.slice(0, 6).map((b) => beatEl(b)).join("") +
    v.deaths.map((d) => `<div class="beat death">${esc(d.name)} is dead of ${esc(d.cause)}.</div>`).join("");

  const pcBeats = beats.filter((b) => b.pcInvolved);
  els.pcBox.innerHTML = pcBeats.length
    ? `<div class="pc-thread">★ Your thread</div>` + pcBeats.map((b) => beatEl(b)).join("")
    : (app.pcName ? `<div class="dim small">Quiet day for ${esc(app.pcName)}.</div>` : `<div class="dim small">Create a character above to follow their thread.</div>`);

  if (rebuildFeed) {
    els.feed.innerHTML = "";
    for (let k = 0; k <= i; k++) appendFeed(k, false);
  }
}

function appendFeed(i, scroll = true) {
  const v = app.views[i];
  if (!v || !v.hasContent) return;
  const beats = [...v.incidents, ...v.rawEvents].filter((b) => b.summary).sort((a, b) => (b.salience || 0) - (a.salience || 0)).slice(0, 3);
  const div = document.createElement("div");
  div.className = "feed-day";
  div.innerHTML = `<div class="feed-date">${esc(v.longDate)} — ${esc(v.place)}</div>` +
    `<div>${esc((v.narration || "").slice(0, 220))}${(v.narration || "").length > 220 ? "…" : ""}</div>` +
    v.deaths.map((d) => `<div class="beat death">${esc(d.name)} is dead of ${esc(d.cause)}.</div>`).join("");
  els.feed.appendChild(div);
  if (scroll) els.feed.scrollTop = els.feed.scrollHeight;
}

// ---------------------------------------------------------------------------
// Transport controls
// ---------------------------------------------------------------------------
function step(delta) {
  const next = Math.max(0, Math.min(app.views.length - 1, app.idx + delta));
  if (next === app.idx) { if (next === app.views.length - 1) pause(); return; }
  renderDay(next);
  if (delta > 0) appendFeed(next, true);
}

function play() {
  if (app.playing) return;
  app.playing = true;
  els.play.textContent = "⏸";
  const tick = () => { step(1); if (app.idx >= app.views.length - 1) pause(); };
  app.timer = setInterval(tick, Number(els.speed.value));
}
function pause() {
  app.playing = false;
  els.play.textContent = "▶";
  if (app.timer) clearInterval(app.timer);
  app.timer = null;
}

els.play.addEventListener("click", () => (app.playing ? pause() : play()));
els.scrub.addEventListener("input", () => { pause(); renderDay(Number(els.scrub.value), { rebuildFeed: true }); });
els.speed.addEventListener("change", () => { if (app.playing) { pause(); play(); } });

els.sail.addEventListener("click", async () => {
  if (app.mode !== "live") return;
  pause();
  const name = els.name.value.trim() || "Mary Blackwood";
  const playbook = els.playbook.value;
  const seed = els.seed.value ? (Number(els.seed.value) || els.seed.value) : 7;
  els.sail.disabled = true;
  els.note.textContent = "Re-running the voyage with your character…";
  await new Promise((r) => setTimeout(r, 10)); // let the UI paint before the sync sim run
  try {
    await runLiveVoyage({ seed, pc: { name, playbook } });
  } finally {
    els.sail.disabled = false;
  }
});

els.gazette.addEventListener("click", () => {
  if (!app.lib) { alert("The Gazette needs the live sim library (static fallback mode can't build one)."); return; }
  const from = Math.max(0, app.idx - 29);
  const records = app.gazetteRecords.slice(from, app.idx + 1);
  const rng = app.lib.makeRng(42);
  const html = app.lib.buildGazette({ records, meta: app.meta, prose: null, rng });
  const blob = new Blob([html], { type: "text/html" });
  els.gazetteFrame.src = URL.createObjectURL(blob);
  els.gazetteModal.classList.remove("hidden");
});
els.gazetteClose.addEventListener("click", () => els.gazetteModal.classList.add("hidden"));

boot();
