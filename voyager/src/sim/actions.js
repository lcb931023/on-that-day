// The utility AI. Each day every pawn scores possible actions against its most
// pressing NEED plus the world context, picks one (weighted, with noise), and the
// action mutates needs/thoughts/relationships and may emit a STRUCTURED RAW EVENT.
// Raw events are the "moving balls" — the narrator layers language on top later.

import { rel, nudgeRel, addThought, mood, clamp } from "./pawns.js";

// urgency of a need: sharply rising as satisfaction falls.
const urgency = (v) => (1 - v) * (1 - v);

// Build the candidate action menu for a pawn given world state + a partner (or null).
function candidates(pawn, world, partner, rng) {
  const n = pawn.needs;
  const inPort = world.leg.phase === "port" || world.leg.phase === "landfall";
  const list = [];

  // --- solo, need-driven ---
  list.push({ kind: "rest", solo: true, weight: urgency(n.rest) * 1.4 });
  list.push({ kind: "eat", solo: true, weight: urgency(n.nutrition) * 1.2 });
  list.push({ kind: "duty", solo: true, weight: 0.5 + mood(pawn) * 0.3 }); // work steadies
  if (n.health < 0.7) list.push({ kind: "convalesce", solo: true, weight: urgency(n.health) * 1.1 });
  if (inPort) list.push({ kind: "explore", solo: true, weight: 0.6 + (pawn.fx.landfallMorale || 0) });

  // --- social, partner-driven ---
  if (partner) {
    const r = rel(pawn, partner);
    // drink/chat with friends, especially when lonely
    list.push({ kind: "carouse", partner, weight: (0.5 + urgency(n.social)) * (1 + r) + (pawn.fx.drinkMorale ? 0.6 : 0) });
    list.push({ kind: "yarn", partner, weight: (0.4 + urgency(n.social)) * (1 + Math.max(0, r)) });
    list.push({ kind: "gamble", partner, weight: 0.35 * (1 + Math.max(0, r)) });
    // friction, escalating with grudges and low mood (kept rare so it stays notable)
    const spite = (pawn.fx.grudge || 0) + (1 - mood(pawn)) * 0.45 - Math.max(0, r) - 0.35;
    if (spite > 0) list.push({ kind: "quarrel", partner, weight: clamp(spite, 0, 1) * 0.5 });
    if (r < -0.4 && mood(pawn) < 0.4) list.push({ kind: "brawl", partner, weight: clamp(-r, 0, 1) * 0.5 });
    if (pawn.role === "Navigator-Priest" || pawn.traits.includes("wise"))
      list.push({ kind: "counsel", partner, weight: 0.4 });
  }
  return list.filter((c) => c.weight > 0.001);
}

// Apply a chosen action. Returns a raw event (or null for background noise).
function apply(pawn, act, world, day, rng) {
  const n = pawn.needs;
  const restEff = 1 + (pawn.fx.restEff || 0);
  switch (act.kind) {
    case "rest":
      n.rest = clamp(n.rest + 0.5 * restEff, 0, 1);
      n.health = clamp(n.health + 0.03, 0, 1);
      return null;
    case "eat": {
      const q = 0.25 + world.leg.fresh * 0.35 * world.provisions;
      n.nutrition = clamp(n.nutrition + q, 0, 1);
      if (world.leg.fresh < 0.4) addThought(pawn, "sick of salt pork and weevily biscuit", -0.4, 5, day);
      return null;
    }
    case "duty":
      n.morale = clamp(n.morale + 0.06, 0, 1);
      return null;
    case "convalesce":
      n.health = clamp(n.health + 0.05, 0, 1);
      n.rest = clamp(n.rest + 0.1, 0, 1);
      return null;
    case "explore":
      n.morale = clamp(n.morale + 0.35 + (pawn.fx.landfallMorale || 0), 0, 1);
      addThought(pawn, `went ashore at ${world.leg.place}`, 0.5, 8, day);
      return { kind: "explore", actors: [pawn], place: world.leg.place, salience: 0.5,
        summary: `${pawn.name} went ashore at ${world.leg.place}.` };
    case "carouse": {
      const p = act.partner;
      const gain = 0.3 + (pawn.fx.drinkMorale || 0);
      n.social = clamp(n.social + 0.35, 0, 1); n.morale = clamp(n.morale + gain, 0, 1);
      p.needs.social = clamp(p.needs.social + 0.3, 0, 1); p.needs.morale = clamp(p.needs.morale + 0.2, 0, 1);
      nudgeRel(pawn, p, 0.08); nudgeRel(p, pawn, 0.08);
      return { kind: "carouse", actors: [pawn, p], salience: 0.35,
        summary: `${pawn.name} shared grog with ${p.name} below decks.` };
    }
    case "yarn": {
      const p = act.partner;
      n.social = clamp(n.social + 0.3, 0, 1); p.needs.social = clamp(p.needs.social + 0.25, 0, 1);
      nudgeRel(pawn, p, 0.06); nudgeRel(p, pawn, 0.05);
      return { kind: "yarn", actors: [pawn, p], salience: 0.25,
        summary: `${pawn.name} spun a yarn with ${p.name} on the fo'c'sle.` };
    }
    case "gamble": {
      const p = act.partner; const won = rng.chance(0.5);
      n.social = clamp(n.social + 0.2, 0, 1);
      const w = won ? pawn : p, l = won ? p : pawn;
      addThought(w, "won at cards", 0.3, 4, day); addThought(l, "lost coin at cards", -0.3, 4, day);
      nudgeRel(l, w, -0.05);
      return { kind: "gamble", actors: [pawn, p], winner: w, loser: l, salience: 0.4,
        summary: `${w.name} won at dice off ${l.name}.` };
    }
    case "counsel": {
      const p = act.partner;
      p.needs.morale = clamp(p.needs.morale + 0.25, 0, 1); p.needs.safety = clamp(p.needs.safety + 0.15, 0, 1);
      addThought(p, `heard counsel from ${pawn.name}`, 0.3, 6, day);
      nudgeRel(p, pawn, 0.1);
      return { kind: "counsel", actors: [pawn, p], salience: 0.3,
        summary: `${pawn.name} steadied ${p.name}'s nerves with quiet counsel.` };
    }
    case "quarrel": {
      const p = act.partner;
      addThought(pawn, `quarrelled with ${p.name}`, -0.3, 5, day);
      addThought(p, `was crossed by ${pawn.name}`, -0.3, 5, day);
      nudgeRel(pawn, p, -0.12); nudgeRel(p, pawn, -0.12);
      return { kind: "quarrel", actors: [pawn, p], salience: 0.5,
        summary: `${pawn.name} and ${p.name} fell to hard words over the watch.` };
    }
    case "brawl": {
      const p = act.partner;
      const hurt = rng.chance(0.5) ? pawn : p;
      hurt.needs.health = clamp(hurt.needs.health - rng.range(0.05, 0.2), 0, 1);
      addThought(pawn, `brawled with ${p.name}`, -0.4, 6, day);
      addThought(p, `brawled with ${pawn.name}`, -0.4, 6, day);
      nudgeRel(pawn, p, -0.25); nudgeRel(p, pawn, -0.25);
      return { kind: "brawl", actors: [pawn, p], hurt, salience: 0.75, flogRisk: true,
        summary: `${pawn.name} and ${p.name} came to blows; ${hurt.name} took the worse of it.` };
    }
  }
  return null;
}

// One simulation step for one pawn.
export function stepPawn(pawn, world, roster, day, rng) {
  if (!pawn.alive) return null;
  // pick a plausible social partner (someone else alive), biased by relationship strength.
  const others = roster.filter((p) => p.alive && p !== pawn);
  let partner = null;
  if (others.length) {
    const weighted = others.map((p) => ({ p, weight: 0.3 + Math.abs(rel(pawn, p)) + rng() * 0.2 }));
    partner = (rng.weighted(weighted.map((w) => ({ weight: w.weight, p: w.p }))) || {}).p || rng.pick(others);
  }
  const cands = candidates(pawn, world, partner, rng);
  const choice = rng.weighted(cands) || cands[0];
  if (!choice) return null;
  return apply(pawn, choice, world, day, rng);
}
