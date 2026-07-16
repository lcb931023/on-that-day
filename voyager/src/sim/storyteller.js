// The AI STORYTELLER (director). Like RimWorld, it deals events as cards: it reads
// the voyage state (danger of the leg, crew mood & health, days at sea, days since
// the last blow) and fires INCIDENTS by mean-time-between + suitability, shaped by a
// tension curve and an ADAPTATION factor that eases off after casualties so the crew
// can recover. Three personalities pace the same content differently.
//
// Iteration B adds three more directorial levers, all RimWorld-derived:
//   - a WEALTH analog (how much the ship has to lose: population x health x stores)
//     that scales threat pressure up the way RimWorld's wealth scales raid points;
//   - a POPULATION INTENT that eases off once losses cut deep, and leans in when the
//     company is full and thriving, so the story doesn't grind a shrunken crew to zero;
//   - Cassandra's classic build-up/climax/lull CYCLE, distinct from Phoebe's flat
//     gentle ramp and Randy's cycle-blind chaos.
// It also now deals incidents that reach into the relationship graph the crew have
// built (see pawns.js `bond`/`feuds`): duels between standing enemies, friction
// between the ship's factions, a mentor's breakthrough with their protege, and
// reconciliations that let a long grudge finally pay off.

import { addThought, nudgeRel, clamp, mood } from "./pawns.js";

export const PERSONALITIES = {
  cassandra: { name: "Cassandra Classic", threat: 1.0, ramp: 0.010, chaos: 0.15, adaptDecay: 0.05 }, // classic build/climax/lull
  phoebe:    { name: "Phoebe Chillax",   threat: 0.7, ramp: 0.004, chaos: 0.10, adaptDecay: 0.09 }, // spaced out, gentle, forgives fast
  randy:     { name: "Randy Random",     threat: 1.0, ramp: 0.0,   chaos: 0.55, adaptDecay: 0.03 }, // pure chaos, doesn't care who's struggling
};

// ---- victim helpers ----
function alive(roster) { return roster.filter((p) => p.alive); }
function weakest(roster, need) {
  return alive(roster).slice().sort((a, b) => a.needs[need] - b.needs[need])[0];
}
// A death lands hardest on whoever was closest — a beloved officer's loss should
// read as heavier than a stranger's. Strong mourners get a bigger, longer thought,
// which (via breaks.js, run right after incidents each day) can tip a bonded
// shipmate straight into a mental break the same day the news breaks.
function kill(pawn, cause, roster, day) {
  pawn.alive = false; pawn.causeOfDeath = cause; pawn.diedDay = day;
  for (const p of alive(roster)) {
    const bond = p.rel[pawn.id] ?? 0;
    const bondKind = p.bond[pawn.id]?.kind;
    const closeness = Math.max(bond, ["friend", "mentor", "protege"].includes(bondKind) ? 0.6 : 0);
    if (closeness <= 0.01) continue;
    addThought(p, `mourns ${pawn.name}`, -0.4 - closeness * 0.5, closeness > 0.5 ? 20 : 12, day);
  }
}

// Wealth analog (RimWorld: raid points scale with colony wealth) — how much the ship
// currently has to lose. A full, healthy, well-stored ship draws harder incidents.
function shipWealth(aliveCount, totalCrew, avgHealth, provisions) {
  return clamp((aliveCount / Math.max(1, totalCrew)) * avgHealth * (0.5 + provisions * 0.5), 0, 1);
}

// Population intent (RimWorld: storytellers lean toward a target population) — ease
// off once losses cut past half the company; lean in a little when the ship is full.
function populationIntent(ratio) {
  if (ratio < 0.55) return 0.55;
  if (ratio > 0.85) return 1.15;
  return 1.0;
}

// ---- incident catalogue ----
// Each: eligible(ctx) gate, mtb (mean days between, lower = more frequent),
// threat flag (subject to adaptation), and fire(ctx) -> raw event.
const INCIDENTS = [
  {
    kind: "storm", threat: true, mtb: 22,
    eligible: (c) => c.leg.phase === "sea" || c.leg.danger > 0.5,
    fire: (c) => {
      const sev = c.leg.danger * c.rng.range(0.6, 1.2);
      for (const p of alive(c.roster)) { p.needs.morale = clamp(p.needs.morale - 0.2 * sev, 0, 1); p.needs.rest = clamp(p.needs.rest - 0.25 * sev, 0, 1); }
      let casualty = null;
      if (c.rng.chance(0.10 * sev)) {
        const v = c.rng.pick(alive(c.roster));
        if (c.rng.chance(0.35)) { kill(v, "washed overboard in the gale", c.roster, c.day); casualty = { pawn: v, dead: true }; }
        else { v.needs.health = clamp(v.needs.health - c.rng.range(0.15, 0.35), 0, 1); casualty = { pawn: v, dead: false }; }
      }
      return { kind: "storm", severity: sev, casualty, actors: casualty ? [casualty.pawn] : [], salience: 0.7 + sev * 0.2,
        summary: casualty ? `A gale off ${c.leg.place} ${casualty.dead ? "took" : "near-drowned"} ${casualty.pawn.name}.`
                          : `A hard blow off ${c.leg.place} kept all hands at the pumps.` };
    },
  },
  {
    kind: "scurvy", threat: true, mtb: 16,
    eligible: (c) => c.leg.phase === "sea" && c.provisions < 0.6 && c.daysAtSea > 30,
    fire: (c) => {
      const v = weakest(c.roster, "nutrition");
      v.needs.health = clamp(v.needs.health - c.rng.range(0.12, 0.28), 0, 1);
      addThought(v, "gums bleed, joints ache — scurvy", -0.5, 20, c.day);
      return { kind: "scurvy", actors: [v], salience: 0.6,
        summary: `${v.name} shows the scurvy — loose teeth and dark blotches — despite Cook's sauerkraut.` };
    },
  },
  {
    kind: "fever", threat: true, mtb: 6,
    eligible: (c) => /Batavia|Indian Ocean/.test(c.leg.region || ""),
    fire: (c) => {
      const v = c.rng.pick(alive(c.roster));
      if (c.rng.chance(0.5)) { kill(v, "the Batavia flux", c.roster, c.day); return { kind: "fever", actors: [v], dead: true, salience: 0.8, summary: `The Batavia sickness carries off ${v.name}.` }; }
      v.needs.health = clamp(v.needs.health - c.rng.range(0.2, 0.4), 0, 1);
      addThought(v, "burning with the Batavia fever", -0.5, 10, c.day);
      return { kind: "fever", actors: [v], dead: false, salience: 0.6, summary: `${v.name} falls to the fever that stalks the ship.` };
    },
  },
  {
    kind: "accident", threat: true, mtb: 40,
    eligible: (c) => c.leg.phase === "sea",
    fire: (c) => {
      const v = c.rng.pick(alive(c.roster));
      v.needs.health = clamp(v.needs.health - c.rng.range(0.1, 0.3), 0, 1);
      addThought(v, "fell from the rigging", -0.4, 8, c.day);
      return { kind: "accident", actors: [v], salience: 0.55, summary: `${v.name} fell from the rigging and lies stove-in below.` };
    },
  },
  {
    kind: "landfall_wonder", threat: false, mtb: 6,
    eligible: (c) => c.leg.phase === "landfall" || c.leg.phase === "port",
    fire: (c) => {
      for (const p of alive(c.roster)) p.needs.morale = clamp(p.needs.morale + 0.15, 0, 1);
      const v = c.rng.pick(alive(c.roster));
      addThought(v, `wonder of ${c.leg.place}`, 0.4, 8, c.day);
      return { kind: "landfall_wonder", actors: [v], place: c.leg.place, salience: 0.45,
        summary: `Ashore at ${c.leg.place}, ${v.name} beheld sights no shipmate would believe.` };
    },
  },
  {
    kind: "first_contact", threat: false, mtb: 5,
    eligible: (c) => (/New Zealand|New Holland/.test(c.leg.region || "")) && c.leg.phase === "landfall",
    fire: (c) => {
      const v = c.rng.pick(alive(c.roster));
      const tense = c.rng.chance(0.5);
      for (const p of alive(c.roster)) { p.needs.safety = clamp(p.needs.safety - (tense ? 0.25 : 0), 0, 1); p.needs.morale = clamp(p.needs.morale + 0.1, 0, 1); }
      addThought(v, `met the people of ${c.leg.place}`, tense ? -0.2 : 0.5, 12, c.day);
      return { kind: "first_contact", actors: [v], tense, place: c.leg.place, salience: 0.8,
        summary: tense ? `A meeting with the people of ${c.leg.place} turned to spears and muskets.`
                       : `${v.name} traded greetings and gifts with the people of ${c.leg.place}.` };
    },
  },
  {
    kind: "theft", threat: false, mtb: 12,
    eligible: (c) => c.leg.phase === "port" || c.leg.phase === "landfall",
    fire: (c) => {
      const thief = c.rng.pick(alive(c.roster));
      addThought(thief, "light-fingered ashore", -0.1, 4, c.day);
      return { kind: "theft", actors: [thief], place: c.leg.place, salience: 0.4,
        summary: `Something went missing at ${c.leg.place}; suspicion fell on ${thief.name}.` };
    },
  },
  {
    kind: "mutiny_mutter", threat: false, mtb: 10,
    eligible: (c) => c.avgMood < 0.42 && alive(c.roster).length > 0,
    fire: (c) => {
      const living = alive(c.roster);
      const grumblers = living.filter((p) => mood(p) < 0.4).slice(0, 3);
      const ring = grumblers[0] || c.rng.pick(living);
      return { kind: "mutiny_mutter", actors: grumblers.length ? grumblers : [ring], salience: 0.7,
        summary: `Low, dangerous muttering on the gun deck — ${ring.name} at the heart of it.` };
    },
  },
  {
    kind: "wildlife", threat: false, mtb: 30,
    eligible: (c) => /New Holland|Endeavour River|Barrier Reef/.test(c.leg.region || ""),
    fire: (c) => {
      const v = c.rng.pick(alive(c.roster));
      addThought(v, "saw a beast none could name", 0.3, 6, c.day);
      return { kind: "wildlife", actors: [v], salience: 0.4,
        summary: `${v.name} swore he saw a beast that hopped like a hare and stood like a man.` };
    },
  },

  // ---- relationship-graph incidents (Iteration B) ----
  {
    kind: "duel", threat: true, mtb: 34,
    eligible: (c) => alive(c.roster).some((p) => p.feuds.size && [...p.feuds].some((id) => alive(c.roster).some((o) => o.id === id))),
    fire: (c) => {
      const candidates = alive(c.roster).filter((p) => p.feuds.size);
      const a = c.rng.pick(candidates);
      const enemyIds = [...a.feuds].filter((id) => alive(c.roster).some((o) => o.id === id));
      const b = alive(c.roster).find((o) => o.id === c.rng.pick(enemyIds));
      if (!b) return null;
      const loser = c.rng.chance(0.5) ? a : b, winner = loser === a ? b : a;
      const fatal = c.rng.chance(0.12);
      if (fatal) kill(loser, `a duel with ${winner.name}`, c.roster, c.day);
      else loser.needs.health = clamp(loser.needs.health - c.rng.range(0.2, 0.4), 0, 1);
      nudgeRel(a, b, -0.2); nudgeRel(b, a, -0.2);
      winner.needs.morale = clamp(winner.needs.morale + (fatal ? -0.1 : 0.05), 0, 1); // even winning weighs on you
      return { kind: "duel", actors: [a, b], loser, winner, fatal, salience: 0.85, flogRisk: !fatal,
        summary: fatal
          ? `${winner.name} met ${loser.name} at dawn over their long feud — ${loser.name} did not rise.`
          : `${winner.name} and ${loser.name}, enemies of long standing, settled it with steel; ${loser.name} bears the mark of it.` };
    },
  },
  {
    kind: "faction_friction", threat: false, mtb: 14,
    eligible: (c) => alive(c.roster).some((p) => p.faction === "gentlemen") && alive(c.roster).some((p) => p.faction === "hands"),
    fire: (c) => {
      const gentlemen = alive(c.roster).filter((p) => p.faction === "gentlemen");
      const hands = alive(c.roster).filter((p) => p.faction === "hands");
      const g = c.rng.pick(gentlemen), h = c.rng.pick(hands);
      nudgeRel(g, h, -0.1); nudgeRel(h, g, -0.15);
      addThought(h, `galled by ${g.name}'s gentlemanly airs`, -0.2, 6, c.day);
      return { kind: "faction_friction", actors: [g, h], salience: 0.4,
        summary: `Sharp words between the gentlemen and the hands — ${h.name} will not soon forget ${g.name}'s tone.` };
    },
  },
  {
    kind: "mentor_breakthrough", threat: false, mtb: 18,
    eligible: (c) => alive(c.roster).some((p) => Object.values(p.bond).some((b) => b.kind === "mentor")),
    fire: (c) => {
      const mentors = alive(c.roster).filter((p) => Object.values(p.bond).some((b) => b.kind === "mentor"));
      const mentor = c.rng.pick(mentors);
      const [studentId] = Object.entries(mentor.bond).find(([, b]) => b.kind === "mentor");
      const student = alive(c.roster).find((p) => p.id === studentId);
      if (!student) return null;
      student.needs.morale = clamp(student.needs.morale + 0.25, 0, 1);
      nudgeRel(student, mentor, 0.15);
      addThought(student, `${mentor.name}'s teaching finally clicks`, 0.4, 8, c.day);
      return { kind: "mentor_breakthrough", actors: [mentor, student], salience: 0.45,
        summary: `Under ${mentor.name}'s eye, ${student.name} finally masters the trick of it.` };
    },
  },
  {
    kind: "reconciliation", threat: false, mtb: 26,
    eligible: (c) => c.avgMood > 0.5 && alive(c.roster).some((p) => p.feuds.size && [...p.feuds].some((id) => alive(c.roster).some((o) => o.id === id))),
    fire: (c) => {
      const candidates = alive(c.roster).filter((p) => p.feuds.size);
      const a = c.rng.pick(candidates);
      const enemyIds = [...a.feuds].filter((id) => alive(c.roster).some((o) => o.id === id));
      const b = alive(c.roster).find((o) => o.id === c.rng.pick(enemyIds));
      if (!b) return null;
      nudgeRel(a, b, 0.5); nudgeRel(b, a, 0.5);
      a.feuds.delete(b.id); b.feuds.delete(a.id);
      a.bond[b.id] = { kind: "friend", since: c.day }; b.bond[a.id] = { kind: "friend", since: c.day };
      addThought(a, `made peace with ${b.name} at last`, 0.4, 10, c.day);
      addThought(b, `made peace with ${a.name} at last`, 0.4, 10, c.day);
      return { kind: "reconciliation", actors: [a, b], salience: 0.5,
        summary: `${a.name} and ${b.name}, enemies of long standing, shook hands over shared hardship and let the old grudge go at last.` };
    },
  },
];

export function makeStoryteller(personality = "cassandra") {
  const p = PERSONALITIES[personality] || PERSONALITIES.cassandra;
  return {
    personality: p, name: p.name, key: personality,
    tension: 0.2, adaptation: 0, daysSinceIncident: 0,
    cyclePhase: "buildup", cycleDay: 0, // Cassandra's classic build-up/climax/lull
    // Called once per day. Returns fired incident raw events.
    day(ctx) {
      const c = { ...ctx, avgMood: ctx.avgMood };
      const totalCrew = c.roster.length;
      const aliveCount = alive(c.roster).length;

      // Randy is chaos incarnate — he doesn't soften for a struggling crew the way
      // Cassandra/Phoebe do; population intent and wealth-scaling barely touch him.
      const popIntent = this.key === "randy" ? 1 : populationIntent(aliveCount / totalCrew);
      const wealth = shipWealth(aliveCount, totalCrew, c.avgHealth, c.provisions);
      const wealthF = this.key === "randy" ? 1 : 0.75 + wealth * 0.55;

      // Cassandra's cadence: quiet build-up, a sharp climax, then a forced lull to
      // let the crew recover — distinct from Phoebe's flat gentle ramp and Randy's
      // total disregard for any cycle at all.
      let cycleMul = 1;
      if (this.key === "cassandra") {
        this.cycleDay++;
        const lens = { buildup: 14, climax: 4, lull: 8 };
        if (this.cyclePhase === "buildup" && this.cycleDay > lens.buildup) { this.cyclePhase = "climax"; this.cycleDay = 0; }
        else if (this.cyclePhase === "climax" && this.cycleDay > lens.climax) { this.cyclePhase = "lull"; this.cycleDay = 0; }
        else if (this.cyclePhase === "lull" && this.cycleDay > lens.lull) { this.cyclePhase = "buildup"; this.cycleDay = 0; }
        cycleMul = this.cyclePhase === "climax" ? 1.6 : this.cyclePhase === "lull" ? 0.5 : 1;
      }

      // update curves
      this.tension = clamp(this.tension + p.ramp + (c.leg.danger - 0.4) * 0.01, 0, 1);
      this.adaptation = Math.max(0, this.adaptation - p.adaptDecay);
      this.daysSinceIncident++;

      const fired = [];
      const overdue = clamp(this.daysSinceIncident / 20, 0, 1.5); // pressure to make something happen
      for (const inc of INCIDENTS) {
        if (!inc.eligible(c)) continue;
        // effective mean-time-between, shaped by danger, tension, personality, overdue,
        // ship wealth (more to lose draws harder threats), and population intent.
        let mtb = inc.mtb;
        const dangerF = 0.5 + c.leg.danger; // 0.5..1.5
        const tensionF = 0.7 + this.tension * 0.9;
        const threatMul = inc.threat ? p.threat * (1 - this.adaptation * 0.6) * wealthF * popIntent * cycleMul : cycleMul;
        // story-circle bias (thread 1, optional): incidents press harder in beats like
        // "unfamiliar"/"price" and ease off in "comfort"/"return" — see storycircle.js.
        // Only threat incidents are biased; wonders/first-contact stay beat-neutral so
        // beat 5 ("get what they wanted") isn't starved of its own texture.
        const beatMul = inc.threat ? (c.beatThreatMul ?? 1) : 1;
        mtb = mtb / (dangerF * tensionF * threatMul * beatMul * (0.8 + overdue * 0.5));
        mtb = Math.max(1.1, mtb);
        let pDay = 1 - Math.exp(-(c.dt || 1) / mtb); // gap between journal days raises the odds
        pDay += p.chaos * (c.rng() - 0.5) * 0.1; // personality chaos jitter
        if (c.rng.chance(clamp(pDay, 0, 0.9))) {
          const ev = inc.fire(c);
          if (ev) {
            fired.push(ev);
            this.daysSinceIncident = 0;
            this.tension = clamp(this.tension - (inc.threat ? 0.12 : 0.03), 0, 1); // release
            if (ev.dead || ev.casualty?.dead || ev.fatal) this.adaptation = clamp(this.adaptation + 0.5, 0, 1);
          }
          if (personality !== "randy") break; // Randy can stack; others fire one/day
        }
      }
      return fired;
    },
  };
}
