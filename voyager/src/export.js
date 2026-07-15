#!/usr/bin/env node
// Voyager EXPORT — runs the sim engine + offline narrator over the (real, anchored)
// Endeavour timeline and writes a self-contained JSON log for the browser viewer at
// voyager/web/. This is the "build step" the ITERATION A brief asks for:
//
//   node src/export.js --seed 7 --pc "Mary Blackwood:Surgeon" [--to 1771-07-10] [--llm]
//
// It writes:
//   voyager/output/voyage.json   (canonical build artifact)
//   voyager/web/voyage.json      (copy the static viewer fetches as its fallback /
//                                  fast-paint dataset)
//   voyager/web/cook.json        (copy of the real source journal — the viewer's
//                                  primary path fetches THIS and re-runs the actual
//                                  sim client-side via data/voyage-build.js, so
//                                  character creation in the browser is a real re-sim,
//                                  not just a swap between pre-baked files)
//
// Offline by default (deterministic templates). Add --llm to have the OPTIONAL
// OpenRouter pass rewrite the whole span into continuous prose (used for the Gazette
// only — per-day narration always uses the fast offline templates, LLM or not).

import { writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

for (const p of [resolve(process.cwd(), ".env"), resolve(homedir(), ".hermes/.env"), resolve(homedir(), ".env")]) {
  if (existsSync(p)) { try { process.loadEnvFile(p); } catch { /* ignore */ } }
}

import { VOYAGE } from "../data/voyage-loader.js";
import { createVoyage, sailTo } from "./sim/engine.js";
import { makeRng } from "./util/rng.js";
import { makePC, PLAYBOOKS } from "./ttrpg/characters.js";
import { narrateDayOffline, narrateSpanLLM, useLLM, hasContent } from "./narrate/narrator.js";
import { buildGazette } from "./artifacts/gazette.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const COOK_SRC = resolve(__dir, "../../data/source/voyages/cook.json");

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

// Serialize a pawn reference down to what the frontend needs (never the live sim
// object graph — that has circular-ish relationship maps and mutable state).
function serActor(p) {
  if (!p) return null;
  return { name: p.name, role: p.role, isPC: !!p.isPC };
}
function serBeat(b) {
  return {
    kind: b.kind,
    summary: b.summary || null,
    salience: +(b.salience || 0).toFixed(2),
    incident: !!b.incident,
    pcInvolved: !!b.pcInvolved,
    actors: (b.actors || []).map(serActor).filter(Boolean),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.llm) process.env.VOYAGER_LLM = "1";
  const seed = args.seed ? (Number(args.seed) || args.seed) : 7;
  const personality = args.personality || "cassandra";
  const pcSheets = pcsFromArgs(args);
  const pcs = pcSheets.length ? pcSheets : [];

  const state = createVoyage({ voyage: VOYAGE, seed, personality, pcs });
  sailTo(state, args.to || VOYAGE.end);

  const rng = makeRng(hashSeedLocal(seed));
  const days = state.log.map((rec) => ({
    day: rec.day,
    date: rec.date,
    longDate: rec.longDate,
    lat: rec.leg.lat ?? null,
    lng: rec.leg.lon ?? null, // engine.js stores it as `lon` on the record
    place: rec.leg.place,
    region: rec.leg.region,
    phase: rec.leg.phase,
    danger: +rec.leg.danger.toFixed(2),
    avgMood: +rec.avgMood.toFixed(3),
    avgHealth: +rec.avgHealth.toFixed(3),
    provisions: +rec.provisions.toFixed(3),
    tension: +rec.tension.toFixed(3),
    aliveCount: rec.aliveCount,
    hasContent: hasContent(rec),
    narration: narrateDayOffline(rec, rng),
    realEvents: rec.realEvents.map((e) => ({ text: e.text, marquee: !!e.marquee })),
    incidents: rec.incidents.map(serBeat),
    rawEvents: rec.rawEvents.map(serBeat),
    deaths: rec.deaths,
  }));

  let gazetteProse = null;
  if (useLLM()) {
    process.stderr.write(`Narrating full span through ${process.env.VOYAGER_MODEL || "openai/gpt-4o-mini"} for the Gazette lead…\n`);
    try { gazetteProse = await narrateSpanLLM(state.log, state.voyage); }
    catch (e) { process.stderr.write("LLM span narration failed, offline templates only: " + e.message + "\n"); }
  }

  const out = {
    meta: {
      ship: state.voyage.ship, captain: state.voyage.captain, source: state.voyage.source,
      complement: state.voyage.complement, start: state.voyage.start, end: state.voyage.end,
      seed, personality, generatedAt: new Date().toISOString(),
      pc: pcSheets[0] ? { name: pcSheets[0].name, playbook: pcSheets[0].playbook, dots: pcSheets[0].dots, special: pcSheets[0].special } : null,
      llm: useLLM(),
    },
    playbooks: Object.fromEntries(Object.entries(PLAYBOOKS).map(([k, v]) => [k, { dots: v.dots, traits: v.traits, special: v.special }])),
    roster: state.roster.map((p) => ({ name: p.name, role: p.role, traits: p.traits, isPC: !!p.isPC, alive: p.alive, causeOfDeath: p.causeOfDeath || null })),
    days,
    gazetteProse,
  };

  const outputPath = resolve(args.out ? String(args.out) : resolve(__dir, "../output/voyage.json"));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(out));
  console.log(`voyage.json written: ${outputPath} (${days.length} days, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);

  // Mirror into voyager/web/ so the static viewer is self-contained (fast-paint
  // fallback dataset + the raw journal for a genuine client-side re-simulation).
  const webDir = resolve(__dir, "../web");
  mkdirSync(webDir, { recursive: true });
  writeFileSync(resolve(webDir, "voyage.json"), JSON.stringify(out));
  copyFileSync(COOK_SRC, resolve(webDir, "cook.json"));
  console.log(`copied → ${resolve(webDir, "voyage.json")}`);
  console.log(`copied → ${resolve(webDir, "cook.json")}`);

  if (args.gazette) {
    const html = buildGazette({ records: state.log, meta: state.voyage, prose: gazetteProse ? "<p>" + gazetteProse.replace(/\n\n/g, "</p><p>") + "</p>" : null, rng });
    const gOut = resolve(__dir, "../output/gazette-full.html");
    writeFileSync(gOut, html);
    console.log(`gazette written: ${gOut}`);
  }
}

function hashSeedLocal(seed) {
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
