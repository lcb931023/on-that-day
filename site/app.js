const COLORS = {
  woolf: "#6d597a", kafka: "#355070", frank: "#b05642", pepys: "#8c6239",
  eno: "#4f7d5d", warhol: "#bb4d79", hillesum: "#a8833c", luxun: "#3f3b34",
  jixianlin: "#6b7f3a", hushi: "#33777c", einstein: "#5661b3",
  darwin: "#3d7a99",
};
const INITIALS = {
  woolf: "VW", kafka: "FK", frank: "AF", pepys: "SP", eno: "BE",
  warhol: "AW", hillesum: "EH", luxun: "鲁", jixianlin: "季", hushi: "胡",
  einstein: "AE", darwin: "CD",
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const $ = (sel) => document.querySelector(sel);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ?date=MM-DD lets you preview any day of the year
function targetDate() {
  const p = new URLSearchParams(location.search).get("date");
  const m = p && p.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) return { m: +m[1], d: +m[2] };
  const now = new Date();
  return { m: now.getMonth() + 1, d: now.getDate() };
}

function ageOn(bornIso, y, m, d) {
  const [by, bm, bd] = bornIso.split("-").map(Number);
  let years = y - by;
  if (m < bm || (m === bm && d < bd)) years--;
  return years;
}

function fmtDate(y, m, d) {
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

function yearsAgo(y) {
  return new Date().getFullYear() - y;
}

function groupByPlace(picked) {
  const groups = new Map();
  for (const e of picked) {
    const key = `${e.a}|${e.lat}|${e.lng}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.values()];
}

let DATA, TARGET, GROUPS, MAP;

async function init() {
  TARGET = targetDate();
  // per-day shards precomputed by build_data.py, incl. the nearest-entry fallback
  const shardName = `${String(TARGET.m).padStart(2, "0")}-${String(TARGET.d).padStart(2, "0")}`;
  const [authors, day] = await Promise.all([
    fetch("data/authors.json").then((r) => r.json()),
    fetch(`data/days/${shardName}.json`).then((r) => r.json()),
  ]);
  DATA = { authors };
  GROUPS = groupByPlace(day.entries);

  $("#masthead-date").textContent =
    `${TARGET.d} ${MONTH_NAMES[TARGET.m - 1]} — the same day, decades ago`;

  MAP = L.map("map", { zoomControl: false });
  L.control.zoom({ position: "bottomright" }).addTo(MAP);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(MAP);

  const markers = GROUPS.map(addMarker);
  buildLegend(markers);
  locateUser(markers);
}

function addMarker(group, gi) {
  const { a, lat, lng, place } = group[0];
  const count = group.length > 1
    ? `<span class="seal-count">${group.length}</span>` : "";
  const icon = L.divIcon({
    className: "",
    html: `<div class="seal" style="--c:${COLORS[a]}">${INITIALS[a]}${count}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
  const marker = L.marker([lat, lng], { icon }).addTo(MAP);

  const items = group.map((e, ei) => {
    const approx = e.delta ? `<span class="pp-approx">nearest entry — </span>` : "";
    const snip = esc(e.text.replace(/\s+/g, " ").slice(0, 150)) + "…";
    return `<div class="pp-entry" data-g="${gi}" data-e="${ei}">
      <div class="pp-when">${approx}${fmtDate(e.y, e.m, e.d)}
        <span class="age">· aged ${ageOn(DATA.authors[a].born, e.y, e.m, e.d)} · ${yearsAgo(e.y)} years ago</span></div>
      <div class="pp-snip">${snip}</div>
      <div class="pp-open">Read the entry →</div>
    </div>`;
  }).join("");

  marker.bindPopup(
    `<div style="--c:${COLORS[a]}">
       <div class="pp-author">${DATA.authors[a].name}</div>
       <div class="pp-place">${esc(place)}</div>${items}
     </div>`,
    // keep popups clear of the fixed masthead
    { maxWidth: 300, autoPanPaddingTopLeft: L.point(24, 96) });

  marker.on("popupopen", (ev) => {
    ev.popup.getElement().querySelectorAll(".pp-entry").forEach((el) =>
      el.addEventListener("click", () => openPanel(+el.dataset.g, +el.dataset.e)));
  });
  return marker;
}

function buildLegend(markers) {
  // one chip per author; clicking flies to their (first) pin, or fits all
  // of their pins when entries scatter across several places
  const byAuthor = new Map();
  GROUPS.forEach((g, i) => {
    if (!byAuthor.has(g[0].a)) byAuthor.set(g[0].a, []);
    byAuthor.get(g[0].a).push(i);
  });
  $("#legend").innerHTML = [...byAuthor.entries()].map(([a, idxs]) => {
    const place = idxs.length === 1
      ? GROUPS[idxs[0]][0].place.split(/[,，]/).pop().trim()
      : `${idxs.length} places`;
    return `<button class="legend-chip" data-i="${idxs.join(",")}" style="--c:${COLORS[a]}">
      <span class="dot"></span>${DATA.authors[a].name}
      <span style="color:var(--ink-soft)">${place}</span>
    </button>`;
  }).join("");
  $("#legend").querySelectorAll(".legend-chip").forEach((el) =>
    el.addEventListener("click", () => {
      const idxs = el.dataset.i.split(",").map(Number);
      if (idxs.length === 1) {
        const m = markers[idxs[0]];
        MAP.flyTo(m.getLatLng(), 12, { duration: 1.2 });
        setTimeout(() => m.openPopup(), 1300);
      } else {
        MAP.flyToBounds(L.latLngBounds(idxs.map((i) => markers[i].getLatLng())).pad(0.3),
                        { duration: 1.2 });
      }
    }));
}

function locateUser(markers) {
  const diaryBounds = L.latLngBounds(markers.map((m) => m.getLatLng()));
  const fallback = () => MAP.fitBounds(diaryBounds.pad(0.3));
  if (!navigator.geolocation) return fallback();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const you = [pos.coords.latitude, pos.coords.longitude];
      L.marker(you, {
        icon: L.divIcon({ className: "", html: `<div class="you-dot"></div>`,
                          iconSize: [16, 16], iconAnchor: [8, 8] }),
        zIndexOffset: 500,
      }).addTo(MAP).bindPopup("You, today");
      MAP.fitBounds(diaryBounds.extend(you).pad(0.15));
    },
    fallback, { timeout: 8000 });
  fallback();  // show the diaries immediately; geolocation refits later
}

function openPanel(gi, ei) {
  const group = GROUPS[gi];
  const e = group[ei];
  const a = DATA.authors[e.a];
  const paragraphs = e.text.split(/\n\n+/).map((p) => `<p>${esc(p.trim())}</p>`).join("");
  const chips = group.length > 1
    ? `<div class="pn-years">${group.map((x, i) =>
        `<button class="year-chip ${i === ei ? "active" : ""}" data-e="${i}">${x.y}</button>`
      ).join("")}</div>` : "";
  const approx = e.delta
    ? `<div class="pn-note">No entry survives for ${TARGET.d} ${MONTH_NAMES[TARGET.m - 1]} —
       this is the nearest, ${e.delta} day${e.delta > 1 ? "s" : ""} away.</div>` : "";

  $("#panel-body").innerHTML = `
    <div style="--c:${COLORS[e.a]}">
      <div class="pn-head">
        <img class="pn-cover" src="data/${e.a}.jpg" alt="">
        <div>
          <div class="pn-author">${a.name}</div>
          <div class="pn-source">${a.source}</div>
        </div>
      </div>
      ${chips}
      <div class="pn-dateline">
        <span class="pn-date">${fmtDate(e.y, e.m, e.d)}</span>
        <span class="pn-age">aged ${ageOn(a.born, e.y, e.m, e.d)} · ${yearsAgo(e.y)} years ago</span>
      </div>
      <div class="pn-placeline">${esc(e.place)} — ${esc(a.note)}</div>
      ${approx}
      <div class="pn-text">${paragraphs}</div>
      <div class="pn-otd">
        <h3>Meanwhile, in the world</h3>
        <div class="pn-otd-sub">The days leading up to ${e.d} ${MONTH_NAMES[e.m - 1]}, ${e.y}</div>
        <div id="otd-items" class="otd-muted">Consulting the archives…</div>
      </div>
    </div>`;
  $("#panel-body").querySelectorAll(".year-chip").forEach((el) =>
    el.addEventListener("click", () => openPanel(gi, +el.dataset.e)));
  $("#panel").hidden = false;
  $("#panel").scrollTop = 0;
  loadOnThisDay(e);
}

const OTD_WINDOW_DAYS = 14; // span of days before an entry to gather world events from

const otdCache = new Map();
async function fetchOtdDay(m, d) {
  const key = `${m}-${d}`;
  if (!otdCache.has(key)) {
    try {
      const mm = String(m).padStart(2, "0"), dd = String(d).padStart(2, "0");
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
      otdCache.set(key, (await res.json()).events || []);
    } catch {
      otdCache.set(key, []);
    }
  }
  return otdCache.get(key);
}

async function loadOnThisDay(e) {
  // Walk backward from the entry date to list the calendar days leading up to it
  const days = [];
  for (let i = OTD_WINDOW_DAYS; i >= 0; i--) {
    const d = new Date(e.y, e.m - 1, e.d - i);
    days.push([d.getMonth() + 1, d.getDate()]);
  }
  // Keep only events from the entry's own year, so the run-up is contemporaneous
  const perDay = await Promise.all(days.map(([m, d]) =>
    fetchOtdDay(m, d).then((evs) =>
      evs.filter((ev) => ev.year === e.y).map((ev) => ({ m, d, text: ev.text })))));

  const el = document.getElementById("otd-items");
  if (!el) return;
  const shown = perDay.flat().slice(-6); // the days nearest the entry, kept in date order

  if (!shown.length) {
    el.innerHTML = `<div class="otd-muted">The archives are silent for the days before this.</div>`;
    return;
  }
  el.classList.remove("otd-muted");
  el.innerHTML = shown.map((ev) =>
    `<div class="otd-item"><span class="otd-year">${ev.d} ${MONTH_NAMES[ev.m - 1].slice(0, 3)}</span><span>${esc(ev.text)}</span></div>`
  ).join("");
}

$("#panel-close").addEventListener("click", () => { $("#panel").hidden = true; });
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") $("#panel").hidden = true;
});

init();
