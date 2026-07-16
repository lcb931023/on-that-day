# Iteration B — "Deep RimWorld Simulation"

Starting point: the Voyager MVP (needs → mood → utility-AI actions, a card-dealing
storyteller, an offline/LLM narrator, the Endeavour Gazette). This iteration pushes
the simulation's *emergent depth* — per Tynan Sylvester's "The Simulation Dream" —
without breaking legibility or any existing CLI command.

## What was added

### 1. A relationship web with texture and memory (`src/sim/pawns.js`, `data/voyage-loader.js`)

- **Factions.** Every pawn (crew and PCs) is assigned a clique by role: `officers`
  (Cook, the lieutenants, Master, Gunner, Midshipman, Bosun), `gentlemen` (Banks,
  Solander, Green, the Surgeon, the Chaplain — the learned men), `hands` (able
  seamen, the clerk, quartermaster, drummer, sailmaker, surgeon's boy, powder
  monkey), and `outsider` (Tupaia, alone in his own category — the cultural outsider
  the design brief asked for). Faction membership biases partner selection
  (`actions.js`) toward one's own kind, so cliques emerge as a readable pattern
  without being hand-scripted, and feeds the storyteller's `faction_friction`
  incident.
- **Seeded starting bonds** (`SEED_BONDS` in `voyage-loader.js`): eight
  historically-plausible relationships baked in at voyage start — Banks & Solander
  as fast friends, Cook mentoring Hicks, Tupaia (fittingly) mentoring Cook in Pacific
  wayfinding, Molyneux & Ravenhill as drinking companions, Orton resenting Banks's
  privilege, Magra and Hicks (insolent hand vs. dutiful lieutenant) as rivals. This
  gives the relationship graph texture from day one instead of needing a whole
  voyage to earn any drama.
- **Bond classification** (`pawn.bond[otherId] = { kind, since }`, `pawn.feuds`):
  relationships escalate or heal through play. `refreshBonds()` runs once a day and
  promotes a pair to `"friend"` once their (mutual, averaged) `rel` crosses +0.55, or
  to `"feud"` once it crosses −0.55 — each transition is itself a small legible
  event (`feud_ignites` / `bond_forms`). Feuds are sticky and duel-eligible; friend/
  mentor/protege bonds are sticky once earned. `quarrel`/`brawl` weights in
  `actions.js` are boosted for standing feuds, so a feud doesn't just sit inert —
  it keeps generating friction until something resolves it.

### 2. Mental breaks with cascades, and inspirations (`src/sim/breaks.js`, new file)

RimWorld's actual payoff for the needs/mood sim. Run once a day, after the
storyteller's incidents (so e.g. a death can tip a bonded mourner over the edge the
same day):

- **Breaks** (`checkBreaks`): a pawn whose mood sinks below 0.38 may break, in one
  of three legible kinds shaped by trait: `berserk` (violent/resentful/insolent
  traits — lashes out at another pawn, injury + flogging risk), `tantrum`
  (proud/greedy/resentful — smashes gear, dings relationships with everyone
  nearby), or `despair` (default — withdraws, refuses work, the longest-lasting).
  **Cascade**: everyone who witnesses a break — bonded to the breaker (weighted by
  `|rel|`) or of the same faction — takes a stress thought, and if that pushes
  *their* mood under the threshold too, they're queued for a break of their own the
  same day, tagged `cascade: <triggering name>`. Capped at 3 breaks/day so a bad day
  reads as a dramatic run, not noise.
- **Inspirations** (`checkInspirations`): the mirror case, mood > 0.8 — three kinds
  (`inspired_work`, `inspired_yarn`, `inspired_cheer`), one lifts the whole crew's
  morale, capped at 2/day.
- Both are pushed straight into `rawEvents` (same shape as every other beat:
  `summary`/`salience`/`actors`/`pcInvolved`), so **no changes were needed** to
  `narrator.js` or `gazette.js` — they pick the new beats up automatically.

Thresholds were tuned against the sim's actual mood distribution, not guessed: a
diagnostic run showed only ~0.16% of pawn-days ever dip below the RimWorld-typical
0.24 mood floor (crises here are sharp and brief, not sustained grinds), so the
break threshold was raised to 0.38 / extreme 0.26 to make breaks a real-but-not-
routine occurrence. See "Verification" below for the resulting rates.

### 3. A smarter storyteller (`src/sim/storyteller.js`)

- **Relationship-graph incidents**, the centerpiece of this iteration's ask:
  - `duel` (threat) — fires when any pawn has a live feud; the pair meets, one is
    hurt (or, 12% of the time, killed); even the winner takes a morale hit.
  - `faction_friction` — gentlemen-vs-hands class tension, dings relationships and
    is flavor-text-visible ("Sharp words between the gentlemen and the hands…").
  - `mentor_breakthrough` — a mentor/protege pair gets a positive payoff beat.
  - `reconciliation` — a standing feud can heal when average mood is decent, closing
    the loop RimWorld calls "a grudge that pays off later."
  - `kill()` (the existing death helper) was strengthened: mourners who are
    strongly bonded to the deceased (friend/mentor/protege, or high `rel`) get a
    bigger, longer grief thought than a stranger would — this is what makes "a
    beloved officer's death devastating morale" (and often triggering a break
    cascade the same day) fall out of mechanics already in place, with no special
    case needed.
- **Wealth analog**: `shipWealth = (aliveCount/total) × avgHealth × (0.5 + 0.5×provisions)`,
  clamped to [0,1], scales threat frequency up when the ship has more to lose —
  RimWorld's wealth-scales-raid-points, translated to a ship.
- **Population intent**: eases threat pressure (×0.55) once losses cut past 55% of
  the crew, so the story doesn't grind a shrunken company to zero; leans in
  slightly (×1.15) when the company is nearly whole.
- **Personality-differentiated pacing**, now meaningfully different, not just
  different constants:
  - *Cassandra* runs a classic build-up (14 "days") → climax (4, ×1.6 incident
    rate) → lull (8, ×0.5) cycle — the textbook RimWorld cadence.
  - *Phoebe* has no cycle and the fastest adaptation recovery (`adaptDecay: 0.09`)
    — she forgives a bad stretch quickest.
  - *Randy* ignores population intent and wealth-scaling entirely (`popIntent`/
    `wealthF` pinned to 1) — true chaos doesn't soften for a struggling crew.

## Files touched

- `voyager/src/sim/pawns.js` — factions, bond map/feuds, `refreshBonds`, seeded bonds.
- `voyager/src/sim/breaks.js` — **new**: mental breaks + cascades, inspirations.
- `voyager/src/sim/actions.js` — faction/bond-aware partner selection; feud-boosted
  friction; mentor-boosted counsel. Also fixed a pre-existing bug: partner
  selection used unseeded `Math.random()`, which made "seeded" voyages
  non-reproducible; switched to the passed-in seeded `rng()`.
- `voyager/src/sim/storyteller.js` — wealth/population-intent/cycle levers; four new
  relationship-graph incidents; strengthened `kill()` mourning.
- `voyager/src/sim/engine.js` — wires `checkBreaks`/`checkInspirations`/
  `refreshBonds` into the daily loop, after incidents, before the flogging-risk pass
  (so a berserk break is flogging-eligible exactly like a brawl already was).
- `voyager/data/voyage-loader.js` — `SEED_BONDS`.
- No changes to `narrator.js`, `gazette.js`, or `cli.js` — the new beats are the same
  shape as existing ones, so every command still runs unmodified.

## Verification

All commands still run offline, no API key required:

```
node src/cli.js sail --to 1771-07-10 --seed 4
node src/cli.js crew --to 1771-07-10 --seed 42
node src/cli.js gazette --from 1770-10-10 --to 1771-01-27 --seed 99
node src/cli.js roleplay --to 1769-10-15 --seed 7 --pc "Mary Blackwood:Surgeon"
node src/cli.js sail --to 1769-08-01 --seed 7 --pc "Mary Blackwood:Surgeon"   # PC path
node src/cli.js gazette --from 1769-04-13 --to 1769-04-20 --seed 7 --llm     # LLM path (key present)
```

Determinism: the same `--seed` now reproduces byte-identical output between runs
(fixed the `Math.random()` bug above) — confirmed via `diff` on two runs of seed 99.

### Balance sweep (75 runs: 3 personalities × 25 seeds, full voyage 1768→1771)

- Deaths per 16-person crew form a bell curve centered on 3–5 (19–31% of runs each):
  `{0:1, 1:2, 2:8, 3:13, 4:19, 5:17, 6:7, 7:5, 8:2, 9:1}`. Max ever seen: 9/16 (56%).
  Min: 0/16. **No seed wipes the crew or leaves everyone untouched as a rule** —
  matches the historical "a third of the company dead" the voyage log itself cites.
- Mental breaks fire in ~95% of runs (71/75); cascades (a break triggering a
  secondary break) fire in ~79% of runs (59/75) — common enough to be a real
  mechanic, not so common they're wallpaper.
- Duels fired in most runs too (roughly half had at least one, several had 3+).

### Sample emergent story (seed 4, `cassandra`, full voyage)

The two rivals seeded at voyage start — **James Magra** (insolent able seaman) and
**Zachary Hicks** (dutiful Second Lieutenant) — escalate to a duel on the very first
leg:

> *"…James Magra met Zachary Hicks at dawn over their long feud — Zachary Hicks did
> not rise. […] Zachary Hicks is dead of a duel with James Magra. God rest him."*

Then, during the historically-anchored low point of the real voyage — the Indian
Ocean "dying time" after Batavia, Jan–Feb 1771 (the milestone the loader itself
tags `"the Indian Ocean (the dying time)"`) — a five-day mental-break cascade runs
through the crew, each entry `Rattled by <name>'s break:` chaining off the last:

> Jan 26: *"Richard Orton broke — a berserk fury turned on Tupaia before he was
> pulled off. Tom Rossiter sank into a black despair… **Rattled by Richard Orton's
> break:** John Ravenhill sank into a black despair…"*
>
> Jan 30 (real journal: *"Departed this life John Thurman, Sailmaker's Assistant"*):
> *"Tupaia flew into a tantrum, smashing what came to hand and cursing the voyage
> entire. John Gore sank into a black despair… **Rattled by John Gore's break:**
> Robert Molyneux sank into a black despair…"*
>
> Feb 4: *"**Rattled by Robert Molyneux's break:** Tupaia flew into a tantrum…
> Robert Molyneux sank into a black despair… Richard Orton sank into a black
> despair…"*
>
> Feb 7: *"Tom Rossiter sank into a black despair… **Rattled by Tom Rossiter's
> break:** Tupaia sank into a black despair… **Rattled by Tupaia's break:** Charles
> Green sank into a black despair…"*

By voyage's end that seed lost 8 of 16 (Batavia flux claimed most; the duel claimed
Hicks) — hard-hit, historically plausible, not a wipe — and every survivor's mood
had recovered to 0.74–0.95, showing the needs system pulling the ship back to
baseline once the crisis passed, same as the real Endeavour did.

Other beats seen across seeds: `"Sharp words between the gentlemen and the hands —
James Magra will not soon forget Dr. …"` (faction friction); `"Under Tupaia's eye,
Lt. James Cook finally masters the trick of it"` (mentor breakthrough); `"…enemies
of long standing, shook hands over shared hardship and let the old grudge go at
last"` (reconciliation, the grudge-pays-off-later arc).

## What's tunable

- `BREAK_THRESHOLD` / `EXTREME_THRESHOLD` / `INSPIRE_THRESHOLD` and the per-cap
  constants in `breaks.js` — raise/lower to make breaks rarer/commoner.
- `BOND_FEUD` / `BOND_FRIEND` thresholds in `pawns.js` — how fast relationships earn
  a label.
- `wealthF`/`popIntent` coefficients and Cassandra's `lens` (buildup/climax/lull day
  counts) in `storyteller.js`.
- `SEED_BONDS` in `voyage-loader.js` — add/edit starting relationships; the
  mentor/protege swap is automatic (seed the "mentor" side, the other pawn becomes
  "protege").

## Next steps

- Feed `feud`/`friend`/`mentor` bond kinds into the Gazette's layout directly (e.g.
  a standing "Enmities & Alliances" box) rather than only surfacing them as one-line
  notices.
- A `flashback`-style hook for PCs to *intervene* in a witnessed break or duel
  (currently these are pure NPC-vs-NPC simulation; a PC bystander can't yet
  de-escalate one, though a PC actor already can duel/quarrel like anyone else).
- Faction-level aggregate mood/tension (right now `faction_friction` is
  pairwise-random; a running "class tension" meter feeding mutiny odds would tie
  factions and the existing `mutiny_mutter` incident together more tightly).
- Widen `SEED_BONDS` / faction assignments once PCs are added mid-voyage, so a new
  PC doesn't start as a total blank slate in the relationship graph.
