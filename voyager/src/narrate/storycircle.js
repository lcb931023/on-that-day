// The DAN HARMON STORY CIRCLE, mapped onto the real Endeavour voyage.
//
// Harmon's circle (his own shorthand in parens) is a closed loop:
//   1. A character is in a zone of comfort              (YOU)
//   2. They want something                              (NEED)
//   3. They enter an unfamiliar situation                (GO)
//   4. Adapt to it                                       (SEARCH)
//   5. Get what they wanted                              (FIND)
//   6. Pay a heavy price for it                          (TAKE)
//   7. Return to their familiar situation                (RETURN)
//   8. Having changed                                    (CHANGE)
//
// We are not inventing a plot: Cook's actual voyage already has this shape, so the
// eight beats are pinned to REAL turning points already anchored in
// data/voyage-loader.js (the MILESTONES/HIGHLIGHTS derived from cook.json). This file
// does not add fiction, it choses where the reel of real history is *read* as which
// beat, then lets the narrator and (optionally) the storyteller shape their output to
// match. Boundaries are ordinary ISO dates so they stay legible and auditable.
//
// A voyage this specific only happens once, so the eight boundaries below are the
// voyage-level "spine" (thread 1: per-voyage). Per-PC nuance (thread 1 extension) is
// layered on top in `pcBeatState`: a given PC can be *personally* ahead of or behind
// the spine's beat 5/6 depending on their own incident log (their own "reward" or
// "price" may land on a different day than the fleet's).

export const BEATS = [
  { n: 1, id: "comfort", harmon: "YOU",    title: "A Ship at Peace",
    desc: "the character in a zone of comfort" },
  { n: 2, id: "want",    harmon: "NEED",   title: "The Want",
    desc: "they want something" },
  { n: 3, id: "unfamiliar", harmon: "GO",  title: "Into the Unfamiliar",
    desc: "they enter an unfamiliar situation" },
  { n: 4, id: "adapt",   harmon: "SEARCH", title: "Learning the New World",
    desc: "adapting to it" },
  { n: 5, id: "get",     harmon: "FIND",   title: "The Thing Itself",
    desc: "getting what they wanted" },
  { n: 6, id: "price",   harmon: "TAKE",   title: "The Heavy Price",
    desc: "paying a heavy price for it" },
  { n: 7, id: "return",  harmon: "RETURN", title: "Homeward Water",
    desc: "returning to the familiar situation" },
  { n: 8, id: "change",  harmon: "CHANGE", title: "Having Changed",
    desc: "having changed" },
];

// Voyage-level beat boundaries, keyed to real dates already present in
// data/voyage-loader.js's MILESTONES and HIGHLIGHTS:
//   - departure/Madeira/Rio     -> still the known Atlantic world (comfort)
//   - the push south             -> the stated mission pulls the ship on (want):
//                                   reach Tahiti in time for the Transit of Venus
//   - Tierra del Fuego            -> the first truly alien landfall, Banks's men die
//                                   of cold in a blizzard (threshold into "unfamiliar")
//   - the Horn -> Tahiti stay     -> the crew learns to live by South Seas custom,
//                                   Tupaia joins (adapt)
//   - the Transit of Venus         -> 3 June 1769: the literal, stated goal achieved (get)
//   - NZ/New Holland -> the Reef  -> exploration curdles: the ship strikes the Great
//     -> the Batavia dying time    Barrier Reef, then a third of the company dies of
//                                   fever at Batavia (pay a heavy price)
//   - the Cape -> homeward Atlantic -> recognisably European waters again (return)
//   - arrival home                 -> the log's own words: "a charted Pacific, and a
//                                   third of the company dead" (having changed)
const BOUNDARIES = [
  { from: "0000-00-00",  beat: 1 }, // voyage start (clamped by TIMELINE, see beatForDate)
  { from: "1768-09-19",  beat: 2 }, // Atlantic crossing begins — the push toward Tahiti
  { from: "1769-01-11",  beat: 3 }, // Tierra del Fuego landfall
  { from: "1769-01-22",  beat: 4 }, // rounding the Horn into the Pacific, then Tahiti
  { from: "1769-06-03",  beat: 5 }, // the Transit of Venus observed
  { from: "1769-07-14",  beat: 6 }, // NZ/New Holland/Reef/Batavia — the price accrues
  { from: "1771-03-15",  beat: 7 }, // the Cape of Good Hope, homeward
  { from: "1771-07-01",  beat: 8 }, // nearing home, the reckoning
];

export function beatForDate(iso) {
  let n = 1;
  for (const b of BOUNDARIES) if (iso >= b.from) n = b.beat;
  return BEATS[n - 1];
}

// ---- storyteller bias: how hard incidents should press in each beat ----
// Rising action into the threshold and the price; release on comfort/return.
const THREAT_BIAS = { comfort: 0.55, want: 0.8, unfamiliar: 1.15, adapt: 1.0,
  get: 0.85, price: 1.35, return: 0.6, change: 0.5 };
export function beatThreatMultiplier(beat) { return THREAT_BIAS[beat.id] ?? 1; }

// ---- vocabulary the narrator can lean on per beat, so prose is legibly "in" a beat
// without inventing events. Purely a register/tone shift over the same beats. ----
export const BEAT_VOICE = {
  comfort:    { register: "settled, domestic, the rhythm of familiar duty",
    openers: ["In the easy days of home water", "With England still astern and not yet missed", "In the last of the known world"] },
  want:       { register: "restless, purposeful, the pull of the mission ahead",
    openers: ["With the line for Tahiti drawn and the Transit not to be missed", "Southward, always southward, toward the day appointed", "The ship's whole purpose bent toward June and Tahiti"] },
  unfamiliar: { register: "disoriented, threshold-crossing, the world gone strange",
    openers: ["In a country that answered to no chart", "Where the compass meant less than the eye", "On a coast that owed nothing to home"] },
  adapt:      { register: "learning, provisional, new customs half-understood",
    openers: ["Feeling out the customs of a new shore", "Learning, by trial, how this world is used", "Settling, awkwardly, into a stranger's rhythm"] },
  get:        { register: "arrival, culmination, the point of it all",
    openers: ["On the day the whole voyage was made for", "With the instrument trained on the sun at last", "The purpose of three years' sailing come to its hour"] },
  price:      { register: "costly, grinding, the bill coming due",
    openers: ["With the reef still shuddering in memory", "In the fever town, where health went cheap", "The ledger of the dying time, entered daily"] },
  return:     { register: "familiar water returning, the world recognisable again",
    openers: ["In water that again looked like home", "With the Cape behind and England ahead", "Homeward, and every league more known than the last"] },
  change:     { register: "reckoning, retrospective, counting the cost and the gain",
    openers: ["Near home, and nothing aboard quite as it left", "Within sight of the life they'd left, and changed by the one they'd lived", "The voyage nearly told, and the company it made bearing little resemblance to the one that sailed"] },
};

// ---- chapters: group a log into contiguous runs that share a beat ----
export function buildChapters(log) {
  const chapters = [];
  for (const rec of log) {
    const beat = rec.beat || beatForDate(rec.date);
    let ch = chapters[chapters.length - 1];
    if (!ch || ch.beat.id !== beat.id) {
      ch = { beat, from: rec.date, to: rec.date, records: [] };
      chapters.push(ch);
    }
    ch.to = rec.date;
    ch.records.push(rec);
  }
  return chapters;
}

// ---- per-PC arc: independent of the voyage spine, driven by the PC's OWN log ----
// A PC can hit their personal "get" (best roll / most salient positive beat involving
// them) or their personal "price" (worst wound/death/trauma) on a different day than
// the fleet-level beat 5/6. We surface both so narration can say "for the ship, X; for
// you, Y" — the per-PC nuance the vision calls for.
// Sign of a beat FOR THIS PAWN specifically — a couple of kinds (gamble, tense first
// contact) read differently depending on which side of the event you were on, so a
// naive kind-only split would misfile e.g. a dice loss as the PC's personal "get".
function sign(b, pawnId) {
  if (POS_NEGATIVE_KINDS.has(b.kind) || b.dead || b.casualty?.dead) return -1;
  if (b.kind === "gamble") return b.winner?.id === pawnId ? 1 : -1;
  if (b.kind === "first_contact" && b.tense) return -1;
  if (b.kind === "theft") return -1;
  return 1;
}

export function pcArc(pawn, log) {
  const involved = [];
  for (const rec of log) for (const b of [...rec.incidents, ...rec.rawEvents]) {
    if (b.actors?.some((a) => a.id === pawn.id || a.name === pawn.name)) involved.push({ ...b, date: rec.date, longDate: rec.longDate });
  }
  const positive = involved.filter((b) => sign(b, pawn.id) > 0 && (b.salience || 0) >= 0.4);
  const negative = involved.filter((b) => sign(b, pawn.id) < 0);
  const best = positive.sort((a, b) => (b.salience || 0) - (a.salience || 0))[0] || null;
  const worst = negative.sort((a, b) => (b.salience || 0) - (a.salience || 0))[0] || null;
  const currentBeat = log.length ? beatForDate(log[log.length - 1].date) : BEATS[0];
  return {
    pawn: pawn.name, currentBeat,
    personalGet: best && { date: best.longDate, summary: best.summary },
    personalPrice: worst && { date: worst.longDate, summary: worst.summary },
    beatsVisited: [...new Set(involved.map((b) => beatForDate(b.date).id))],
  };
}
const POS_NEGATIVE_KINDS = new Set(["storm", "scurvy", "fever", "accident", "flogging", "brawl", "quarrel", "mutiny_mutter"]);
