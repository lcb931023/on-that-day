// World helpers over the real journal TIMELINE. Each timeline entry already IS a
// day (with authentic text + a derived phase/danger/fresh), so the engine walks the
// timeline directly. These helpers cover provisions and the day's anchored history.

import { daysBetween } from "../util/dates.js";

// Provisions freshness erodes at sea and is restored in port; blended with the leg's
// own `fresh` rating so e.g. the Indian-Ocean "dying time" stays grim even between ports.
export function stepProvisions(prev, day, dt) {
  const inPort = day.phase === "port" || day.phase === "landfall";
  const target = day.fresh;
  if (inPort) return Math.min(1, Math.max(prev, target) + 0.2 * dt);
  // 18 months of stores erode with time, and faster on a stale, ill-found leg
  // (e.g. the homeward Indian Ocean), so long grim legs actually run short.
  const rate = 0.004 + Math.max(0, 0.7 - day.fresh) * 0.022;
  return Math.max(target * 0.4, prev - rate * dt);
}

// The anchored history for a day: the real journal text, plus a short readable
// "dispatch" if this is a marquee day.
export function dayRealEvents(day) {
  const out = [];
  if (day.highlight) out.push({ date: day.date, text: day.highlight, place: day.place, marquee: true });
  // The full journal entry, trimmed for readability, always available as record.
  if (day.text) out.push({ date: day.date, text: trim(day.text, 320), place: day.place, journal: true, full: day.text });
  return out;
}

function trim(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (lastStop > 60 ? cut.slice(0, lastStop + 1) : cut) + " …";
}

// Days elapsed since the previous journal entry (the timeline has gaps), clamped so
// a long silence doesn't blow up need-decay or incident odds.
export function gapDays(prevDate, date) {
  if (!prevDate) return 1;
  return Math.max(1, Math.min(6, daysBetween(prevDate, date)));
}
