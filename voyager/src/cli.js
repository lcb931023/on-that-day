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
import { VOYAGE } from "../data/voyage-loader.js";

// Load environment (OPENROUTER_API_KEY) from the first .env we find, without adding
// a dependency. Node 24's process.loadEnvFile does the parsing.
for (const p of [resolve(process.cwd(), ".env"), resolve(homedir(), ".hermes/.env"), resolve(homedir(), ".env")]) {
  if (existsSync(p)) { try { process.loadEnvFile(p); } catch { /* ignore */ } }
}
import { createVoyage, sailTo, summarizeDay } from "./sim/engine.js";
import { makeRng } from "./util/rng.js";
import { mood } from "./sim/pawns.js";
import { makePC, actionRoll, PLAYBOOKS } from "./ttrpg/characters.js";
import { flashback } from "./ttrpg/flashback.js";
import { narrateDayOffline, narrateSpanLLM, useLLM, hasContent } from "./narrate/narrator.js";
import { buildGazette } from "./artifacts/gazette.js";

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

function help() {
  console.log(`
${C.b("Voyager")} — AI × human 跑团 voyage engine (MVP)

  ${C.cyan("sail")}     --to DATE [--seed N] [--personality cassandra|phoebe|randy] [--pc "Name:Playbook"] [--llm]
  ${C.cyan("gazette")}  --from DATE --to DATE [--out FILE.html] [--pc ...] [--llm]
  ${C.cyan("roleplay")} --to DATE --pc "Name:Playbook"   (scene handoff + flashback demo)
  ${C.cyan("crew")}     --to DATE                        (ship's company status)

  Playbooks: ${Object.keys(PLAYBOOKS).join(", ")}
  Dates ISO (YYYY-MM-DD), between ${VOYAGE.start} and ${VOYAGE.end}.
  Set ANTHROPIC_API_KEY and pass --llm for Claude narration; otherwise offline.
`);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || "help";
const table = { sail: cmdSail, gazette: cmdGazette, roleplay: cmdRoleplay, crew: cmdCrew, help };
(table[cmd] || help)(args);
