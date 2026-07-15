// The narrator turns the sim's structured beats into language. Two modes:
//   - offline (default): deterministic templates + variation pools. Always works.
//   - llm (VOYAGER_LLM=1 and ANTHROPIC_API_KEY set): Claude rewrites the day's beats
//     into a ship's-log entry, weaving the real historic events in.
// Per Sylvester: the sim supplies the "moving balls"; prose invites the reader's
// apophenia. We keep the beats visible and let language do the projecting.

import { chat, llmAvailable } from "./llm.js";

const OPENERS = [
  "This day", "These four-and-twenty hours", "Since the last glass",
  "Under a {sky} sky", "With the ship {motion}",
];
const SKY = ["leaden", "brassy", "clear", "squally", "pale"];
const MOTION = ["rolling easy", "pitching hard", "becalmed", "close-hauled", "running free"];

function pick(arr, rng) { return arr[Math.floor((rng ? rng() : Math.random()) * arr.length)]; }

function moodWord(m) {
  if (m > 0.7) return "the people in good heart";
  if (m > 0.55) return "the company steady enough";
  if (m > 0.42) return "spirits worn thin";
  if (m > 0.3) return "a sullen humour on the lower deck";
  return "the crew near to breaking";
}

// ---- offline narration of a single day ----
export function narrateDayOffline(rec, rng) {
  const lines = [];
  const opener = pick(OPENERS, rng).replace("{sky}", pick(SKY, rng)).replace("{motion}", pick(MOTION, rng));
  lines.push(`${opener} off ${rec.leg.place}, ${moodWord(rec.avgMood)}.`);

  for (const e of rec.realEvents) lines.push(e.text);          // real history, verbatim
  const beats = [...rec.incidents, ...rec.rawEvents].sort((a, b) => (b.salience || 0) - (a.salience || 0));
  for (const b of beats.slice(0, 5)) if (b.summary) lines.push(b.summary);
  for (const d of rec.deaths) lines.push(`${d.name} is dead of ${d.cause}. God rest him.`);
  return lines.join(" ");
}

// ---- offline narration of a span (for a gazette lead / column) ----
export function narrateSpanOffline(records, rng) {
  return records.filter((r) => hasContent(r)).map((r) => `${r.longDate}. ${narrateDayOffline(r, rng)}`).join("\n\n");
}

export function hasContent(rec) {
  return rec.realEvents.length || rec.incidents.length || rec.deaths.length ||
    rec.rawEvents.some((e) => e.salience >= 0.5);
}

// ---- LLM narration of a span: one prompt, returns prose ----
export async function narrateSpanLLM(records, meta = {}) {
  const beats = records.filter(hasContent).map((r) => ({
    date: r.longDate, place: r.leg.place, mood: +r.avgMood.toFixed(2),
    history: r.realEvents.map((e) => e.text),
    events: [...r.incidents, ...r.rawEvents].filter((e) => e.summary && e.salience >= 0.4).map((e) => e.summary),
    deaths: r.deaths.map((d) => `${d.name} — ${d.cause}`),
  }));
  const system =
    "You are the narrator of an emergent, historically-anchored sea voyage for a tabletop role-playing game. " +
    "You are given structured 'beats' from a simulation plus REAL historic events. Write vivid, period-flavoured " +
    "ship's-log prose (late 18th century, spare and concrete). Weave the real history and the simulated beats into " +
    "one seamless account. Never contradict the historic events. Keep the named characters' actions faithful to the beats. " +
    "Invite the reader to feel the crew's inner life without inventing new deaths or landfalls.";
  const user =
    `Voyage: ${meta.ship || "HMS Endeavour"} under ${meta.captain || "Lt. Cook"}.\n` +
    `Write a continuous log covering these days. Beats as JSON:\n\n${JSON.stringify(beats, null, 1)}`;
  return chat(system, user, { maxTokens: 1400, temperature: 0.9 });
}

export function useLLM() {
  const flag = typeof process !== "undefined" && process.env ? process.env.VOYAGER_LLM : undefined;
  return flag === "1" && llmAvailable();
}
