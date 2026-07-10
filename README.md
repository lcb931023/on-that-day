# On That Day

A map of diary entries written on today's date, decades ago. Each pin is a
diarist at the place they were living when they wrote; click a pin for a
snippet, open it to read the full entry alongside the writer's age and
Wikipedia's "on this day" record for context.

Currently included: Virginia Woolf (*A Writer's Diary*), Franz Kafka
(*The Diaries*, tr. Ross Benjamin), Anne Frank (*The Diary of a Young Girl*),
Samuel Pepys (Gutenberg #4200, daily 1660–69), Brian Eno (*A Year with
Swollen Appendices*, 1995), Andy Warhol (*The Andy Warhol Diaries*, with
per-entry travel locations), Etty Hillesum (*An Interrupted Life* — only the
~11 explicitly dated entries), Lena Mukhina (*The Diary of Lena Mukhina*,
a Leningrad schoolgirl's siege diary, 1941–42), 鲁迅 (《鲁迅日记》from Wikisource, 1912–1931,
following his moves Beijing → 厦门 → 广州 → 上海), 季羡林 (《清华园日记》
1932–34), and 胡适 (《胡适留学日记》1911–17, Cornell then Columbia).

## Run

```sh
python3 -m http.server 8642 -d site
# open http://localhost:8642
```

Preview another date with `?date=MM-DD`, e.g. `http://localhost:8642/?date=3-14`.

## Rebuild the data

Drop diary `.txt` files under `diaries_txt/` and adjust the parsers, then:

```sh
python3 build_data.py   # writes site/data/authors.json + days/MM-DD.json shards
```

The data is sharded by calendar day — the site fetches only today's file
(~20 KB gzipped), with the nearest-entry fallback precomputed into each shard.

`raw/` holds downloaded sources (Pepys from Project Gutenberg, 鲁迅日记
volume pages from zh.wikisource.org) so parsing never re-fetches them.

## Layout

```
build_data.py        parsers: diaries_txt/ + raw/ → site/data/ shards
diaries_txt/         ebook .txt sources + covers (not in git — copyrighted)
raw/                 public-domain downloads (in git)
site/                the static site; serve this directory
site/data/           authors.json + days/MM-DD.json (generated but committed)
```

Pushes to `main` deploy `site/` to GitHub Pages
(https://lcb931023.github.io/on-that-day/) via `.github/workflows/pages.yml`.
To change diary content, restore `diaries_txt/` from backup, edit the
parsers, and rerun `build_data.py` before committing.

If an author has no entry for today's exact date, the nearest entry within
ten days is shown and labelled as such (precomputed into the shards).
Locations are the author's main residence per period (see the `*_place`
functions in `build_data.py`), except Warhol, whose entry headers carry
his actual location.
