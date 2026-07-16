// Pawns: crew + player characters. A pawn is a bundle of NEEDS (which drive
// behaviour), THOUGHTS (which sum into MOOD), RELATIONSHIPS, and cosmetic TRAITS.
// Deliberately small — RimWorld's lesson is to simulate the minimum that supports
// the stories we want, and let apophenia do the rest.
//
// Iteration B deepens the relationship web: a pawn also carries a FACTION (the
// ship's three-ish cliques — officers, gentlemen naturalists, the hands, and Tupaia
// as cultural outsider) and a BOND map that classifies each relationship (friend,
// rival, mentor/protege, feud) once it's lived-in enough to earn a label. Bonds seed
// a few historically-plausible starting textures and then escalate or heal through
// play — see `refreshBonds` below and the storyteller's relationship-aware incidents.

// Pulled from the pure ../../data/voyage-build.js (not voyage-loader.js) so this
// module has no Node (fs) dependency and can be imported directly in the browser.
import { CREW_SEED, SEED_BONDS } from "../../data/voyage-build.js";

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

// Three-ish shipboard cliques, keyed by role. Cross-faction friction and
// same-faction warmth are what let "officers vs. able seamen vs. the gentlemen"
// emerge as a readable pattern rather than a hand-authored plot.
const FACTION_OF = {
  Commander: "officers", "Second Lieutenant": "officers", "Third Lieutenant": "officers",
  Master: "officers", Gunner: "officers", Midshipman: "officers", Bosun: "officers",
  Naturalist: "gentlemen", Botanist: "gentlemen", Astronomer: "gentlemen", Surgeon: "gentlemen", Chaplain: "gentlemen",
  "Surgeon's Boy": "hands", Sailmaker: "hands", "Able Seaman": "hands", "Captain's Clerk": "hands",
  Quartermaster: "hands", Drummer: "hands", "Powder Monkey": "hands",
  "Navigator-Priest": "outsider",
};
export const factionOf = (role) => FACTION_OF[role] || "hands";

let _id = 0;
export function makePawn({ name, role, traits = [], isPC = false, playbook = null }) {
  return {
    id: `p${_id++}`,
    name, role, traits, isPC, playbook,
    fx: traitAgg(traits),
    faction: factionOf(role),
    alive: true,
    needs: { rest: 0.7, nutrition: 0.85, morale: 0.7, social: 0.6, health: 1.0, safety: 0.8 },
    thoughts: [],            // { label, mood, until }  (mood in [-1,1], until = day index)
    rel: {},                 // otherId -> [-1,1]
    bond: {},                // otherId -> { kind: friend|rival|mentor|protege|feud, since }
    feuds: new Set(),        // otherIds this pawn actively holds a feud against (duel-eligible)
    breakingUntil: -1, inspiredUntil: -1, lastBreakDay: -Infinity, // mental-break/inspiration cooldowns
    stress: 0,               // Blades-style, for PCs
    log: [],                 // notable personal beats (for the gazette / roleplay)
  };
}

function applySeedBonds(crew) {
  const byName = Object.fromEntries(crew.map((p) => [p.name, p]));
  const swap = { mentor: "protege", protege: "mentor" };
  for (const { a, b, rel: r, kind } of SEED_BONDS) {
    const pa = byName[a], pb = byName[b];
    if (!pa || !pb) continue;
    // seeded bonds aren't always perfectly mutual — a mentor rates the tie warmer
    // than the deference the protege feels back, etc.
    pa.rel[pb.id] = r; pb.rel[pa.id] = clamp(r * 0.85, -1, 1);
    pa.bond[pb.id] = { kind, since: 0 };
    pb.bond[pa.id] = { kind: swap[kind] || kind, since: 0 };
    if (kind === "rival" || kind === "feud") { pa.feuds.add(pb.id); pb.feuds.add(pa.id); }
  }
}

export function makeCrew() {
  const crew = CREW_SEED.map(makePawn);
  applySeedBonds(crew);
  return crew;
}

export function rel(a, b) { return a.rel[b.id] ?? 0; }
export function nudgeRel(a, b, d) {
  a.rel[b.id] = clamp((a.rel[b.id] ?? 0) + d, -1, 1);
}

// Bond thresholds: relationships earn a legible label once they're lived-in enough.
// Feuds are duel-eligible and persist until a `reconciliation` incident heals them;
// friendships (and existing mentor/protege ties) are sticky once formed.
const BOND_FEUD = -0.55, BOND_FRIEND = 0.55;
const STICKY = new Set(["friend", "mentor", "protege"]);

export function refreshBonds(roster, day) {
  const events = [];
  const alive = roster.filter((p) => p.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const r = (rel(a, b) + rel(b, a)) / 2;
      const cur = a.bond[b.id]?.kind;
      if (r <= BOND_FEUD && cur !== "feud") {
        a.bond[b.id] = { kind: "feud", since: day }; b.bond[a.id] = { kind: "feud", since: day };
        a.feuds.add(b.id); b.feuds.add(a.id);
        events.push({ kind: "feud_ignites", actors: [a, b], salience: 0.55,
          summary: `${a.name} and ${b.name} are open enemies now — a feud neither will let lie.` });
      } else if (r >= BOND_FRIEND && !STICKY.has(cur)) {
        a.bond[b.id] = { kind: "friend", since: day }; b.bond[a.id] = { kind: "friend", since: day };
        events.push({ kind: "bond_forms", actors: [a, b], salience: 0.4,
          summary: `${a.name} and ${b.name} have become fast friends.` });
      }
    }
  }
  return events;
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
