// SESSION: the multiplayer scene-handoff + resolution + flashback loop (thread 2).
//
// The MVP's `roleplay` command showed the shape for ONE pc with a scripted example.
// This module generalizes it for a TABLE of PCs and makes each step do real work:
//
//   1. HANDOFF   — for each PC, gather the autonomous beats that happened to/around
//                  them since the last handoff, so the table walks in synced up.
//   2. DECLARE    — a PC states an action; we resolve it with a Blades roll (position
//                  = risky by default, effect = standard) and apply the outcome back
//                  onto the pawn's needs/relationships, so play changes the sim state,
//                  not just the printed log.
//   3. FLASHBACK  — any PC may, before or after a roll, declare something their
//                  character already set up; it splices into the historical log AND
//                  (new here) can apply a concrete mechanical effect right now — the
//                  autonomous past becomes narratively AND mechanically load-bearing.
//   4. CHECKPOINT — the session's last-seen date is persisted (output/session-*.json)
//                  so a table can pick the campaign back up next sitting and the next
//                  handoff starts exactly where they left off.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { actionRoll, ACTIONS } from "./characters.js";
import { flashback as declareFlashbackRaw } from "./flashback.js";
import { clamp } from "../sim/pawns.js";

// ---- 1. scene handoff ----
// Gathers, per PC, the beats since `sinceDate` (exclusive) through the current log's
// end that involve them, plus the single most salient day for the WHOLE table (the
// natural "cold open" for the session) even if no single PC was in it.
export function sceneHandoff(state, { sinceDate = null } = {}) {
  const log = sinceDate ? state.log.filter((r) => r.date > sinceDate) : state.log;
  const pcs = state.roster.filter((p) => p.isPC);
  const perPC = pcs.map((pawn) => {
    const beats = [];
    for (const rec of log) for (const b of [...rec.incidents, ...rec.rawEvents]) {
      if (b.actors?.some((a) => a.id === pawn.id)) beats.push({ ...b, date: rec.date, longDate: rec.longDate, place: rec.leg.place });
    }
    return { pawn, beats: beats.sort((a, b) => (b.salience || 0) - (a.salience || 0)) };
  });
  const coldOpen = log.slice().sort((a, b) => salience(b) - salience(a))[0] || state.log[state.log.length - 1];
  return { since: sinceDate, through: state.date, coldOpen, perPC, spanDays: log.length };
}
function salience(rec) { return Math.max(0, ...[...rec.incidents, ...rec.rawEvents].map((b) => b.salience || 0)); }

// ---- 2. resolution ----
// Rolls the declared action and applies its outcome to the pawn's live sim state:
// success feeds morale/relationship/health forward, bad outcomes cost something —
// so a roleplayed scene has the same kind of consequence the autonomous sim does.
export function resolveAction({ pcPawn, pcSheet, action, description, rng, position = "risky" }) {
  const roll = actionRoll(pcSheet, action, rng);
  const n = pcPawn.needs;
  const sev = position === "desperate" ? 0.3 : position === "controlled" ? 0.12 : 0.2;
  let consequence = null;
  if (roll.outcome === "success") {
    n.morale = clamp(n.morale + 0.15, 0, 1);
    consequence = "clean success — no cost.";
  } else if (roll.outcome === "partial") {
    n.morale = clamp(n.morale + 0.05, 0, 1);
    n.rest = clamp(n.rest - sev * 0.5, 0, 1);
    pcPawn.stress = (pcPawn.stress || 0) + 1;
    consequence = "you get it, but at a cost — +1 stress, some rest spent.";
  } else {
    n.health = clamp(n.health - sev, 0, 1);
    n.morale = clamp(n.morale - 0.1, 0, 1);
    pcPawn.stress = (pcPawn.stress || 0) + 2;
    consequence = "it goes wrong — harm taken, +2 stress.";
  }
  return { action, description, position, roll, consequence, stress: pcPawn.stress };
}

// ---- 3. flashback with a mechanical effect ----
// Same splice as ttrpg/flashback.js, plus an optional `effect` applied to the PC's
// CURRENT needs right now, so "I had stashed lime juice" doesn't just read well — it
// measurably helps the roll/scene that follows. Effects are small and capped so a
// flashback is a hedge, never a free win.
const EFFECT_PRESETS = {
  supplies: { need: "health", delta: 0.12, label: "the stashed supplies pay off" },
  rest:     { need: "rest",   delta: 0.15, label: "the quiet arrangement gave you room to breathe" },
  favor:    { need: "morale", delta: 0.12, label: "a favor called in lifts the company's spirit" },
  ally:     { need: "social", delta: 0.15, label: "a friend made earlier steps up now" },
};
export function declareFlashback({ pcPawn, pcSheet, log, atDay, description, actionUsed = "Consort", preset = null, rng }) {
  const fb = declareFlashbackRaw({ pc: pcSheet, log, atDay, description, actionUsed, rng });
  let effect = null;
  const p = preset && EFFECT_PRESETS[preset];
  if (p) {
    pcPawn.needs[p.need] = clamp(pcPawn.needs[p.need] + p.delta, 0, 1);
    effect = { ...p };
  }
  return { ...fb, effect };
}

// ---- 4. session checkpoint persistence ----
export function checkpointPath(outDir, seed) { return `${outDir}/session-${seed}.json`; }
export function loadCheckpoint(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}
export function saveCheckpoint(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export const ACTION_MENU = ACTIONS;
