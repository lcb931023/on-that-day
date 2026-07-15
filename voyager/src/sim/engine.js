// The engine: walks the REAL journal timeline one entry at a time, decays needs,
// lets pawns act, lets the storyteller deal incidents, folds in the day's authentic
// journal text as anchored history, and emits a day-by-day LOG. That log is the base
// story the narrator and the artifact generators build on. It never contradicts the
// journal — it fills the silences between Cook's lines with emergent shipboard life.

// NOTE: no top-level import of voyage-loader.js here — that file reads cook.json off
// disk (node:fs), and this engine must also run unmodified in the browser (see
// voyager/web/app.js). Callers always pass `voyage` explicitly (cli.js, export.js,
// and the browser both build it via data/voyage-build.js#buildVoyage).
import { makeCrew, makePawn, clamp, expireThoughts, addThought, mood } from "./pawns.js";
import { stepPawn } from "./actions.js";
import { stepProvisions, dayRealEvents, gapDays } from "./world.js";
import { makeStoryteller } from "./storyteller.js";
import { makeRng, hashSeed } from "../util/rng.js";
import { longDate, daysBetween } from "../util/dates.js";

export function createVoyage({ voyage, seed = 1, personality = "cassandra", pcs = [] } = {}) {
  if (!voyage) throw new Error("createVoyage: `voyage` is required (see data/voyage-loader.js or voyage-build.js#buildVoyage)");
  const rng = makeRng(typeof seed === "string" ? hashSeed(seed) : seed);
  const roster = makeCrew();
  for (const pc of pcs) roster.push(makePawn({ ...pc, isPC: true }));
  const storyteller = makeStoryteller(personality);
  return {
    voyage, rng, roster, storyteller, seed, personality,
    provisions: 1, prevDate: null, lastPortDate: voyage.start, index: 0, day: 0,
    log: [],
    get date() { return voyage.timeline[Math.min(this.index, voyage.timeline.length - 1)].date; },
  };
}

// Needs self-stabilize toward daily targets: the crew sleep and eat their rations
// passively, so calm legs stay livable. Discretionary actions push needs ABOVE the
// baseline and generate story; storyteller incidents push them below. Deaths come
// from hardship and incidents, not from mere day-to-day decay.
const approach = (v, target, rate) => v + (target - v) * Math.min(1, rate);

function maintainNeeds(pawn, leg, day, dt, provisions) {
  const n = pawn.needs, fx = pawn.fx, r = Math.min(1, 0.5 * dt);
  // rest: sleep restores toward a target the weather/danger erodes.
  n.rest = clamp(approach(n.rest, clamp(0.85 - leg.danger * 0.35 + (fx.restEff || 0), 0.15, 1), r), 0, 1);
  // nutrition: the daily ration; quality set by provisions × freshness.
  const foodTarget = clamp(0.35 + 0.55 * provisions * (0.5 + 0.5 * leg.fresh), 0.1, 1);
  n.nutrition = clamp(approach(n.nutrition, foodTarget, r), 0, 1);
  if (foodTarget < 0.45) addThought(pawn, "salt pork, weevily biscuit, and short water", -0.35, 6, day);
  // morale & fellowship drift toward modest baselines (actions/landfall lift them).
  n.morale = clamp(approach(n.morale, clamp(0.52 - leg.danger * 0.18 + (fx.moodBase || 0), 0.1, 1), r * 0.6), 0, 1);
  n.social = clamp(approach(n.social, 0.45, r * 0.6), 0, 1);
  // safety reflects the leg's danger, softened by brave traits.
  n.safety = clamp(1 - leg.danger * (1 - (fx.fearResist || 0) * 0.5), 0, 1);
  // health: scurvy/decline when starved; slow recovery when fed and rested.
  if (n.nutrition < 0.35) n.health = clamp(n.health - ((0.35 - n.nutrition) * 0.10 + (fx.healthDecay || 0)) * dt, 0, 1);
  else if (n.health < 1 && n.nutrition > 0.55 && n.rest > 0.5) n.health = clamp(n.health + (0.03 - (fx.healthDecay || 0)) * dt, 0, 1);
  if (n.health <= 0 && pawn.alive) { pawn.alive = false; pawn.causeOfDeath = "sickness and want"; pawn.diedDay = day; }
  expireThoughts(pawn, day);
}

// Advance one journal entry; returns the DayRecord (or null at voyage's end).
export function stepDay(state) {
  const { voyage, roster, storyteller, rng } = state;
  const leg = voyage.timeline[state.index];
  if (!leg) return null;
  const isoDate = leg.date;
  const dt = gapDays(state.prevDate, isoDate);
  if (leg.phase === "port" || leg.phase === "landfall") state.lastPortDate = isoDate;
  state.provisions = stepProvisions(state.provisions, leg, dt);
  const daysAtSea = daysBetween(state.lastPortDate, isoDate);

  for (const p of roster) if (p.alive) maintainNeeds(p, leg, state.day, dt, state.provisions);

  // pawns act — collect salient / PC-relevant raw events
  const rawEvents = [];
  for (const p of roster) {
    const ev = stepPawn(p, { leg, provisions: state.provisions }, roster, state.day, rng);
    if (!ev) continue;
    ev.date = isoDate;
    ev.pcInvolved = ev.actors?.some((a) => a.isPC);
    if (ev.salience >= 0.4 || ev.pcInvolved) rawEvents.push(ev);
    for (const a of ev.actors || []) if (ev.salience >= 0.5) a.log.push({ date: isoDate, ...ev });
  }

  const aliveP = roster.filter((p) => p.alive);
  const avgMood = aliveP.reduce((s, p) => s + mood(p), 0) / Math.max(1, aliveP.length);
  const avgHealth = aliveP.reduce((s, p) => s + p.needs.health, 0) / Math.max(1, aliveP.length);

  // storyteller deals incidents (dt lets a longer gap raise the odds)
  const incidents = storyteller.day({ world: state, leg, roster, day: state.day, isoDate, rng, dt,
    provisions: state.provisions, daysAtSea, avgMood, avgHealth });
  for (const inc of incidents) { inc.date = isoDate; inc.incident = true; inc.pcInvolved = inc.actors?.some((a) => a.isPC); }

  // reactive discipline: a brawl under a disciplined captain risks the lash
  for (const ev of rawEvents) {
    if (ev.flogRisk && rng.chance(0.5)) {
      const v = ev.hurt || ev.actors[0];
      v.needs.morale = clamp(v.needs.morale - 0.2, 0, 1);
      incidents.push({ kind: "flogging", date: isoDate, incident: true, actors: [v], salience: 0.6,
        summary: `${v.name} was seized up and flogged at the gangway for brawling.` });
    }
  }

  const realEvents = dayRealEvents(leg);
  const deaths = roster.filter((p) => p.diedDay === state.day);

  const record = {
    day: state.day, date: isoDate, longDate: longDate(isoDate),
    leg: { place: leg.place, region: leg.region, phase: leg.phase, danger: leg.danger, lat: leg.lat, lon: leg.lng },
    rawEvents, incidents, realEvents,
    avgMood, avgHealth, provisions: state.provisions,
    aliveCount: aliveP.length, deaths: deaths.map((d) => ({ name: d.name, cause: d.causeOfDeath })),
    tension: storyteller.tension,
  };
  state.log.push(record);
  state.prevDate = isoDate;
  state.index++;
  state.day++;
  return record;
}

// Run until a target date (inclusive) or the voyage's end.
export function sailTo(state, targetIso) {
  let guard = 0;
  while (state.index < state.voyage.timeline.length && guard++ < 5000) {
    const next = state.voyage.timeline[state.index];
    if (targetIso && next.date > targetIso) break;
    stepDay(state);
  }
  return state;
}

export function summarizeDay(rec) {
  const beats = [...rec.incidents, ...rec.rawEvents].sort((a, b) => (b.salience || 0) - (a.salience || 0));
  return { ...rec, beats };
}
