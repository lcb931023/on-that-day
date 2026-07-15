// Mental breaks & inspirations — RimWorld's payoff for the needs/mood sim. When a
// pawn's mood sinks below a threshold they may BREAK, venting on the world in a way
// shaped by their traits; the crew watching (bonded to them, or of the same faction)
// take a stress hit and may themselves tip over into a SECONDARY break — a cascade,
// the way one man's fit really did spread through a wooden-walled crew with nowhere
// to get away from it. High mood is the mirror: an INSPIRATION, a burst of unusually
// fine work. Kept to three break kinds and three inspiration kinds — legible, not a
// hairball — and capped per day so a cascade reads as a dramatic run, not noise.

import { addThought, nudgeRel, mood, clamp } from "./pawns.js";

// Tuned against the actual mood distribution the sim produces (crises are sharp but
// brief — most pawn-days sit well above these lines, so a break stays a real event,
// not background noise; see ITERATION.md for the measured pawn-day histogram).
export const BREAK_THRESHOLD = 0.38;
export const EXTREME_THRESHOLD = 0.26;
export const INSPIRE_THRESHOLD = 0.8;
const MAX_BREAKS_PER_DAY = 3;
const MAX_INSPIRE_PER_DAY = 2;

function breakKind(pawn, rng) {
  const t = pawn.traits;
  const violent = t.includes("brave") || t.includes("gruff") || t.includes("resentful") || t.includes("insolent");
  const proud = t.includes("proud") || t.includes("resentful") || t.includes("greedy");
  const roll = rng();
  if (violent && roll < 0.4) return "berserk";
  if (proud && roll < 0.7) return "tantrum";
  return "despair";
}

function fireBreak(pawn, alive, day, rng, extreme) {
  const kind = breakKind(pawn, rng);
  pawn.breakingUntil = day + (kind === "despair" ? 3 : 1);
  pawn.lastBreakDay = day;
  if (kind === "berserk") {
    const targets = alive.filter((p) => p !== pawn);
    const target = targets.length ? rng.pick(targets) : null;
    addThought(pawn, "the black fit took me — a berserk fury", -0.5, 10, day);
    let summary;
    if (target && rng.chance(0.7)) {
      target.needs.health = clamp(target.needs.health - rng.range(0.08, extreme ? 0.3 : 0.18), 0, 1);
      nudgeRel(target, pawn, -0.3); nudgeRel(pawn, target, -0.1);
      addThought(target, `set upon by ${pawn.name} in a berserk fury`, -0.4, 8, day);
      summary = `${pawn.name} broke — a berserk fury turned on ${target.name} before he was pulled off.`;
    } else {
      pawn.needs.health = clamp(pawn.needs.health - rng.range(0.05, 0.15), 0, 1);
      summary = `${pawn.name} broke into a berserk fury, laying about with fists and belaying-pins till the fit passed.`;
    }
    return { kind: "mental_break", subkind: "berserk", actors: target ? [pawn, target] : [pawn], hurt: target,
      salience: 0.8, flogRisk: true, summary };
  }
  if (kind === "tantrum") {
    addThought(pawn, "smashed my gear in a black tantrum", -0.4, 8, day);
    pawn.needs.morale = clamp(pawn.needs.morale - 0.15, 0, 1);
    for (const p of alive) if (p !== pawn) nudgeRel(p, pawn, -0.03);
    return { kind: "mental_break", subkind: "tantrum", actors: [pawn], salience: 0.55,
      summary: `${pawn.name} flew into a tantrum, smashing what came to hand and cursing the voyage entire.` };
  }
  // despair — passive, but the longest-lasting and the one that most drags others down.
  pawn.needs.morale = clamp(pawn.needs.morale - 0.1, 0, 1);
  pawn.needs.social = clamp(pawn.needs.social - 0.15, 0, 1);
  addThought(pawn, "sunk in black despair, will not be roused", -0.5, extreme ? 14 : 8, day);
  return { kind: "mental_break", subkind: "despair", actors: [pawn], salience: 0.5,
    summary: `${pawn.name} sank into a black despair, would not rise nor speak nor work.` };
}

// Walk pawns under the break threshold worst-first; each break can shake bonded or
// same-faction witnesses hard enough to queue a secondary break of their own.
export function checkBreaks(roster, day, rng, { cap = MAX_BREAKS_PER_DAY } = {}) {
  const events = [];
  const alive = roster.filter((p) => p.alive);
  const queue = alive.filter((p) => p.breakingUntil <= day && mood(p) < BREAK_THRESHOLD)
    .sort((a, b) => mood(a) - mood(b));
  const queued = new Set(queue.map((p) => p.id));
  const cascadeSource = new Map();

  while (queue.length && events.length < cap) {
    const p = queue.shift();
    queued.delete(p.id);
    if (p.breakingUntil > day) continue;
    const m = mood(p);
    if (m >= BREAK_THRESHOLD) continue;
    const extreme = m < EXTREME_THRESHOLD;
    if (!rng.chance(extreme ? 0.65 : 0.32)) continue;

    const ev = fireBreak(p, alive, day, rng, extreme);
    const from = cascadeSource.get(p.id);
    if (from) {
      ev.cascade = from;
      ev.summary = `Rattled by ${from}'s break: ${ev.summary}`;
    }
    events.push(ev);

    // witnesses: bonded or same-faction crew take a stress thought and may cascade.
    for (const w of alive) {
      if (w === p || w.breakingUntil > day || queued.has(w.id)) continue;
      const bond = Math.abs(w.rel[p.id] ?? 0);
      const witnessWeight = bond * 0.6 + (w.faction === p.faction ? 0.15 : 0);
      if (witnessWeight <= 0.12 || !rng.chance(Math.min(0.6, witnessWeight))) continue;
      addThought(w, `shaken by ${p.name}'s breakdown`, -0.15 - witnessWeight * 0.15, 4, day);
      if (mood(w) < BREAK_THRESHOLD) {
        cascadeSource.set(w.id, p.name);
        queue.push(w); queued.add(w.id);
      }
    }
  }
  return events;
}

function fireInspiration(pawn, alive, day, rng) {
  const kind = rng.pick(["inspired_work", "inspired_yarn", "inspired_cheer"]);
  pawn.inspiredUntil = day + 1;
  addThought(pawn, "struck by a rare inspiration", 0.4, 3, day);
  if (kind === "inspired_cheer") {
    for (const p of alive) p.needs.morale = clamp(p.needs.morale + 0.12, 0, 1);
    return { kind: "inspiration", subkind: kind, actors: [pawn], salience: 0.5,
      summary: `${pawn.name}, in high spirits, roused the whole company with a song passed deck to deck.` };
  }
  if (kind === "inspired_work") {
    pawn.needs.morale = clamp(pawn.needs.morale + 0.2, 0, 1);
    return { kind: "inspiration", subkind: kind, actors: [pawn], salience: 0.45,
      summary: `${pawn.name} worked with an inspired hand today — the finest ${pawn.role.toLowerCase()}'s work anyone aboard had seen.` };
  }
  const partner = alive.find((p) => p !== pawn && (pawn.rel[p.id] ?? 0) > 0);
  if (partner) {
    nudgeRel(pawn, partner, 0.1); nudgeRel(partner, pawn, 0.1);
    partner.needs.social = clamp(partner.needs.social + 0.2, 0, 1);
  }
  return { kind: "inspiration", subkind: kind, actors: partner ? [pawn, partner] : [pawn], salience: 0.4,
    summary: `${pawn.name} spun a yarn so fine the watch forgot the cold.` };
}

export function checkInspirations(roster, day, rng, { cap = MAX_INSPIRE_PER_DAY } = {}) {
  const events = [];
  const alive = roster.filter((p) => p.alive);
  for (const p of alive) {
    if (events.length >= cap) break;
    if (p.inspiredUntil > day || mood(p) < INSPIRE_THRESHOLD || !rng.chance(0.18)) continue;
    events.push(fireInspiration(p, alive, day, rng));
  }
  return events;
}
