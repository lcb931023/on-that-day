# Iteration A — Live Voyager Mode in the browser

Branch: `iter/voyager-web`. Turns the MVP engine (`voyager/src/`) into a **browser
experience**: a Leaflet map plays HMS *Endeavour*'s real route while a side panel
streams that day's emergent narration, incidents, and a **★ your character** thread,
with in-browser character creation that **re-runs the actual simulation**, live,
client-side.

## Run it

```bash
cd voyager
node src/export.js --seed 7 --pc "Mary Blackwood:Surgeon" --gazette   # build step (optional)
python3 -m http.server 8787                                           # any static server works
```

Then open **http://localhost:8787/web/**.

- A plain static server is required — not because anything needs a backend, but
  because `fetch()` of local JSON and `import()` of ES modules are blocked under
  `file://` by browser security policy. `python3 -m http.server`, `npx serve`, or
  Vite's `preview` all work; just serve the **`voyager/` directory** (not `web/`
  itself), since `web/app.js` reaches into `../data/` and `../src/` by relative
  import — that's the whole point (see "How it works" below).
- `node src/export.js` is optional. `voyager/web/cook.json` and `voyager/web/voyage.json`
  are committed pre-built, so the viewer works straight out of a fresh clone. Re-run
  the export step if you change the sim and want the **fallback** dataset (see below)
  to reflect it — the **live** path always reflects the current code, no build needed.

No `OPENROUTER_API_KEY` required for any of this. If one is present (`~/.hermes/.env`)
the CLI's `--llm` flag still works for the Gazette's lead prose; the web viewer never
calls it (day-by-day narration is offline templates, deliberately — see below).

## What I verified (no browser automation available in this sandbox)

1. **Syntax**: `node --check` on every module the browser imports (engine, pawns,
   actions, world, storyteller, rng, dates, narrator, llm, characters, gazette,
   voyage-build) — all clean, and grepped for stray `node:` imports (none reachable
   from the browser's import graph).
2. **Serving**: started `python3 -m http.server` rooted at `voyager/`, then `curl`ed
   every asset `index.html`/`app.js`/`style.css`/`cook.json`/`voyage.json` and every
   module the browser dynamically imports (`../data/voyage-build.js`,
   `../src/sim/engine.js`, `../src/util/rng.js`, `../src/narrate/narrator.js` +
   `llm.js`, `../src/ttrpg/characters.js`, `../src/artifacts/gazette.js`) — all `200`,
   served as `text/javascript`.
3. **The actual live-mode logic**, end to end, from Node: `fetch()`ed `cook.json` from
   the running server (exactly as the browser does), then imported the same modules
   by path and replayed `boot()` → `runLiveVoyage()`'s call sequence
   (`buildVoyage` → `createVoyage` → `sailTo` → `narrateDayOffline` per day →
   `buildGazette` for the Gazette button). Confirmed: 423 real journal entries load,
   457-day timeline builds, the sim runs to completion (17 souls, deterministic death
   count), a PC-involved beat appears on day 0, and a Gazette HTML document builds
   from a 30-day slice. Reran three times — **identical output each time** (see fix
   below).
4. Ran the CLI regression (`sail`, `gazette`, `crew`, `roleplay`, and `gazette --llm`
   against the real OpenRouter key) to confirm the refactor didn't regress the
   existing offline/LLM paths.

I could not click through the actual DOM/Leaflet rendering in a real browser (no
Chromium/Playwright/Puppeteer in this sandbox) — that surface (event listeners, CSS,
the modal) is standard and was reviewed carefully, but budget a first real click-through
before calling this fully shipped.

## Design choices

**The browser runs the real simulation, not a canned replay.** The brief allowed
"acceptable to export a static voyage.json" as a fallback, but the MVP's sim modules
turned out to be pure, dependency-free ESM already — only `voyage-loader.js` (the
`fs.readFileSync` of `cook.json`) was Node-only. So I split it:

- `voyager/data/voyage-build.js` — **new**, pure, isomorphic. All the timeline logic
  (milestones, port/landfall synthesis, highlights) as `buildVoyage(raw)`, taking an
  already-parsed `cook.json` object. No `fs`/`path`/`url`.
- `voyager/data/voyage-loader.js` — now a 6-line Node shim: read the file, hand it to
  `buildVoyage()`. Existing CLI callers (`cli.js`, `pawns.js`, `engine.js`) unaffected.
- `voyager/web/app.js` does the browser-side equivalent: `fetch("./cook.json")` →
  `buildVoyage(raw)` → `createVoyage()` → `sailTo()`, importing `sim/engine.js`,
  `sim/pawns.js` (transitively), `narrate/narrator.js`, `ttrpg/characters.js`, and
  `artifacts/gazette.js` **unmodified**, straight from `../src/` via native ES module
  imports (no bundler, no build step).

This means "in-browser character creation that re-runs... a PC" (from the brief) is
literal: picking a playbook and clicking **Set sail** reruns `createVoyage` for the
whole 457-day timeline with your PC woven in, live, in the tab — not a swap between
pre-baked files. On this machine that full resimulation runs well under 200ms.

**Two changes were needed to make the sim itself browser-safe**, both backward
compatible:
- `src/sim/engine.js`: dropped the top-level `import { VOYAGE } from
  "../../data/voyage-loader.js"` (which would `fs.readFileSync` in a browser).
  `createVoyage({ voyage, ... })` now requires `voyage` explicitly — every caller
  (`cli.js`, `export.js`, the browser) already passed it explicitly, so nothing
  regresses; this was dead-default weight.
- `src/narrate/llm.js` / `narrator.js`: guarded `process.env` reads (`process` doesn't
  exist in a browser) behind a small `env()` helper. Effect: `llmAvailable()` just
  returns `false` client-side — offline templates take over silently, which is exactly
  the MVP's existing designed behavior for "no key."

**A real bug fix, found while verifying determinism**: `src/sim/actions.js` picked a
social partner using `Math.random()` instead of the seeded `rng` — silently breaking
the "reproducible from a seed" promise in `rng.js`'s own doc comment (confirmed: same
seed produced different death counts across runs before the fix, identical after).
Fixed to `rng()`. Small, but load-bearing here: the web UI's seed field means
something now, and a session's Gazette matches what the player actually saw.

**The static fallback still exists** (`voyager/output/voyage.json`, mirrored into
`voyager/web/voyage.json`), built by the new `node src/export.js`. `app.js` tries the
live path first and only falls back to this pre-baked JSON if `fetch`/`import` fails
for any reason (old browser, `file://`, a network hiccup fetching `cook.json`). In
fallback mode character creation is disabled (there's no live engine to rerun) and
the UI says so plainly rather than pretending to work.

**Reused from the existing frontend**: `VoyageLayer.jsx`'s `isValidPoint` guard
(`lat===0 && lng===0` is treated as missing, matching the Go backend's zero-value
float default) ported into `app.js`'s map code. The CARTO light tile URL matches
`MapView.jsx` for visual consistency with the rest of the app. I did **not** wire this
into the React app / Go backend directly — the brief explicitly green-lit the
self-contained static viewer as the pragmatic path, and going through Vite + the Go
API would have meant either duplicating the sim into a backend endpoint (defeats "the
browser runs the real simulation" story) or bundling zero-dependency ESM through Vite
for no real benefit. `voyager/web/` is plain HTML/CSS/JS, zero build tooling, zero
npm dependencies — it opens with any static file server.

**Narration is always offline in the browser.** LLM span-narration
(`narrateSpanLLM`) needs a server-side key and a network call per request; wiring that
through client-side would mean shipping the OpenRouter key to the browser, which is
wrong. Per-day narration was already offline-first in the MVP design (`sail` in the
CLI is offline by design; only `gazette --llm` uses the LLM, once, for the whole
span). The web viewer's **Gazette** button builds its HTML with `buildGazette(...,
prose: null, ...)`, which makes it fall back to the same offline per-day templates
--- consistent with the MVP's existing behavior, not a new limitation.

## What works

- Full 457-day timeline (423 real journal days + synthesized port/landfall stays)
  animates on a Leaflet map; route polyline + a glide-animated ship marker.
- Play/pause, speed selector, and a scrubber for the whole voyage.
- Side panel: today's mood/health bars, offline-template narration, top incidents,
  a dedicated **★ Your thread** box for PC-involved beats, and a scrolling "Ship's
  log" feed of past eventful days.
- In-browser character creation: name + playbook (from the same `PLAYBOOKS` the CLI
  uses) + seed → **Set sail** reruns the real simulation client-side.
- **Read the Gazette** (bonus item from the brief): builds a period-styled broadsheet
  HTML for the 30 days behind the playhead, via the same `artifacts/gazette.js` the
  CLI uses, shown in an in-page modal (blob URL, no navigation).
- Static fallback path if the live sim can't boot, so the viewer degrades instead of
  going blank.
- `node src/export.js [--seed N] [--pc "Name:Playbook"] [--to DATE] [--gazette]`
  build step, writing `voyager/output/voyage.json` (canonical) + mirroring into
  `voyager/web/`.
- Everything above runs with **zero API key**. `--llm` still works for the CLI's
  Gazette lead prose when a key is present.

## What's stubbed / next

- **Flashback mechanic** (`ttrpg/flashback.js`) isn't in the web UI — the CLI's
  `roleplay` command demonstrates it, but wiring a "declare a flashback" control into
  the browser (with a stress track UI) was cut for time. Next iteration.
- **No scene-handoff / dice-roll UI.** The PC's autonomous life streams, but there's
  no "take the wheel" moment in the browser the way `cmdRoleplay` demonstrates in the
  CLI. That's the biggest gap between this and the vision's full loop.
- **No real click-through in an actual browser** (see verification section) — the
  DOM/event-listener code should get a first manual pass before anyone relies on it.
- The map animation is point-to-point (no great-circle sub-day interpolation like
  `VoyageLayer.jsx`'s calendar-scrubbing mode) — adequate for a day-stepped voyage,
  but a smoother tween between real fixes would read better on long ocean legs.
- The Gazette's "30 days behind the playhead" window is a fixed heuristic; a
  "since your last port" or "since your last Gazette" framing would be more
  narratively legible.
- Going through the real Go backend + React app remains future work if the project
  wants Voyager to live inside the main site's navigation rather than as a companion
  viewer; nothing here blocks that, since the sim itself is now cleanly split into a
  Node side (`voyage-loader.js`) and an isomorphic side (`voyage-build.js`) that a
  Go-backed API or a Vite-bundled component could equally reuse.

## Files touched

- `voyager/data/voyage-build.js` — **new**, pure/isomorphic timeline builder.
- `voyager/data/voyage-loader.js` — thinned to a Node file-read shim over the above.
- `voyager/src/sim/engine.js` — dropped the Node-only default import; `voyage` is
  now a required param (no behavior change for existing callers).
- `voyager/src/sim/pawns.js` — imports `CREW_SEED` from `voyage-build.js` instead of
  `voyage-loader.js`.
- `voyager/src/sim/actions.js` — determinism fix (`Math.random()` → seeded `rng()`).
- `voyager/src/sim/storyteller.js` — storm incidents now include `actors` so a PC
  caught in a storm correctly flags `pcInvolved` (previously only `casualty`, which
  the engine doesn't check for the PC-thread highlight).
- `voyager/src/narrate/llm.js`, `voyager/src/narrate/narrator.js` — guarded
  `process.env` reads so both files import cleanly in a browser.
- `voyager/src/export.js` — **new** build-step CLI.
- `voyager/web/{index.html,app.js,style.css}` — **new** static viewer.
- `voyager/web/{cook.json,voyage.json}` — **new**, committed build artifacts (the
  fallback dataset + a self-contained copy of the source journal).
- `voyager/output/voyage.json` — **new**, canonical export output.
