#!/usr/bin/env node
// Voyager CLI — drive the emergent voyage from the terminal.
//
//   node src/cli.js sail     --to 1769-06-10 --seed 7 [--pc "Mary Blackwood:Surgeon"] [--llm]
//   node src/cli.js gazette  --from 1769-04-13 --to 1769-06-10 --seed 7 [--out FILE] [--llm]
//   node src/cli.js roleplay --to 1769-10-12 --seed 7 --pc "Mary Blackwood:Surgeon"
//   node src/cli.js crew     --to 1770-06-20 --seed 7
//
// With OPENROUTER_API_KEY set and --llm, narration routes through an LLM; otherwise
// everything runs on the offline templates.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { VOYAGE } from "../data/voyage-loader.js";

// Load environment (OPENROUTER_API_KEY) from the first .env we find, without adding
// a dependency. Node 24's process.loadEnvFile does the parsing.
for (const p of [resolve(process.cwd(), ".env"), resolve(homedir(), ".hermes/.env"), resolve(homedir(), ".env")]) {
  if (existsSync(p)) { try { process.loadEnvFile(p); } catch { /* ignore */ } }
}
import { createVoyage, sailTo, summarizeDay } from "./sim/engine.js";
import { makeRng } from "./util/rng.js";
import { mood } from "./sim/pawns.js";
import { makePC, actionRoll, PLAYBOOKS, ACTIONS } from "./ttrpg/characters.js";
import { flashback } from "./ttrpg/flashback.js";
import { narrateDayOffline, narrateSpanLLM, narrateChapterOffline, narrateChapterLLM, useLLM, hasContent } from "./narrate/narrator.js";
import { buildChapters, pcArc, BEATS } from "./narrate/storycircle.js";
import { buildGazette } from "./artifacts/gazette.js";
import { sceneHandoff, resolveAction, declareFlashback, checkpointPath, loadCheckpoint, saveCheckpoint } from "./ttrpg/session.js";
import { planSchedule, simulateDelivery, parseInterval, emit as emitScheduled } from "./artifacts/scheduler.js";

const __dir = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [], pc: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pc") args.pc.push(argv[++i]);
    else if (a === "--llm") args.llm = true;
    else if (a.startsWith("--")) args[a.slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i];
    else args._.push(a);
  }
  return args;
}

function pcsFromArgs(args) {
  return args.pc.map((s) => {
    const [name, playbook] = s.split(":");
    return makePC({ name: name.trim(), playbook: (playbook || "Naturalist").trim() });
  });
}

function buildState(args) {
  if (args.llm) process.env.VOYAGER_LLM = "1";
  const pcs = pcsFromArgs(args);
  const state = createVoyage({ voyage: VOYAGE, seed: args.seed ? Number(args.seed) || args.seed : 7,
    personality: args.personality || "cassandra", pcs });
  sailTo(state, args.to || "1769-06-10");
  return state;
}

const C = { dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m` };

// word-wrap a paragraph to `width`, indenting each line by `indent` spaces.
function wrap(text, width = 88, indent = "  ") {
  const words = text.split(/\s+/); const lines = []; let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) { lines.push(indent + line.trim()); line = w; }
    else line += " " + w;
  }
  if (line.trim()) lines.push(indent + line.trim());
  return lines.join("\n");
}

async function cmdSail(args) {
  const state = buildState(args);
  const rng = makeRng(1234);
  console.log(C.b(`\n⚓ ${state.voyage.ship} — ${state.storyteller.name} · seed ${state.seed}\n`));
  for (const rec of state.log) {
    if (!hasContent(rec)) continue;
    const bar = "█".repeat(Math.round(rec.avgMood * 10)).padEnd(10, "░");
    console.log(`${C.cyan(rec.longDate)}  ${C.dim(rec.leg.place)}  ${C.dim("mood")} ${bar} ${rec.deaths.length ? C.red("† " + rec.deaths.length) : ""}`);
    if (useLLM()) { /* per-day LLM is done at span level in gazette; keep sail offline for speed */ }
    console.log(wrap(narrateDayOffline(rec, rng)) + "\n");
  }
  printCrew(state);
}

function printCrew(state) {
  console.log(C.b("\n— Ship's Company —"));
  for (const p of state.roster) {
    if (!p.alive) { console.log(`  ${C.red("†")} ${p.name.padEnd(22)} ${C.dim(p.role + " — " + p.causeOfDeath)}`); continue; }
    const m = mood(p); const face = m > 0.6 ? "🙂" : m > 0.45 ? "😐" : m > 0.32 ? "🙁" : "😠";
    const pc = p.isPC ? C.yellow(" ★PC") : "";
    console.log(`  ${face} ${p.name.padEnd(22)} ${C.dim(p.role.padEnd(18))} mood ${(m).toFixed(2)} health ${p.needs.health.toFixed(2)}${pc}`);
  }
  const dead = state.roster.filter((p) => !p.alive).length;
  console.log(C.dim(`\n  ${state.roster.length - dead} living, ${dead} dead of ${state.roster.length} souls.\n`));
}

async function cmdGazette(args) {
  const state = buildState(args);
  const from = args.from || state.voyage.start, to = args.to || state.date;
  const records = state.log.filter((r) => r.date >= from && r.date <= to);
  const rng = makeRng(99);
  let prose = null;
  if (useLLM()) {
    process.stderr.write(`Narrating span through ${process.env.VOYAGER_MODEL || "openai/gpt-4o-mini"}…\n`);
    try { prose = "<p>" + (await narrateSpanLLM(records, state.voyage)).replace(/\n\n/g, "</p><p>") + "</p>"; }
    catch (e) { process.stderr.write("LLM narration failed, using offline: " + e.message + "\n"); }
  }
  const html = buildGazette({ records, meta: state.voyage, prose, rng });
  const out = resolve(args.out ? String(args.out) : resolve(__dir, "../output", `gazette-${from}_${to}.html`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(C.green(`📰 Gazette written: ${out}`));
  console.log(C.dim(`   ${records.filter(hasContent).length} eventful days, span ${from} → ${to}`));
}

async function cmdRoleplay(args) {
  if (!args.pc.length) args.pc = ["Mary Blackwood:Surgeon"];
  const state = buildState(args);
  const rng = makeRng(555);
  const pcPawn = state.roster.find((p) => p.isPC);
  const pcSheet = pcsFromArgs(args)[0];
  // find the most salient PC scene = a day with a PC-involved beat
  const scenes = state.log.filter((r) => [...r.incidents, ...r.rawEvents].some((b) => b.pcInvolved));
  const scene = scenes.sort((a, b) => salience(b) - salience(a))[0] || state.log[state.log.length - 1];

  console.log(C.b(`\n🎭 SCENE HANDOFF — ${pcPawn.name}, ${pcPawn.role}`));
  console.log(C.dim(`Between roleplay you have been living autonomously aboard ${state.voyage.ship}.`));
  console.log(C.cyan(`\n${scene.longDate} — ${scene.leg.place}`));
  console.log(wrap(narrateDayOffline(scene, rng)));

  console.log(C.b(`\nYou take the wheel. Say what ${pcPawn.name.split(" ")[0]} does.`));
  // Demonstrate the resolution + flashback loop with a sample declared action.
  const roll = actionRoll(pcSheet, "Doctor", rng);
  console.log(C.dim(`\n(Example) You declare a risky action → roll ${roll.action} [${roll.rolls.join(",")}] = ${C.yellow(roll.outcome.toUpperCase())}`));

  console.log(C.b(`\n⏪ FLASHBACK`) + C.dim(" — invoke your autonomous past to gain an edge:"));
  const fb = flashback({ pc: pcSheet, log: state.log, atDay: scene.day,
    description: "you had quietly stocked lime juice and lint from the last port, against just such a day",
    actionUsed: "Doctor", rng });
  console.log("  " + C.yellow(fb.beat.summary));
  console.log(C.dim(`  Stress +${fb.stress} (now ${fb.totalStress}/9)${fb.trauma ? " — " + C.red(fb.note) : ""}`));
  console.log(C.dim(`\n  → The flashback is spliced into ${state.voyage.ship}'s log on ${fb.beat.date}; the autonomous past now serves the scene.\n`));
}

function salience(rec) { return Math.max(0, ...[...rec.incidents, ...rec.rawEvents].filter((b) => b.pcInvolved).map((b) => b.salience || 0)); }

function cmdCrew(args) { printCrew(buildState(args)); }

// wrap a chapter body that may contain several "\n\n"-separated day paragraphs,
// preserving the paragraph breaks (plain wrap() would smash them into one block).
function wrapParas(text) { return text.split("\n\n").map((p) => wrap(p)).join("\n\n"); }

// ---- story: Dan Harmon story-circle-shaped chapters (thread 1) ----
async function cmdStory(args) {
  const state = buildState(args);
  const rng = makeRng(321);
  const chapters = buildChapters(state.log);
  console.log(C.b(`\n📖 STORY CIRCLE — ${state.voyage.ship} · ${state.storyteller.name} · seed ${state.seed}`));
  console.log(C.dim(`Dan Harmon's eight-beat circle, mapped onto real turning points of Cook's voyage (src/narrate/storycircle.js).\n`));

  for (const ch of chapters) {
    const { beat } = ch;
    console.log(C.cyan(`┌─ Beat ${beat.n}/8 · ${beat.harmon} · "${beat.title}"`) + C.dim(`  ${ch.from} → ${ch.to}  (${beat.desc})`));
    let opener = null, body = null, closer = null;
    if (useLLM()) {
      try {
        process.stderr.write(`  narrating chapter ${beat.n}/8 through ${process.env.VOYAGER_MODEL || "openai/gpt-4o-mini"}…\n`);
        body = await narrateChapterLLM(ch, state.voyage);
      } catch (e) { process.stderr.write("  LLM failed, falling back offline: " + e.message + "\n"); }
    }
    if (!body) ({ opener, body, closer } = narrateChapterOffline(ch, rng));
    if (opener) console.log(wrap(opener));
    if (body) console.log(wrapParas(body));
    if (closer) console.log(C.dim(wrap(`» ${closer}`)));
    console.log();
  }

  const pcs = state.roster.filter((p) => p.isPC);
  if (pcs.length) {
    console.log(C.b("— Per-PC Arcs —") + C.dim("  (a PC's own get/price can land on a different day than the ship's)"));
    for (const pc of pcs) {
      const arc = pcArc(pc, state.log);
      console.log(`  ${C.yellow(pc.name)} is currently in beat ${arc.currentBeat.n}/8 — "${arc.currentBeat.title}".`);
      if (arc.personalGet) console.log(C.dim(`    personal "get": ${arc.personalGet.summary} (${arc.personalGet.date})`));
      if (arc.personalPrice) console.log(C.dim(`    personal "price": ${arc.personalPrice.summary} (${arc.personalPrice.date})`));
    }
    console.log();
  }
}

// ---- session: multiplayer scene-handoff + resolution + flashback loop (thread 2) ----
function topAction(pcSheet) {
  return ACTIONS.map((a) => [a, pcSheet.dots?.[a] || 0]).sort((a, b) => b[1] - a[1])[0][0];
}
function actionMenuStr(pcSheet) {
  return ACTIONS.map((a) => `${a}${"●".repeat(pcSheet.dots?.[a] || 0)}`).join("  ");
}
function colorOutcome(o) {
  return o === "success" ? C.green(o.toUpperCase()) : o === "partial" ? C.yellow(o.toUpperCase()) : C.red(o.toUpperCase());
}
function presetFor(playbook) {
  return { Surgeon: "supplies", Bosun: "rest", Chaplain: "favor", Naturalist: "ally", Master: "rest", Powder_Monkey: "ally" }[playbook] || "favor";
}

async function cmdSession(args) {
  if (!args.pc.length) args.pc = ["Mary Blackwood:Surgeon", "Tom Ashgrove:Bosun"];
  const state = buildState(args);
  const rng = makeRng(777);
  const pcSheets = pcsFromArgs(args);
  const pcPawns = state.roster.filter((p) => p.isPC);

  const outDir = resolve(__dir, "../output");
  const ckKey = `${state.seed}-${pcPawns.map((p) => p.name).join("_")}`.replace(/[^\w-]/g, "_");
  const ckPath = checkpointPath(outDir, ckKey);
  const checkpoint = args.fresh ? null : loadCheckpoint(ckPath);

  const handoff = sceneHandoff(state, { sinceDate: checkpoint?.lastDate || null });
  console.log(C.b(`\n🎭 SESSION HANDOFF — ${pcPawns.map((p) => p.name).join(", ")}`));
  console.log(C.dim(checkpoint
    ? `Picking up since your last session on ${checkpoint.lastDate} (checkpoint: ${ckPath}).`
    : "Opening session — walking in from the top of the voyage."));
  console.log(C.cyan(`\n${handoff.coldOpen.longDate} — ${handoff.coldOpen.leg.place}`));
  console.log(wrap(narrateDayOffline(handoff.coldOpen, rng)));

  for (const { pawn, beats } of handoff.perPC) {
    if (!beats.length) continue;
    console.log(C.b(`\n${pawn.name}'s autonomous thread since the last session:`));
    for (const b of beats.slice(0, 3)) console.log(C.dim(`  ${b.longDate} — ${b.summary}`));
  }

  const interactive = Boolean(process.stdin.isTTY) && !args.auto;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  console.log(C.b(`\nYou take the wheel.`) + C.dim(interactive
    ? " Each player, in turn, declares an action:"
    : " (non-interactive/--auto: auto-playing a scripted round so the loop is verifiable offline)"));

  for (let i = 0; i < pcPawns.length; i++) {
    const pcPawn = pcPawns[i], pcSheet = pcSheets[i];
    console.log(C.cyan(`\n— ${pcPawn.name} (${pcSheet.role}) —`));
    let action, description, position, doFlashback = false;
    if (interactive) {
      console.log(C.dim(`  Actions: ${actionMenuStr(pcSheet)}`));
      const a = (await rl.question(`  Choose an action for ${pcPawn.name.split(" ")[0]} (or Enter to skip): `)).trim();
      if (!a) { console.log(C.dim("  (skipped)")); continue; }
      action = ACTIONS.find((x) => x.toLowerCase().startsWith(a.toLowerCase())) || topAction(pcSheet);
      description = (await rl.question("  Describe what happens: ")).trim() || "makes a bid";
      position = (await rl.question("  Position [controlled/risky/desperate] (default risky): ")).trim() || "risky";
    } else {
      action = topAction(pcSheet);
      description = `pushes hard on ${action.toLowerCase()} to turn the scene`;
      position = "risky";
    }
    const res = resolveAction({ pcPawn, pcSheet, action, description, rng, position });
    console.log(`  → declares: ${description}`);
    console.log(`  → roll ${res.action} [${res.roll.rolls.join(",")}] = ${colorOutcome(res.roll.outcome)}  ${C.dim(res.consequence)}`);

    let fbDescription = null;
    if (interactive) {
      const fb = (await rl.question(`  ⏪ Flashback — declare something you'd already set up, or Enter to skip: `)).trim();
      if (fb) fbDescription = fb;
    } else if (i === 0) {
      fbDescription = "you had quietly arranged for exactly this, back at the last port call";
    }
    if (fbDescription) {
      const preset = interactive ? null : presetFor(pcSheet.playbook);
      const fb = declareFlashback({ pcPawn, pcSheet, log: state.log, atDay: handoff.coldOpen.day,
        description: fbDescription, actionUsed: action, preset, rng });
      console.log(C.yellow(`  ${fb.beat.summary}`));
      console.log(C.dim(`     stress +${fb.stress} (now ${fb.totalStress}/9)` +
        (fb.effect ? ` — ${fb.effect.label} (${fb.effect.need} +${fb.effect.delta})` : "") +
        (fb.trauma ? " — " + C.red(fb.note) : "")));
    }
  }
  if (rl) rl.close();

  saveCheckpoint(ckPath, { lastDate: state.date, seed: state.seed, pcs: pcPawns.map((p) => p.name), savedAt: new Date().toISOString() });
  console.log(C.b(`\n— End of session —`));
  for (const p of pcPawns) console.log(`  ${p.name}: mood ${mood(p).toFixed(2)}  health ${p.needs.health.toFixed(2)}  stress ${p.stress || 0}/9`);
  console.log(C.dim(`  Checkpoint saved → ${ckPath}\n  Next session's handoff will start right after ${state.date}.\n`));
}

// ---- schedule: dry-run real-time delivery scheduler (thread 3) ----
function fmtLocal(d) { return d.toISOString().replace("T", " ").slice(0, 16) + "Z"; }
function printScheduleEntry(e, delivered) {
  const tag = e.kind === "dispatch" ? C.red("DISPATCH") : C.cyan("GAZETTE ");
  const span = e.spanFrom === e.spanTo ? e.spanFrom : `${e.spanFrom} → ${e.spanTo}`;
  console.log(`    ${delivered ? C.green("✔") : C.dim("…")} ${fmtLocal(e.deliverAt)}  ${tag}  ${C.dim(span)}  ${e.subject}`);
}

async function cmdSchedule(args) {
  const state = buildState(args);
  const cadence = args.cadence || "weekly";
  const intervalStr = args.interval || "1d";
  const intervalMs = parseInterval(intervalStr);
  const startReal = args.start ? new Date(args.start) : new Date();
  const dispatchThreshold = args["dispatch-threshold"] !== undefined ? Number(args["dispatch-threshold"]) : 0.75;
  const plan = planSchedule({ log: state.log, cadence, startReal, intervalMs, dispatchThreshold });

  const simulateNow = args.now
    ? (args.now === "all" ? new Date((plan[plan.length - 1]?.deliverAt.getTime() || startReal.getTime()) + 1) : new Date(args.now))
    : new Date(startReal.getTime() + intervalMs * Math.max(1, Math.floor(plan.length / 3)));
  const sim = simulateDelivery(plan, simulateNow);

  console.log(C.b(`\n🗞  DELIVERY SCHEDULE — dry run (no network; this only plans + can render to disk)`));
  console.log(C.dim(`  ${state.voyage.ship} · ${plan.length} deliveries planned · cadence ${cadence} · ${intervalStr}/tick real time`));
  console.log(C.dim(`  Start: ${fmtLocal(startReal)}   "Now": ${fmtLocal(simulateNow)}\n`));

  console.log(C.green(`  Delivered (${sim.delivered.length}):`));
  if (!sim.delivered.length) console.log(C.dim("    (none yet as of \"now\")"));
  for (const e of sim.delivered.slice(-8)) printScheduleEntry(e, true);
  if (sim.delivered.length > 8) console.log(C.dim(`    … and ${sim.delivered.length - 8} earlier`));

  console.log(C.yellow(`\n  Pending (${sim.pending.length}):`));
  for (const e of sim.pending.slice(0, 8)) printScheduleEntry(e, false);
  if (sim.pending.length > 8) console.log(C.dim(`    … and ${sim.pending.length - 8} more`));

  if (args.emit) {
    const n = args.emit === true ? sim.delivered.length : (Number(args.emit) || sim.delivered.length);
    const outDir = resolve(__dir, "../output/schedule");
    console.log(C.b(`\n  Emitting ${Math.min(n, sim.delivered.length)} delivered artifact(s) → ${outDir}/`));
    for (const e of sim.delivered.slice(0, n)) console.log(C.dim(`    wrote ${emitScheduled(e, { meta: state.voyage, outDir })}`));
  } else {
    console.log(C.dim(`\n  (pass --emit to render delivered entries to output/schedule/*.html)`));
  }
  console.log();
}

function help() {
  console.log(`
${C.b("Voyager")} — AI × human 跑团 voyage engine (MVP)

  ${C.cyan("sail")}     --to DATE [--seed N] [--personality cassandra|phoebe|randy] [--pc "Name:Playbook"] [--llm]
  ${C.cyan("gazette")}  --from DATE --to DATE [--out FILE.html] [--pc ...] [--llm]
  ${C.cyan("story")}    --to DATE [--seed N] [--pc ...] [--llm]           (Dan Harmon story-circle chapters)
  ${C.cyan("session")}  --to DATE [--pc "Name:Playbook" ...] [--auto] [--fresh]
                                                                    (multiplayer scene handoff + resolution + flashback)
  ${C.cyan("schedule")} --to DATE [--cadence daily|weekly|biweekly|monthly] [--interval 1d] [--start ISO]
                                     [--now ISO|all] [--dispatch-threshold 0.75] [--emit [N]]
                                                                    (dry-run real-time delivery scheduler)
  ${C.cyan("roleplay")} --to DATE --pc "Name:Playbook"   (single-PC scene handoff + flashback demo)
  ${C.cyan("crew")}     --to DATE                        (ship's company status)

  Playbooks: ${Object.keys(PLAYBOOKS).join(", ")}
  Dates ISO (YYYY-MM-DD), between ${VOYAGE.start} and ${VOYAGE.end}.
  session runs interactively in a real terminal; add --auto (or pipe input) to auto-play offline.
  Set OPENROUTER_API_KEY and pass --llm for LLM narration; otherwise offline.
`);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || "help";
const table = { sail: cmdSail, gazette: cmdGazette, story: cmdStory, session: cmdSession,
  schedule: cmdSchedule, roleplay: cmdRoleplay, crew: cmdCrew, help };
(table[cmd] || help)(args);
