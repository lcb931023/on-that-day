// Loads the REAL voyage log that already ships with on-that-day
// (data/source/voyages/cook.json — 423 daily entries from Cook's own journal) and
// normalizes it into a timeline the simulation rides on. Each real journal day
// becomes one tick, carrying its authentic text + position; we overlay a light
// "region/phase/danger/fresh" classification so the storyteller and needs system
// know when the ship is at sea, in port, rounding the Horn, or on the reef.
//
// This is the anchor: the sim never contradicts the journal, it fills the silences
// between its lines with emergent shipboard life.
//
// This file is the NODE side of the loader (fs read of cook.json). All the actual
// timeline-building logic lives in the pure, isomorphic ./voyage-build.js, which is
// also imported directly by voyager/web/app.js so the browser can run the same real
// simulation client-side (fetching the same cook.json instead of reading it off disk).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildVoyage, CREW_SEED } from "./voyage-build.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const COOK_PATH = resolve(__dir, "../../data/source/voyages/cook.json");

const raw = JSON.parse(readFileSync(COOK_PATH, "utf8"));
const { TIMELINE, VOYAGE } = buildVoyage(raw);

export { TIMELINE, VOYAGE, CREW_SEED };
