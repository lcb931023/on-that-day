// Pawns: crew + player characters. A pawn is a bundle of NEEDS (which drive
// behaviour), THOUGHTS (which sum into MOOD), RELATIONSHIPS, and cosmetic TRAITS.
// Deliberately small — RimWorld's lesson is to simulate the minimum that supports
// the stories we want, and let apophenia do the rest.

import { CREW_SEED } from "../../data/voyage-loader.js";

// Needs are satisfaction in [0,1] (1 = fully satisfied). Each has a per-day decay
// and a weight in the mood calculation.
export const NEED_DEFS = {
  rest:      { weight: 0.9, decay: 0.16, label: "Rest" },
  nutrition: { weight: 1.0, decay: 0.10, label: "Nutrition" },
  morale:    { weight: 1.1, decay: 0.09, label: "Morale" },
  social:    { weight: 0.8, decay: 0.11, label: "Fellowship" },
  health:    { weight: 1.4, decay: 0.0,  label: "Health" }, // health only moves on events/recovery
  safety:    { weight: 0.7, decay: 0.0,  label: "Safety" }, // set from environment each day
};

// Trait modifiers: how a cosmetic trait bends the simulation. Kept light.
const TRAIT_FX = {
  "hard-drinking": { drinkMorale: 0.15, healthDecay: 0.01 },
  drunkard:        { drinkMorale: 0.18, healthDecay: 0.02, moodBase: -0.03 },
  sickly:          { healthDecay: 0.02 },
  old:             { healthDecay: 0.015 },
  brave:           { fearResist: 0.5 },
  bold:            { fearResist: 0.4 },
  disciplined:     { restEff: 0.1, moodBase: 0.03 },
  temperate:       { moodBase: 0.03 },
  curious:         { landfallMorale: 0.2 },
  wise:            { moodBase: 0.04, fearResist: 0.3 },
  proud:           { grudge: 0.2 },
  resentful:       { grudge: 0.3 },
  greedy:          { grudge: 0.15 },
  merry:           { moodBase: 0.05 },
  young:           { restEff: 0.05 },
};

function traitAgg(traits) {
  const agg = {};
  for (const t of traits) {
    const fx = TRAIT_FX[t];
    if (!fx) continue;
    for (const [k, v] of Object.entries(fx)) agg[k] = (agg[k] || 0) + v;
  }
  return agg;
}

let _id = 0;
export function makePawn({ name, role, traits = [], isPC = false, playbook = null }) {
  return {
    id: `p${_id++}`,
    name, role, traits, isPC, playbook,
    fx: traitAgg(traits),
    alive: true,
    needs: { rest: 0.7, nutrition: 0.85, morale: 0.7, social: 0.6, health: 1.0, safety: 0.8 },
    thoughts: [],            // { label, mood, until }  (mood in [-1,1], until = day index)
    rel: {},                 // otherId -> [-1,1]
    stress: 0,               // Blades-style, for PCs
    log: [],                 // notable personal beats (for the gazette / roleplay)
  };
}

export function makeCrew() {
  return CREW_SEED.map(makePawn);
}

export function rel(a, b) { return a.rel[b.id] ?? 0; }
export function nudgeRel(a, b, d) {
  a.rel[b.id] = clamp((a.rel[b.id] ?? 0) + d, -1, 1);
}

export function addThought(pawn, label, mood, days, day) {
  pawn.thoughts.push({ label, mood, until: day + days });
}

export function expireThoughts(pawn, day) {
  pawn.thoughts = pawn.thoughts.filter((t) => t.until > day);
}

// Mood is the readable summary the storyteller and narrator key off of.
export function mood(pawn) {
  if (!pawn.alive) return 0;
  let m = 0.5 + (pawn.fx.moodBase || 0);
  for (const [k, def] of Object.entries(NEED_DEFS)) {
    m += (pawn.needs[k] - 0.6) * def.weight * 0.18;
  }
  for (const t of pawn.thoughts) m += t.mood * 0.12;
  return clamp(m, 0, 1);
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
