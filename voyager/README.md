# Voyager — AI × human 跑团 (MVP)

A tabletop-RPG engine built **on top of `on-that-day`'s Voyage Mode**. Players create
characters aboard a **real historical voyage** (HMS *Endeavour*, 1768–1771) and follow
it in something like real time, anchored to Cook's actual journal
(`data/source/voyages/cook.json`). The ship's life between the journal's lines is a
**RimWorld-style emergent simulation**: crew have needs that drive their behaviour, a
**storyteller** paces incidents, and an **LLM** turns the resulting beats into prose
and generates artifacts (a ship's newspaper) to send to the players.

This is the **basic MVP**. Parallel branched visions live in `../voyager-iterations/`.

> This branch (`iter/voyager-deepsim`) is **Iteration B — "Deep RimWorld
> Simulation"**: a richer relationship web (factions, feuds, mentorships), mental
> breaks that cascade through bonded/faction-mates, inspirations, and a smarter
> storyteller (wealth/population-intent levers, per-personality pacing cycles,
> incidents that read the relationship graph — duels, faction friction,
> reconciliations). See `ITERATION.md` for the full writeup and sample runs.

## Why it's built this way (the design bet)

Following Tynan Sylvester's *The Simulation Dream*: we simulate the **minimum that
supports the stories we want** and let **apophenia** (the player's tendency to read
intent into simple patterns) do the rest. The simulation is a **co-author**; the LLM
and the player supply the meaning. See the design notes in the vault:
`100 Projects/Voyager 跑团/`.

## Run it (no API key needed)

```bash
cd voyager
node src/cli.js sail     --to 1769-06-06 --seed 7 --pc "Mary Blackwood:Surgeon"
node src/cli.js crew     --to 1771-07-10 --seed 7
node src/cli.js roleplay --to 1769-10-15 --seed 7 --pc "Mary Blackwood:Surgeon"
node src/cli.js gazette  --from 1769-04-13 --to 1769-06-10 --seed 7   # writes output/*.html
```

Everything runs **offline** on deterministic templates. For LLM narration add `--llm`
(reads `OPENROUTER_API_KEY` from `.env` / `~/.hermes/.env`; override the model with
`VOYAGER_MODEL`, e.g. `deepseek/deepseek-chat`).

## How it works

```
data/voyage-loader.js   Reads the REAL cook.json journal → a day-by-day TIMELINE.
                        Cook logged daily at sea but rarely in port, so port stays
                        (Madeira, Rio, Tahiti, Batavia, the Cape) are synthesized so
                        the ship can rest, reprovision, and make first contact.

src/sim/
  pawns.js        Crew + PCs: needs, thoughts→mood, relationships, cosmetic traits.
  actions.js      Utility AI: each pawn scores need-driven actions; social ones emit
                  structured raw events (carouse, quarrel, gamble, brawl, counsel…).
  world.js        Provisions erosion + the day's anchored journal history.
  storyteller.js  The director (Cassandra/Phoebe/Randy): paces incidents by
                  mean-time-between × danger × tension × adaptation. Storms, scurvy,
                  the Batavia fever, landfall wonders, first contact, mutiny, floggings.
  engine.js       Walks the timeline; needs self-stabilize (crew eat/sleep passively)
                  so hardship, not bookkeeping, drives decline. Emits the voyage LOG.

src/narrate/
  narrator.js     Beats → prose. Offline templates, or a single LLM pass over a span.
  llm.js          OpenRouter (OpenAI-compatible) client. Optional; never a dependency.

src/ttrpg/
  characters.js   Blades-in-the-Dark playbooks (Surgeon, Bosun, Naturalist…) + rolls.
  flashback.js    The bridge between the PC's AUTONOMOUS life and the player's ROLEPLAY:
                  declare something you'd already set up; pay stress; it's spliced back
                  into the ship's log so past and present agree. (cf. C. Thi Nguyen.)

src/artifacts/
  gazette.js      "The Endeavour Gazette" — a period broadsheet blending REAL history
                  (Dispatches of Record) with the crew's exploits and the PCs' deeds.
```

## The loop the vision is reaching for

1. Simulation runs the voyage forward, anchored to the real log, in real time.
2. Your character lives autonomously; the storyteller deals the ship its fortunes.
3. When a scene lands, you take the wheel and **roleplay** it — using **flashbacks**
   to make your autonomous past matter.
4. The game **mails you artifacts** (the Gazette) mixing real history and your exploits.

## Status / next

MVP proves the full loop offline + LLM. Branched iterations explore: a live web
"Voyager mode" in the existing React app; deeper relationship/mood webs; the Harmon
story-circle / hero's-journey shaping of narration; scheduled real-time delivery.
