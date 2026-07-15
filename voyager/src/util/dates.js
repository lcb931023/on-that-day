// Minimal date helpers (UTC, day resolution) — the whole clock is day-anchored.
export const DAY = 86400000;

export function toDate(iso) { return new Date(iso + "T00:00:00Z"); }
export function iso(d) { return d.toISOString().slice(0, 10); }
export function addDays(d, n) { return new Date(d.getTime() + n * DAY); }
export function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / DAY); }
export function longDate(iso) {
  const d = toDate(iso);
  const months = ["January","February","March","April","May","June","July",
    "August","September","October","November","December"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
