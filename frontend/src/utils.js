import { MONTH_NAMES } from "./constants";

export function ageOn(bornIso, y, m, d) {
  const [by, bm, bd] = bornIso.split("-").map(Number);
  let years = y - by;
  if (m < bm || (m === bm && d < bd)) years--;
  return years;
}

export function fmtDate(y, m, d) {
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function yearsAgo(y) {
  return new Date().getFullYear() - y;
}

export function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PLACE_MAX_CHARS = 28;

// Some place names are sentence fragments left over from parsing a journal, and
// a long one stretches its legend chip across the whole bar.
export function shortPlace(place) {
  const name = place.split(/[,，]/).pop().trim();
  if (name.length <= PLACE_MAX_CHARS) return name;
  const cut = name.slice(0, PLACE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function groupByPlace(picked) {
  const groups = new Map();
  for (const e of picked) {
    const key = `${e.a}|${e.lat}|${e.lng}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.values()];
}

export function targetDate() {
  const params = new URLSearchParams(window.location.search);
  const p = params.get("date");
  const m = p && p.match(/^(\d{1,2})-(\d{1,2})$/);
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (m) {
    d.setMonth(+m[1] - 1);
    d.setDate(+m[2]);
  }
  return d;
}
