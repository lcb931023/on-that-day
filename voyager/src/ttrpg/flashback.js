// The FLASHBACK mechanic (Blades in the Dark), which is the bridge between the PC's
// AUTONOMOUS simulated life and the player's ROLEPLAY. When a scene lands and the
// player needs an advantage, they declare something their character *had already
// done* earlier in the voyage. The engine finds a plausible earlier day, charges
// STRESS scaled by how much of a stretch it is, and splices the flashback beat back
// into the historical log so the autonomous past and the roleplayed present agree.
//
// This is exactly the loop C. Thi Nguyen describes: the mechanical/autonomous layer
// becomes narratively load-bearing after the fact.

import { toDate } from "../util/dates.js";

// Plausibility → stress cost. The easier it is to believe the PC set this up given
// where the ship was and what they do, the cheaper it is.
export function stressCost({ pc, atDay, targetDay, actionUsed, tie }) {
  let cost = 2; // baseline "clever plan"
  const gap = Math.max(0, atDay - targetDay);
  if (gap > 60) cost += 1;           // reaching far back is a stretch
  if (tie === "playbook") cost -= 1; // it fits your archetype
  if (tie === "port") cost -= 1;     // you were ashore with opportunity
  if ((pc.dots?.[actionUsed] ?? 0) >= 2) cost -= 1; // you're good at this
  return Math.max(0, Math.min(4, cost));
}

// Declare a flashback. `log` is the voyage log (array of DayRecords). Returns the
// spliced beat + the resolution, and mutates the target day's record + the pc.
export function flashback({ pc, log, atDay, description, actionUsed = "Consort", rng }) {
  // find a plausible earlier day: prefer a port/landfall day the PC could exploit.
  const past = log.filter((r) => r.day < atDay);
  const ports = past.filter((r) => r.leg.phase === "port" || r.leg.phase === "landfall");
  const target = (ports.length ? ports : past)[Math.max(0, (ports.length ? ports.length : past.length) - 1)];
  if (!target) throw new Error("No earlier voyage to flash back to.");

  const tie = (target.leg.phase === "port" || target.leg.phase === "landfall") ? "port"
    : (pc.dots?.[actionUsed] ?? 0) >= 2 ? "playbook" : null;
  const cost = stressCost({ pc, atDay, targetDay: target.day, actionUsed, tie });
  pc.stress = (pc.stress || 0) + cost;

  const beat = {
    kind: "flashback", date: target.date, flashback: true, atDate: log[atDay]?.date,
    actors: [{ name: pc.name, isPC: true }],
    actionUsed, stress: cost,
    summary: `— Flashback to ${target.longDate}, ${target.leg.place}: ${description}`,
    salience: 0.8, pcInvolved: true,
  };
  target.incidents.push(beat);
  const trauma = pc.stress >= 9;
  if (trauma) pc.stress = 0;
  return {
    beat, stress: cost, totalStress: pc.stress, trauma,
    note: trauma ? `${pc.name} has taken TRAUMA — the stress track broke.` : null,
  };
}
