// Pure, isomorphic voyage builder — the logic half of voyage-loader.js, split out
// so it has ZERO Node dependencies (no fs/path/url) and can run identically in the
// CLI (via voyage-loader.js, which reads cook.json off disk) and in the browser
// (voyager/web/app.js fetches the same cook.json and calls buildVoyage() directly,
// so the live web viewer runs the REAL simulation client-side, not a canned replay).
//
// This is the anchor: the sim never contradicts the journal, it fills the silences
// between its lines with emergent shipboard life. See voyager/data/voyage-loader.js
// for the Node-side file read that feeds `raw` into buildVoyage().

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (e) => `${e.y}-${pad(e.m)}-${pad(e.d)}`;

// Milestone overlay: date windows → the ship's situation. Derived from the known
// itinerary of the first Endeavour voyage. `danger` and `fresh` (provision quality)
// feed the storyteller and the needs system.
const MILESTONES = [
  { from: "1768-08-26", to: "1768-09-12", phase: "sea",      danger: 0.25, fresh: 0.85, region: "the Bay of Biscay" },
  { from: "1768-09-13", to: "1768-09-18", phase: "port",     danger: 0.10, fresh: 1.00, region: "Madeira", lat: 32.65, lng: -16.91 },
  { from: "1768-09-19", to: "1768-11-12", phase: "sea",      danger: 0.35, fresh: 0.60, region: "the Atlantic crossing" },
  { from: "1768-11-13", to: "1768-12-07", phase: "port",     danger: 0.25, fresh: 0.95, region: "Rio de Janeiro", lat: -22.9, lng: -43.2 },
  { from: "1768-12-08", to: "1769-01-10", phase: "sea",      danger: 0.50, fresh: 0.55, region: "the South Atlantic" },
  { from: "1769-01-11", to: "1769-01-21", phase: "landfall", danger: 0.70, fresh: 0.70, region: "Tierra del Fuego", lat: -54.8, lng: -68.3 },
  { from: "1769-01-22", to: "1769-04-12", phase: "sea",      danger: 0.60, fresh: 0.45, region: "Cape Horn & the open Pacific" },
  { from: "1769-04-13", to: "1769-07-13", phase: "port",     danger: 0.20, fresh: 1.00, region: "Tahiti", lat: -17.5, lng: -149.5 },
  { from: "1769-07-14", to: "1769-10-05", phase: "sea",      danger: 0.40, fresh: 0.60, region: "the open Pacific (with Tupaia)" },
  { from: "1769-10-06", to: "1770-03-31", phase: "landfall", danger: 0.50, fresh: 0.75, region: "New Zealand" },
  { from: "1770-04-01", to: "1770-04-18", phase: "sea",      danger: 0.40, fresh: 0.55, region: "the Tasman Sea" },
  { from: "1770-04-19", to: "1770-06-10", phase: "landfall", danger: 0.45, fresh: 0.80, region: "the east coast of New Holland" },
  { from: "1770-06-11", to: "1770-06-17", phase: "sea",      danger: 0.95, fresh: 0.50, region: "the Great Barrier Reef" },
  { from: "1770-06-18", to: "1770-08-04", phase: "landfall", danger: 0.50, fresh: 0.70, region: "the Endeavour River", lat: -15.46, lng: 145.25 },
  { from: "1770-08-05", to: "1770-10-09", phase: "sea",      danger: 0.60, fresh: 0.40, region: "Torres Strait" },
  { from: "1770-10-10", to: "1770-12-25", phase: "port",     danger: 0.60, fresh: 0.80, region: "Batavia", lat: -6.1, lng: 106.8 },
  { from: "1770-12-26", to: "1771-03-14", phase: "sea",      danger: 0.70, fresh: 0.35, region: "the Indian Ocean (the dying time)" },
  { from: "1771-03-15", to: "1771-04-15", phase: "port",     danger: 0.30, fresh: 1.00, region: "the Cape of Good Hope", lat: -33.9, lng: 18.4 },
  { from: "1771-04-16", to: "1771-07-12", phase: "sea",      danger: 0.25, fresh: 0.70, region: "the homeward Atlantic" },
];

function classify(iso) {
  for (const m of MILESTONES) if (iso >= m.from && iso <= m.to) return m;
  return { phase: "sea", danger: 0.4, fresh: 0.6, region: "the open sea" };
}

// A few marquee days get a short, readable "dispatch of record" for the gazette,
// in addition to the full journal text.
const HIGHLIGHTS = {
  "1768-08-26": "HMS Endeavour departs Plymouth with 94 souls to observe the Transit of Venus.",
  "1769-01-16": "Banks's party is caught by a blizzard ashore in Tierra del Fuego; two of his servants die of cold.",
  "1769-04-13": "The Endeavour anchors in Matavai Bay, Tahiti; Cook issues rules for fair dealing with the islanders.",
  "1769-06-03": "Cook, Green and Solander observe the Transit of Venus, though a 'dusky shade' round the planet blurs the timing.",
  "1769-10-07": "The surgeon's boy sights New Zealand; the headland is named Young Nick's Head.",
  "1770-04-29": "The Endeavour lands at Botany Bay, where Banks and Solander gather so many new plants the bay is named for them.",
  "1770-06-11": "At eleven at night the Endeavour strikes the Great Barrier Reef and holds fast; guns and stores go overboard.",
  "1770-10-10": "The Endeavour reaches Batavia — the healthiest crew in the navy sails into a fever town.",
  "1771-01-27": "The astronomer Charles Green dies at sea of the Batavia sickness; the dying does not stop.",
  "1771-07-10": "The Endeavour nears home after nearly three years, a charted Pacific, and a third of the company dead.",
};

// --- date helpers (local, to keep this file self-contained) ---
const DAY = 86400000;
const d2 = (iso) => new Date(iso + "T00:00:00Z");
const isoAdd = (iso, n) => new Date(d2(iso).getTime() + n * DAY).toISOString().slice(0, 10);
const between = (a, b) => Math.round((d2(b) - d2(a)) / DAY);

// Build { TIMELINE, VOYAGE } from the already-parsed cook.json object (`raw`).
// Pure function, no I/O — safe in Node or a browser.
export function buildVoyage(raw) {
  // Interpolate a position for a date the journal is silent on (linear between the
  // nearest journal fixes) — used to place synthesized port days on the map.
  function coordAt(journalDays, date) {
    let prev = null, next = null;
    for (const d of journalDays) { if (d.date <= date) prev = d; if (d.date >= date && !next) next = d; }
    if (prev && next && prev !== next) {
      const f = between(prev.date, date) / Math.max(1, between(prev.date, next.date));
      return { lat: prev.lat + (next.lat - prev.lat) * f, lng: prev.lng + (next.lng - prev.lng) * f };
    }
    return prev || next || { lat: 0, lng: 0 };
  }

  // Real journal days.
  const journalDays = raw.entries
    .map((e) => {
      const date = isoOf(e);
      const c = classify(date);
      const generic = !e.place || /^at sea$/i.test(e.place.trim());
      return {
        date, lat: e.lat, lng: e.lng,
        place: generic ? c.region : e.place,
        region: c.region, phase: c.phase, danger: c.danger, fresh: c.fresh,
        text: e.text, highlight: HIGHLIGHTS[date] || null,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Cook logged daily AT SEA but sparsely IN PORT, so port stays (Madeira, Rio,
  // Tahiti, Batavia, the Cape) are gaps in the journal. Synthesize enough "port days"
  // per stay for the ship to actually rest, reprovision, trade, and make first
  // contact there — the simulation needs the ship to be somewhere it can breathe.
  const MIN_DAYS = { port: 5, landfall: 3 };
  const existingDates = new Set(journalDays.map((d) => d.date));
  const synthetic = [];
  for (const m of MILESTONES) {
    if (m.phase !== "port" && m.phase !== "landfall") continue;
    const have = journalDays.filter((d) => d.date >= m.from && d.date <= m.to).length;
    const need = (MIN_DAYS[m.phase] || 3) - have;
    if (need <= 0) continue;
    const span = Math.max(1, between(m.from, m.to));
    for (let k = 1; k <= need; k++) {
      let date = isoAdd(m.from, Math.round((span * k) / (need + 1)));
      let guard = 0;
      while (existingDates.has(date) && guard++ < span) date = isoAdd(date, 1);
      existingDates.add(date);
      const pos = m.lat != null ? { lat: m.lat, lng: m.lng } : coordAt(journalDays, date);
      synthetic.push({
        date, lat: pos.lat, lng: pos.lng, place: m.region, region: m.region,
        phase: m.phase, danger: m.danger, fresh: m.fresh,
        text: null, synthetic: true, highlight: HIGHLIGHTS[date] || null,
      });
    }
  }

  // Ensure marquee history always surfaces, even on a day the journal skipped.
  for (const [date, line] of Object.entries(HIGHLIGHTS)) {
    if (existingDates.has(date)) continue;
    const c = classify(date);
    const pos = c.lat != null ? { lat: c.lat, lng: c.lng } : coordAt(journalDays, date);
    existingDates.add(date);
    synthetic.push({ date, lat: pos.lat, lng: pos.lng, place: c.region, region: c.region,
      phase: c.phase, danger: c.danger, fresh: c.fresh, text: null, synthetic: true, highlight: line });
  }

  // Merged, de-duplicated, chronological timeline the simulation rides on.
  const TIMELINE = [...journalDays, ...synthetic].sort((a, b) => (a.date < b.date ? -1 : 1));

  const VOYAGE = {
    key: raw.author.key,
    ship: "HMS Endeavour",
    captain: raw.author.name,
    source: raw.author.source,
    complement: 94,
    start: TIMELINE[0].date,
    end: TIMELINE[TIMELINE.length - 1].date,
    timeline: TIMELINE,
  };

  return { TIMELINE, VOYAGE };
}

// The crew roster (hair complexity: names/roles/traits give the sim texture and
// invite apophenia). Historically flavoured members of the Endeavour's company.
// Static — does not depend on `raw` — so it's a plain export.
export const CREW_SEED = [
  { name: "Lt. James Cook", role: "Commander", traits: ["disciplined", "temperate", "just"] },
  { name: "Joseph Banks", role: "Naturalist", traits: ["curious", "wealthy", "bold"] },
  { name: "Dr. Daniel Solander", role: "Botanist", traits: ["curious", "gentle"] },
  { name: "Charles Green", role: "Astronomer", traits: ["exacting", "sickly"] },
  { name: "Zachary Hicks", role: "Second Lieutenant", traits: ["dutiful", "sickly"] },
  { name: "Robert Molyneux", role: "Master", traits: ["hard-drinking", "skilled"] },
  { name: "John Gore", role: "Third Lieutenant", traits: ["hunter", "restless"] },
  { name: "Stephen Forwood", role: "Gunner", traits: ["gruff", "brave"] },
  { name: "Jonathan Monkhouse", role: "Midshipman", traits: ["clever", "young"] },
  { name: "Nicholas Young", role: "Surgeon's Boy", traits: ["young", "sharp-eyed"] },
  { name: "John Ravenhill", role: "Sailmaker", traits: ["old", "hard-drinking"] },
  { name: "Tupaia", role: "Navigator-Priest", traits: ["wise", "proud", "far-seeing"] },
  { name: "James Magra", role: "Able Seaman", traits: ["insolent", "literate"] },
  { name: "Richard Orton", role: "Captain's Clerk", traits: ["drunkard", "resentful"] },
  { name: "Sam Evans", role: "Quartermaster", traits: ["shrewd", "greedy"] },
  { name: "Tom Rossiter", role: "Drummer", traits: ["merry", "loud"] },
];
