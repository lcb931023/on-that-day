# Iteration C — Narrative craft + real-time play loop

Built on top of the MVP (`iter/voyager-narrative`, branched from the MVP commit). Three
threads, all offline-first with an optional LLM upgrade, none of them touching
`data/source/voyages/cook.json` — everything still anchors to the real journal.

```
node src/cli.js story    --to DATE [--seed N] [--pc "Name:Playbook" ...] [--llm]
node src/cli.js session  --to DATE [--pc "Name:Playbook" ...] [--auto] [--fresh]
node src/cli.js schedule --to DATE [--cadence weekly] [--interval 1d] [--start ISO] [--now ISO|all] [--emit [N]]
```

## Thread 1 — Dan Harmon story circle (`src/narrate/storycircle.js`)

The circle: **(1)** comfort, **(2)** want, **(3)** unfamiliar situation, **(4)** adapt,
**(5)** get what they wanted, **(6)** pay a heavy price, **(7)** return to the familiar,
**(8)** having changed (Harmon's own shorthand: YOU / NEED / GO / SEARCH / FIND / TAKE
/ RETURN / CHANGE).

Cook's actual voyage already has this shape, so the eight beats are **not invented
plot** — they're eight date boundaries pinned to real turning points already present in
`data/voyage-loader.js`'s `MILESTONES`/`HIGHLIGHTS` (which come straight from
`cook.json`):

| Beat | Real anchor |
|---|---|
| 1 comfort | Departure, Madeira, Rio — still the known Atlantic world |
| 2 want | The Atlantic crossing south — the stated mission (reach Tahiti for the Transit of Venus) pulls the ship on |
| 3 unfamiliar | Tierra del Fuego — the first alien landfall; two of Banks's men die of cold in a blizzard |
| 4 adapt | Rounding the Horn into the Pacific, then the Tahiti stay — the crew learns South Seas custom, Tupaia joins |
| 5 get | 3 June 1769 — the Transit of Venus is observed: the literal, stated goal |
| 6 price | New Zealand/New Holland exploration → the Great Barrier Reef strike → the Batavia "dying time" (a third of the company is eventually lost) |
| 7 return | The Cape of Good Hope → the homeward Atlantic — recognisably European water again |
| 8 change | Arrival home — the log's own words: "a charted Pacific, and a third of the company dead" |

`beatForDate(iso)` returns the beat for any day; `buildChapters(log)` groups the log
into contiguous runs sharing a beat — those are the "chapters" `story` prints. This
makes the current beat **legible**: every chapter prints a header
`Beat n/8 · HARMON-WORD · "Title"  from → to  (description)`.

**Narration is shaped, not invented.** `narrateChapterOffline` (in `narrator.js`) picks
its opener and its one-line closer from a per-beat vocabulary bank (`BEAT_VOICE`) — the
underlying beats/incidents/real-journal-text are identical to what `narrateDayOffline`
would produce; only the *frame* changes (register drifts from "settled, domestic" in
beat 1 to "costly, grinding" in beat 6 to "reckoning, retrospective" in beat 8). The LLM
path (`narrateChapterLLM`) tells the model which beat it's writing and what register to
use, but explicitly forbids inventing new events — same discipline as the MVP's
`narrateSpanLLM`.

**The storyteller is optionally biased too** (thread 1's "or bias incident selection"):
`engine.js` computes the day's beat and a `beatThreatMul` (`storycircle.js`'s
`THREAT_BIAS` table — 0.55 in "comfort", 1.35 in "price", etc.) and passes it into
`storyteller.day()`. `storyteller.js` folds it into the mean-time-between calculation
for *threat* incidents only (storms, scurvy, fever, accidents) — wonders and first
contact stay beat-neutral so beat 5 isn't starved of its own texture. This means the
emergent log itself leans toward rising/falling structure, not just the prose reading
of it.

**Per-PC arcs** (`pcArc`): the voyage-level circle is the spine, but a given PC's own
"get" (their best positive beat) and "price" (their worst) can land on a different day
than the fleet's — `story` prints both per PC. Fixed a real bug while building this:
`pcArc`'s positive/negative split originally classified by event *kind* only, which
misfiled a dice **loss** as a PC's personal "get" (a `gamble` event's kind doesn't
encode who won). Now `sign(beat, pawnId)` checks the actual winner/loser/tense flag.

## Thread 2 — multiplayer scene handoff + resolution + flashback (`src/ttrpg/session.js`)

Deepens the MVP's single-PC, single-canned-example `roleplay` into a loop a table can
actually run:

1. **Handoff** (`sceneHandoff`) — gathers, per PC, the autonomous beats that happened
   to them since the *last session's checkpoint* (not just "the whole log"), plus a
   cold-open scene (the single most salient day in that span) for the table as a whole.
2. **Declare + resolve** (`resolveAction`) — each PC in turn declares an action; it's
   rolled with the existing Blades mechanic (`characters.js:actionRoll`) at a chosen
   position, and the **outcome changes the live pawn state** (morale/rest/health/stress)
   — a roleplayed scene has real consequence on the ongoing sim, the same way an
   autonomous incident does.
3. **Flashback with a mechanical payoff** (`declareFlashback`) — same splice as the
   MVP's `flashback.js` (stress cost, spliced into the historical log), plus a new
   *effect*: a small preset (`supplies`→health, `rest`→rest, `favor`→morale,
   `ally`→social) is applied to the PC's needs **right now**, so "I had stashed lime
   juice" doesn't just read well, it measurably helps. Effects are capped small (0.12–
   0.15) so a flashback is a hedge, never a free win — same spirit as Blades' stress
   economy.
4. **Checkpoint** (`output/session-<seed>-<pcs>.json`) — the session's last date is
   persisted, so a table's *next sitting* picks the campaign up exactly where the last
   one left off; `--fresh` starts over.

`session` runs **interactively** (`node:readline/promises`) when stdin is a real TTY: a
menu of actions with dot ratings, free-text description, position, and an optional
flashback prompt per PC. When stdin isn't a TTY (piped, CI, this verification) or
`--auto` is passed, it **auto-plays** a scripted round (each PC pushes their strongest
action; the first PC in the table always demonstrates a flashback) — this is what makes
the loop verifiable offline without hanging on a prompt.

## Thread 3 — scheduled real-time delivery (`src/artifacts/scheduler.js`)

A pure planning module — it never touches the network or `setTimeout`. Given the
already-simulated voyage log, a **cadence** (`daily`/`weekly`/`biweekly`/`monthly`, how
much *voyage* time each digest covers) and an **interval** (how much *real* time
separates deliveries — compressed to `1d` for a demo, or `1:1` for real play), it
produces a plan: `{ deliverAt, kind, spanFrom, spanTo, subject, preview, records }[]`.

Two kinds of entry:
- `gazette` — the regular digest (one per cadence window), reusing the existing
  `buildGazette`.
- `dispatch` — breaking news: any single day inside a window whose top beat clears
  `--dispatch-threshold` (default 0.75 — storms, deaths, first-contact violence) is
  pulled out and delivered *early*, proportionally placed within the window, instead of
  waiting for the weekly digest. A death doesn't wait for Sunday's paper.

`simulateDelivery(plan, now)` fast-forwards: point `now` anywhere and see the mailbox
split into *delivered* vs *pending* as of that moment — the whole point of a dry run.
`emit(entry, { outDir })` renders a delivered entry to an HTML file (full broadsheet for
gazettes, a short slip for dispatches); this is the seam where a real integration would
swap `writeFileSync` for a mailer/push call — the plan objects already carry everything
a real delivery would need (recipient-agnostic; add `to`/`channel` at the call site).

## Verification

All three threads run offline with no key (see transcript in the PR/commit — sample
commands below were run and produced output):

```
node src/cli.js story    --to 1771-07-10 --seed 7 --pc "Mary Blackwood:Surgeon"
node src/cli.js session  --to 1769-10-15 --seed 7 --pc "Mary Blackwood:Surgeon" --pc "Tom Ashgrove:Bosun" --auto --fresh
node src/cli.js schedule --to 1769-06-10 --seed 7 --cadence weekly --start 2026-07-15T00:00:00Z --now all --emit 3
```

The pre-existing `sail`/`gazette`/`roleplay`/`crew` commands were re-verified unchanged.
The `--llm` path was smoke-tested on `story` against a real OpenRouter key
(`openai/gpt-4o-mini`) for one chapter and produced coherent, beat-appropriate prose
without inventing events.

Along the way, fixed a determinism bug in `src/sim/actions.js` (partner selection used
`Math.random()` instead of the seeded `rng`, so `--seed 7` wasn't actually
reproducible run-to-run) — this matters more now that `session`'s checkpoint/resume and
`schedule`'s dry-run both depend on a seed meaning the same thing twice.

## What's stubbed / next

- **Story circle boundaries are hand-pinned to Cook's one real voyage.** They're
  auditable (every boundary cites the milestone/highlight it comes from) but not
  learned from data — a second real voyage loaded into `voyage-loader.js` would need
  its own boundary table. A generalized version would derive boundaries from
  structural signal (first landfall, peak danger, homeward leg) rather than literal
  dates, at the cost of losing the "grounded in this specific journal" precision.
- **Per-PC arc beats reuse the voyage-level `BEATS`/`THREAT_BIAS` tables** rather than
  letting a PC diverge into their *own* circle position (e.g. a PC who joins late or
  whose personal crisis lands mid-voyage). `pcArc` reports personal get/price within
  the shared spine rather than a fully independent per-PC circle.
- **`session`'s interactive mode is untested against a real multi-human table** (this
  environment can't attach a TTY); the auto-play fallback stands in for verification.
  The menu-driven prompt (`action.startsWith()` matching) is intentionally forgiving
  but hasn't been hardened against typos beyond that.
- **`schedule` is a pure planner.** No cron/mailer wiring, by design (out of scope per
  the brief) — `emit()` is the documented seam.
- Gazette/dispatch HTML templates are unchanged from the MVP; a dispatch's styling is
  minimal (a slip, not a broadsheet) and could use more period flavour.
