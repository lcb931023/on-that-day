// Player characters, Blades-in-the-Dark flavoured. A PC is a normal sim pawn (it
// acts AUTONOMOUSLY between roleplay sessions) plus a playbook of ACTION RATINGS the
// player leans on when they take the wheel, plus STRESS/TRAUMA. The autonomous life
// and the roleplayed life are the same character — the flashback (see flashback.js)
// is what stitches them together.

// A compact action set adapted to shipboard TTRPG play (0..3 dots each).
export const ACTIONS = ["Rig", "Fight", "Doctor", "Survey", "Sway", "Skulk", "Command", "Consort"];

export const PLAYBOOKS = {
  Surgeon:   { traits: ["gentle", "exacting"], dots: { Doctor: 3, Study: 0, Survey: 2, Sway: 1, Fight: 0, Rig: 0, Skulk: 1, Command: 1, Consort: 1 }, special: "Once per voyage, pull a shipmate back from the brink of death." },
  Bosun:     { traits: ["gruff", "brave"],     dots: { Rig: 3, Fight: 2, Command: 2, Doctor: 0, Survey: 1, Sway: 1, Skulk: 0, Consort: 1 }, special: "You can drive the crew to a feat of seamanship no one thought possible." },
  Naturalist:{ traits: ["curious", "literate"],dots: { Survey: 3, Study: 3, Consort: 2, Doctor: 1, Sway: 1, Rig: 0, Fight: 0, Skulk: 1, Command: 0 }, special: "Ashore, you notice the one thing that changes everything." },
  Powder_Monkey:{ traits: ["young", "sharp-eyed"], dots: { Skulk: 3, Fight: 1, Rig: 2, Survey: 2, Sway: 1, Doctor: 0, Command: 0, Consort: 1 }, special: "Small and quick, you go where no grown sailor can." },
  Chaplain:  { traits: ["temperate", "wise"],  dots: { Sway: 3, Consort: 2, Command: 2, Doctor: 1, Survey: 1, Rig: 0, Fight: 0, Skulk: 0 }, special: "Your words can pull a man back from mutiny or despair." },
  Master:    { traits: ["hard-drinking", "skilled"], dots: { Survey: 3, Command: 2, Rig: 2, Consort: 1, Sway: 1, Fight: 1, Doctor: 0, Skulk: 0 }, special: "You always know where the ship truly is." },
};

export function makePC({ name, playbook }) {
  const pb = PLAYBOOKS[playbook];
  if (!pb) throw new Error(`Unknown playbook: ${playbook}. Choose one of: ${Object.keys(PLAYBOOKS).join(", ")}`);
  return {
    name, role: playbook.replace("_", " "), traits: pb.traits, isPC: true, playbook,
    dots: pb.dots, special: pb.special,
  };
}

// Roll: Blades resolution — roll N d6, take highest. N = dots (min 1, roll 2 take
// lowest if 0). 6 = full success, 4-5 = partial (with consequence), 1-3 = bad.
export function actionRoll(pc, action, rng, bonusDice = 0) {
  const dots = (pc.dots?.[action] ?? 0) + bonusDice;
  const n = Math.max(1, dots);
  const rolls = Array.from({ length: n }, () => 1 + rng.int(6));
  const best = dots <= 0 ? Math.min(...rolls) : Math.max(...rolls);
  const outcome = best >= 6 ? "success" : best >= 4 ? "partial" : "bad";
  return { action, dots, rolls, best, outcome };
}
