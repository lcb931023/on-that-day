// The AI STORYTELLER (director). Like RimWorld, it deals events as cards: it reads
// the voyage state (danger of the leg, crew mood & health, days at sea, days since
// the last blow) and fires INCIDENTS by mean-time-between + suitability, shaped by a
// tension curve and an ADAPTATION factor that eases off after casualties so the crew
// can recover. Three personalities pace the same content differently.

import { addThought, clamp, mood } from "./pawns.js";

export const PERSONALITIES = {
  cassandra: { name: "Cassandra Classic", threat: 1.0, ramp: 0.010, chaos: 0.15 }, // rising tension
  phoebe:    { name: "Phoebe Chillax",   threat: 0.7, ramp: 0.004, chaos: 0.10 }, // spaced out, gentle
  randy:     { name: "Randy Random",     threat: 1.0, ramp: 0.0,   chaos: 0.55 }, // pure chaos
};

// ---- victim helpers ----
function alive(roster) { return roster.filter((p) => p.alive); }
function weakest(roster, need) {
  return alive(roster).slice().sort((a, b) => a.needs[need] - b.needs[need])[0];
}
function kill(pawn, cause, roster, day) {
  pawn.alive = false; pawn.causeOfDeath = cause; pawn.diedDay = day;
  for (const p of alive(roster)) {
    const bond = p.rel[pawn.id] ?? 0;
    addThought(p, `mourns ${pawn.name}`, -0.4 - Math.max(0, bond) * 0.4, 12, day);
  }
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
];

export function makeStoryteller(personality = "cassandra") {
  const p = PERSONALITIES[personality] || PERSONALITIES.cassandra;
  return {
    personality: p, name: p.name,
    tension: 0.2, adaptation: 0, daysSinceIncident: 0,
    // Called once per day. Returns fired incident raw events.
    day(ctx) {
      const c = { ...ctx, avgMood: ctx.avgMood };
      // update curves
      this.tension = clamp(this.tension + p.ramp + (c.leg.danger - 0.4) * 0.01, 0, 1);
      this.adaptation = Math.max(0, this.adaptation - 0.05);
      this.daysSinceIncident++;

      const fired = [];
      const overdue = clamp(this.daysSinceIncident / 20, 0, 1.5); // pressure to make something happen
      for (const inc of INCIDENTS) {
        if (!inc.eligible(c)) continue;
        // effective mean-time-between, shaped by danger, tension, personality, overdue.
        let mtb = inc.mtb;
        const dangerF = 0.5 + c.leg.danger; // 0.5..1.5
        const tensionF = 0.7 + this.tension * 0.9;
        const threatMul = inc.threat ? p.threat * (1 - this.adaptation * 0.6) : 1;
        mtb = mtb / (dangerF * tensionF * threatMul * (0.8 + overdue * 0.5));
        mtb = Math.max(1.2, mtb);
        let pDay = 1 - Math.exp(-(c.dt || 1) / mtb); // gap between journal days raises the odds
        pDay += p.chaos * (c.rng() - 0.5) * 0.1; // personality chaos jitter
        if (c.rng.chance(clamp(pDay, 0, 0.9))) {
          const ev = inc.fire(c);
          if (ev) {
            fired.push(ev);
            this.daysSinceIncident = 0;
            this.tension = clamp(this.tension - (inc.threat ? 0.12 : 0.03), 0, 1); // release
            if (ev.dead || ev.casualty?.dead) this.adaptation = clamp(this.adaptation + 0.5, 0, 1);
          }
          if (personality !== "randy") break; // Randy can stack; others fire one/day
        }
      }
      return fired;
    },
  };
}
