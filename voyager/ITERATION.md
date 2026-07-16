# feat/voyager — the combined build

This branch **integrates all three parallel iterations** on top of the MVP
(`feat/voyager-ttrpg-mvp`). Each iteration was built cold in its own worktree off the
MVP; this branch merges them into one coherent product, with the conflicts resolved so
the deep sim, the narrative craft, and the browser front-end all run off the same engine.

Merge order: **B (deep sim) → C (narrative) → A (web)**.

## What each source branch contributed

### B — deep RimWorld simulation (`iter/voyager-deepsim`)
- Crew carry a **faction** (officers / gentlemen naturalists / hands / cultural outsider)
  and a **bond** map that classifies each relationship (friend, rival, mentor↔protege,
  feud), seeded from history (`SEED_BONDS`) and re-evaluated each day (`refreshBonds`).
- **Mental-break cascades + inspirations** (`src/sim/breaks.js`): a hard mood day tips a
  pawn into a break, whose fallout lands on bonded shipmates and can chain.
- Smarter storyteller: a **wealth analog**, **population intent**, and Cassandra's
  build/climax/lull **cycle**, plus relationship-aware incidents (duel, faction friction,
  mentor breakthrough, reconciliation).

### C — narrative craft & real-time loop (`iter/voyager-narrative`)
- **Dan Harmon story circle** (`src/narrate/storycircle.js`): the 8 beats shape both the
  LLM narration's framing (`BEAT_VOICE`) **and** the storyteller's incident pacing
  (`beatThreatMul`, wired through the engine context).
- Multiplayer **session / scene-handoff + flashback** loop (`src/ttrpg/session.js`,
  `cli session`).
- **Scheduled real-time artifact delivery** dry-run (`src/artifacts/scheduler.js`,
  `cli schedule`) — the "mails you a Gazette as it happens" angle.

### A — live Voyager Mode in the browser (`iter/voyager-web`)
- `voyager/web/` — a Leaflet map that plays the real route while a side panel streams the
  day's emergent narration, a ★-your-character thread, and an in-browser Gazette.
- The key structural move: an **isomorphic `data/voyage-build.js`** that holds all the
  pure timeline/crew/bond logic with **zero Node dependencies**, so the same simulation
  runs unmodified in Node (via `voyage-loader.js`, which reads `cook.json` off disk) and
  in the browser (via `web/app.js`, which fetches the same `cook.json`). Character
  creation **re-runs the whole voyage client-side**.

## Integration notes (how the conflicts were resolved)
- `src/sim/actions.js` — kept B's faction/feud/bond-weighted partner selection (superset
  of the others' seed-fix-only change).
- `src/sim/storyteller.js` — **multiplied** C's `beatMul` into B's richer `threatMul`
  (wealth × population intent × cassandra-cycle × story-beat), so both directorial layers
  act together.
- `src/sim/engine.js` — dropped the top-level `voyage-loader.js` import (A's browser-safety
  move) while keeping B's `refreshBonds` call; callers always pass `voyage` explicitly.
- `src/sim/pawns.js` / `data/voyage-build.js` — moved `SEED_BONDS` (B) into the isomorphic
  `voyage-build.js` (A) so the browser gets the seeded relationship web too.
- `src/narrate/narrator.js` — kept A's `typeof process` guard so `useLLM()` never throws in
  the browser, alongside C's story-circle framing.

## Run it
```bash
cd voyager
# offline CLI — the full deep sim + story-circle narration
node src/cli.js sail    --to 1771-07-10 --seed 7 --pc "Mary Blackwood:Surgeon"
node src/cli.js story   --to 1771-07-10 --seed 7        # Harmon-beat chaptering
node src/cli.js session --to 1769-10-15 --seed 7 --pc "Mary Blackwood:Surgeon"
node src/cli.js gazette --from 1769-04-13 --to 1769-06-10 --seed 7

# browser: build the web assets, then serve voyager/ over http://
node src/export.js
python3 -m http.server -d . 8000   # then open http://localhost:8000/web/
```
Add `--llm` (with `OPENROUTER_API_KEY`) to upgrade narration to the LLM path.
