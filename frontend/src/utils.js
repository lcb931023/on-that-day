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
