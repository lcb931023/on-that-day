"""Parse the diaries in diaries_txt/ and raw/ into site/data/diaries.json."""
import html as htmllib
import json
import re
from pathlib import Path

BASE = Path(__file__).parent
TXT = BASE / "diaries_txt"
RAW = BASE / "raw"
OUT = BASE / "site" / "data" / "diaries.json"

MONTHS = {m[:3].lower(): i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"])}
WEEKDAY = r"(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)"

# ---------- Chinese numerals ----------

CN_DIGIT = {c: i for i, c in enumerate("〇一二三四五六七八九")}


def cn_num(s):
    """Chinese numeral → int, for values 1–39 (一, 十二, 廿五, 卅一, 二十三…)."""
    s = s.replace("廿", "二十").replace("卅", "三十").replace("十十", "十")
    if "十" in s:
        tens, _, units = s.partition("十")
        return (CN_DIGIT.get(tens, 1)) * 10 + (CN_DIGIT[units] if units else 0)
    return CN_DIGIT[s]


def cn_year(s):
    """Digit-style Chinese year (一九一一) → 1911."""
    return int("".join(str(CN_DIGIT[c]) for c in s))


# ---------- Authors ----------

AUTHORS = {
    "woolf": {
        "name": "Virginia Woolf", "born": "1882-01-25",
        "source": "A Writer's Diary (ed. Leonard Woolf, 1953)",
        "note": "Locations are the Woolfs' main residence for each period; "
                "she also wrote many entries at Monk's House in the summers.",
    },
    "kafka": {
        "name": "Franz Kafka", "born": "1883-07-03",
        "source": "The Diaries (tr. Ross Benjamin, 2022)",
        "note": "Kafka kept his notebooks in Prague, where he lived nearly all his life.",
    },
    "frank": {
        "name": "Anne Frank", "born": "1929-06-12",
        "source": "The Diary of a Young Girl (Definitive Edition)",
        "note": "From 6 July 1942 the family hid in the Secret Annex at Prinsengracht 263.",
    },
    "pepys": {
        "name": "Samuel Pepys", "born": "1633-02-23",
        "source": "The Diary of Samuel Pepys (Wheatley ed., via Project Gutenberg)",
        "note": "He wrote daily from 1660 to 1669, first in Axe Yard, Westminster, "
                "then beside the Navy Office in Seething Lane.",
    },
    "eno": {
        "name": "Brian Eno", "born": "1948-05-15",
        "source": "A Year with Swollen Appendices (1995)",
        "note": "Pinned to his west London studio, though 1995 took him all over the world.",
    },
    "warhol": {
        "name": "Andy Warhol", "born": "1928-08-06",
        "source": "The Andy Warhol Diaries (ed. Pat Hackett)",
        "note": "Dictated by phone each morning; travel days are pinned where he ended up.",
    },
    "hillesum": {
        "name": "Etty Hillesum", "born": "1914-01-15",
        "source": "An Interrupted Life: The Diaries, 1941–1943",
        "note": "Written in her room on Gabriël Metsustraat, across from the Rijksmuseum, "
                "a few miles from Anne Frank's hiding place.",
    },
    "luxun": {
        "name": "鲁迅", "born": "1881-09-25",
        "source": "《鲁迅日记》(维基文库, 1912–1931)",
        "note": "教育部时期在北京，1926年南下厦门、广州，1927年秋定居上海。",
    },
    "jixianlin": {
        "name": "季羡林", "born": "1911-08-06",
        "source": "《清华园日记》(1932–1934)",
        "note": "清华大学读书时期的日记，毫无顾忌，畅所欲言。",
    },
    "hushi": {
        "name": "胡适", "born": "1891-12-17",
        "source": "《胡适留学日记》(1911–1917)",
        "note": "留美时期：康乃尔大学（绮色佳），1915年秋转入哥伦比亚大学（纽约）。",
    },
}

FILES = {
    "woolf": TXT / "Woolf, Virginia/Writer's Diary, A/Writer's Diary, A - Virginia Woolf.txt",
    "kafka": TXT / "Kafka, Franz/Diaries of Franz Kafka, The/Diaries of Franz Kafka, The - Franz Kafka.txt",
    "frank": TXT / "Frank, Anne/Diary of a Young Girl, The/Diary of a Young Girl, The - Anne Frank.txt",
    "pepys": RAW / "pepys_gutenberg_4200.txt",
    "eno": TXT / "Brian Eno/Year With Swollen Appendices_ Brian Eno’s Diary, A/Year With Swollen Appendices_ Brian Eno’s Diary, A - Brian Eno.txt",
    "warhol": TXT / "Warhol, Andy/Andy Warhol Diaries, The/Andy Warhol Diaries, The - Andy Warhol.txt",
    "hillesum": TXT / "Hillesum, Etty/Interrupted Life - Etty Hillesum/Interrupted Life - Etty Hillesum - Etty Hillesum.txt",
    "jixianlin": TXT / "季羡林/清华园日记(季羡林作品珍藏本)(图文版)/清华园日记(季羡林作品珍藏本)(图文版) - 季羡林.txt",
    "hushi": TXT / "胡适/胡适留学日记全集套装17册 (胡适经典全集)/胡适留学日记全集套装17册 (胡适经典全集) - 胡适.txt",
}


# ---------- Locations (main residence per period) ----------

def woolf_place(y, m, d):
    if y < 1924:
        return ("Hogarth House, Richmond, London", 51.4613, -0.3037)
    if y < 1939 or (y == 1939 and m < 9):
        return ("52 Tavistock Square, London", 51.5256, -0.1272)
    return ("Monk's House, Rodmell, Sussex", 50.8412, 0.0304)


def kafka_place(y, m, d):
    return ("Old Town, Prague", 50.0875, 14.4213)


def frank_place(y, m, d):
    if (y, m, d) < (1942, 7, 6):
        return ("Merwedeplein 37, Amsterdam", 52.3467, 4.9069)
    return ("The Secret Annex, Prinsengracht 263, Amsterdam", 52.3752, 4.8840)


def pepys_place(y, m, d):
    if (y, m) < (1660, 7):
        return ("Axe Yard, Westminster, London", 51.5010, -0.1273)
    return ("Seething Lane, City of London", 51.5104, -0.0796)


def eno_place(y, m, d):
    return ("His studio, west London", 51.5160, -0.2050)


WARHOL_HOME = ("57 East 66th Street, New York", 40.7677, -73.9648)
WARHOL_GAZETTEER = {
    "new york": WARHOL_HOME,
    "paris": ("Paris", 48.8566, 2.3522),
    "los angeles": ("Los Angeles", 34.0736, -118.4004),
    "london": ("London", 51.5072, -0.1276),
    "aspen": ("Aspen, Colorado", 39.1911, -106.8175),
    "montauk": ("Montauk, Long Island", 41.0359, -71.9545),
    "washington": ("Washington, D.C.", 38.9072, -77.0369),
    "milan": ("Milan", 45.4642, 9.1900),
    "monte carlo": ("Monte Carlo", 43.7396, 7.4266),
    "venice": ("Venice", 45.4408, 12.3155),
    "miami": ("Miami", 25.7617, -80.1918),
    "kuwait": ("Kuwait City", 29.3759, 47.9774),
    "hong kong": ("Hong Kong", 22.3193, 114.1694),
    "denver": ("Denver", 39.7392, -104.9903),
    "zurich": ("Zurich", 47.3769, 8.5417),
    "st. martin": ("St. Martin", 18.0708, -63.0501),
    "naples": ("Naples", 40.8518, 14.2681),
    "düsseldorf": ("Düsseldorf", 51.2277, 6.7735),
    "vail": ("Vail, Colorado", 39.6403, -106.3742),
    "peking": ("Beijing", 39.9042, 116.4074),
    "nashville": ("Nashville", 36.1627, -86.7816),
    "houston": ("Houston", 29.7601, -95.3701),
    "east falmouth": ("East Falmouth, Cape Cod", 41.5765, -70.5586),
    "chadds ford": ("Chadds Ford, Pennsylvania", 39.8718, -75.5919),
    "vienna": ("Vienna", 48.2082, 16.3738),
    "toronto": ("Toronto", 43.6532, -79.3832),
    "san francisco": ("San Francisco", 37.7749, -122.4194),
    "rome": ("Rome", 41.9028, 12.4964),
    "fire island": ("Fire Island, New York", 40.6437, -73.1362),
    "columbus": ("Columbus, Ohio", 39.9612, -82.9988),
    "brussels": ("Brussels", 50.8503, 4.3517),
    "vancouver": ("Vancouver", 49.2827, -123.1207),
    "boston": ("Boston", 42.3601, -71.0589),
    "philadelphia": ("Philadelphia", 39.9526, -75.1652),
    "chicago": ("Chicago", 41.8781, -87.6298),
    "dallas": ("Dallas", 32.7767, -96.7970),
    "tokyo": ("Tokyo", 35.6762, 139.6503),
    "madrid": ("Madrid", 40.4168, -3.7038),
    "stockholm": ("Stockholm", 59.3293, 18.0686),
    "hamburg": ("Hamburg", 53.5511, 9.9937),
    "munich": ("Munich", 48.1351, 11.5820),
    "geneva": ("Geneva", 46.2044, 6.1432),
    "atlantic city": ("Atlantic City", 39.3643, -74.4229),
    "palm beach": ("Palm Beach, Florida", 26.7056, -80.0364),
}


def hillesum_place(y, m, d):
    return ("Gabriël Metsustraat 6, Amsterdam", 52.3547, 4.8797)


def luxun_place(y, m, d):
    if (y, m) < (1919, 12):
        return ("绍兴会馆，北京宣武门外", 39.8934, 116.3745)
    if (y, m) < (1923, 8):
        return ("八道湾十一号，北京", 39.9391, 116.3663)
    if (y, m) < (1926, 9):
        return ("阜成门内西三条，北京", 39.9265, 116.3475)
    if (y, m) < (1927, 1):
        return ("厦门大学", 24.4368, 118.0973)
    if (y, m) < (1927, 10):
        return ("中山大学，广州", 23.1300, 113.2760)
    return ("虹口，上海", 31.2700, 121.4805)


def jixianlin_place(y, m, d):
    return ("清华园，北平", 40.0106, 116.3331)


def hushi_place(y, m, d):
    if (y, m) < (1915, 9):
        return ("康乃尔大学，绮色佳（Ithaca）", 42.4534, -76.4735)
    return ("哥伦比亚大学，纽约", 40.8075, -73.9626)


PLACE_FN = {"woolf": woolf_place, "kafka": kafka_place, "frank": frank_place,
            "pepys": pepys_place, "eno": eno_place, "hillesum": hillesum_place,
            "luxun": luxun_place, "jixianlin": jixianlin_place, "hushi": hushi_place}


# ---------- Parsers (each returns [{y, m, d, text, (place)}]) ----------

def clean(text):
    text = re.sub(r"\[\d+\]", "", text)          # footnote markers
    text = re.sub(r"^\s*\* \* \*\s*$", "", text, flags=re.M)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n\n", text)
    return text.strip()


def parse_woolf(lines):
    header = re.compile(rf"^{WEEKDAY},\s+([A-Z][a-z]+)\s+(\d{{1,2}})")
    year, current, out = None, None, []
    for line in lines:
        s = line.strip()
        if re.fullmatch(r"(19\d\d)\.?", s):
            year = int(s.rstrip("."))
            continue
        m = header.match(s)
        if m and year and m.group(1)[:3].lower() in MONTHS:
            if current:
                out.append(current)
            current = {"y": year, "m": MONTHS[m.group(1)[:3].lower()],
                       "d": int(m.group(2)), "text": ""}
        elif current:
            current["text"] += line
    if current:
        out.append(current)
    return out


ROMAN = {r: i + 1 for i, r in enumerate(
    ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"])}


def parse_kafka(lines):
    # Entries start like "24 August 1911", "26 Aug. (1911) text…", "8 October 16",
    # "19 II 11" (Roman-numeral month), or "9 August" (year inherited from
    # context). Text may follow on the same line. Travel diaries excluded upstream.
    named = re.compile(
        r"^\s*(\d{1,2})\s+([A-Z][a-z]+)\.?\s*"
        r"(?:\d{1,2}\s+)?(?:\((\d{4})\)|(\d{4})|(\d{2})(?![\d]))?\.?\s?(.*)$")
    roman = re.compile(
        r"^\s*(\d{1,2})\.?\s+(XI{0,2}|I[XV]|VI{0,3}|I{1,3})\b\.?\s*"
        r"(?:\((\d{4})\)|(\d{4})|(\d{2})(?![\d]))?\s?(.*)$")

    def match_date(line):
        m = named.match(line)
        if m and m.group(2)[:3].lower() in MONTHS:
            month = MONTHS[m.group(2)[:3].lower()]
        else:
            m = roman.match(line)
            # A bare "d I …" with trailing text is usually prose ("10 I was…"),
            # so the Roman form needs an explicit year or nothing after it.
            if not (m and (m.group(3) or m.group(4) or m.group(5) or not m.group(6))):
                return None
            month = ROMAN[m.group(2)]
        if not 1 <= int(m.group(1)) <= 31:
            return None
        year = (int(m.group(3)) if m.group(3) else
                int(m.group(4)) if m.group(4) else
                1900 + int(m.group(5)) if m.group(5) else None)
        return int(m.group(1)), month, year, m.group(6)

    year, current, out = None, None, []
    for line in lines:
        parsed = match_date(line)
        if parsed:
            d, mth, y, rest = parsed
            y = y or year
            if y and 1909 <= y <= 1923:
                year = y
                if current:
                    out.append(current)
                current = {"y": y, "m": mth, "d": d, "text": rest + "\n"}
                continue
        if current:
            current["text"] += line
    if current:
        out.append(current)
    return out


def parse_frank(lines):
    header = re.compile(
        r"^(?:SUN|MON|TUES|WEDNES|THURS|FRI|SATUR)DAY,\s+([A-Z]+)\s+(\d{1,2}),\s+(\d{4})")
    current, out = None, []
    for line in lines:
        if line.strip() == "AFTERWORD":
            break
        m = header.match(line.strip())
        if m:
            if current:
                out.append(current)
            current = {"y": int(m.group(3)), "m": MONTHS[m.group(1)[:3].lower()],
                       "d": int(m.group(2)), "text": ""}
        elif current:
            current["text"] += line
    if current:
        out.append(current)
    return out


def parse_pepys(lines):
    # Month sections like "JANUARY 1659-1660" (old-style split year: use the
    # later one), entries like "2nd. In the morning…" or "January 1st. Called…".
    month_hdr = re.compile(r"^([A-Z]+) (\d{4})(?:-(\d{2,4}))?$")
    day_hdr = re.compile(r"^(?:([A-Z][a-z]+) )?(\d{1,2})(?:st|nd|rd|th)[ .,(]")
    year = month = None
    current, out = None, []
    for line in lines:
        if "*** END OF THE PROJECT" in line:
            break
        s = line.rstrip()
        mh = month_hdr.match(s)
        if mh and mh.group(1)[:3].lower() in MONTHS:
            month = MONTHS[mh.group(1)[:3].lower()]
            year = int(mh.group(2))
            if mh.group(3):
                nxt = mh.group(3)
                year = int(nxt) if len(nxt) == 4 else year - year % 100 + int(nxt)
            if current:
                out.append(current)
                current = None
            continue
        dh = day_hdr.match(s)
        if dh and year and not line.startswith(" "):
            if dh.group(1) and dh.group(1)[:3].lower() not in MONTHS:
                pass  # prose line that happens to start "Lord 20th…" etc.
            elif 1 <= int(dh.group(2)) <= 31:
                if current:
                    out.append(current)
                current = {"y": year, "m": month, "d": int(dh.group(2)),
                           "text": line[dh.end():]}
                continue
        if current:
            current["text"] += line
    if current:
        out.append(current)
    return out


def parse_eno(lines):
    header = re.compile(r"^(\d{1,2}) ([A-Z]+)$")
    current, out = None, []
    for line in lines:
        s = line.strip()
        if s == "APPENDICES":
            break
        m = header.match(s)
        if m and m.group(2)[:3].lower() in MONTHS.keys() and m.group(2).isupper():
            if current:
                out.append(current)
            current = {"y": 1995, "m": MONTHS[m.group(2)[:3].lower()],
                       "d": int(m.group(1)), "text": ""}
        elif current:
            current["text"] += line
    if current:
        out.append(current)
    return out


def parse_warhol(lines):
    # "Wednesday, November 24, 1976—Vancouver—New York": dash suffix is where
    # he was; a travel day's last segment is where he ended up.
    header = re.compile(
        rf"^{WEEKDAY}, ([A-Z][a-z]+) (\d{{1,2}}), (\d{{4}})\s*(?:[—–-](.*))?$")
    current, out = None, []
    for line in lines:
        m = header.match(line.strip())
        if m and m.group(1)[:3].lower() in MONTHS:
            if current:
                out.append(current)
            place = None
            if m.group(4):
                last = re.split(r"[—–]", m.group(4))[-1].strip().rstrip(".")
                key = last.lower()
                place = (WARHOL_GAZETTEER.get(key)
                         or WARHOL_GAZETTEER.get(key.split(",")[0].strip()))
            current = {"y": int(m.group(3)), "m": MONTHS[m.group(1)[:3].lower()],
                       "d": int(m.group(2)), "text": "",
                       "place": place or WARHOL_HOME}
        elif current:
            current["text"] += line
    if current:
        out.append(current)
    return out


def parse_hillesum(lines):
    # "Sunday, 9 March [1941]." / "Friday afternoon, 8 May [1941], three o'clock"
    # / "Friday, 21 March, 8:30 A.M." — year comes from occasional brackets,
    # advanced when the month wraps around. Undated entries ("Wednesday night.")
    # can't be pinned to a date and are skipped.
    header = re.compile(
        rf"^{WEEKDAY}(?: morning| afternoon| evening| night)?,\s+(\d{{1,2}})\s+([A-Z][a-z]+)")
    # the diary text ends where the Westerbork letters begin
    body_started = False
    year, last_month = 1941, 0
    current, out = None, []
    for line in lines:
        s = line.strip()
        m = header.match(s)
        if m and m.group(2)[:3].lower() in MONTHS:
            body_started = True
            month = MONTHS[m.group(2)[:3].lower()]
            yb = re.search(r"[\[{ ](19\d\d)\b", s)   # "[1941]", "{1942}", "4 August 1941"
            if yb:
                year = int(yb.group(1))
            elif month < last_month:
                year += 1
            last_month = month
            if current:
                out.append(current)
            current = {"y": year, "m": month, "d": int(m.group(1)),
                       "text": s[m.end():].lstrip(".,: ") + "\n"}
        elif body_started and re.match(r"^Letters from Westerbork", s):
            break
        elif current:
            current["text"] += line
    if current:
        out.append(current)
    return out


def parse_luxun(paths):
    # Wikisource pages: "五月[编辑]" month headings, then one paragraph per day
    # ("五日上午十一时舟抵天津。…"). The year appears in the page header
    # ("壬子日记作者：鲁迅1912年"). Book-list appendices (书帐) are cut off.
    month_hdr = re.compile(r"^([一二三四五六七八九十]{1,3})月(?:\[编辑\])?$")
    day_hdr = re.compile(r"^([一二三四五六七八九十廿卅]{1,3})日(.*)$")
    out = []
    for path in paths:
        html = Path(path).read_text()
        body = htmllib.unescape(re.sub(r"<[^>]+>", "\n", html[html.find("mw-parser-output"):]))
        lines = [l.strip() for l in body.split("\n") if l.strip()]
        year = int(re.search(r"(19[0-3]\d)年", " ".join(lines[:30])).group(1))
        month, current = None, None
        for s in lines:
            if "书帐" in s and len(s) < 20:
                break
            mh = month_hdr.match(s)
            if mh:
                month = cn_num(mh.group(1))
                continue
            dh = day_hdr.match(s)
            if dh and month:
                if current:
                    out.append(current)
                current = {"y": year, "m": month, "d": cn_num(dh.group(1)),
                           "text": dh.group(2) + "\n"}
            elif current:
                current["text"] += s + "\n"
        if current:
            out.append(current)
    return out


def parse_jixianlin(lines):
    # Short header lines: "二十一年 八月二十二日" (民国 year), "九月一日",
    # "二十四日（星期三）" — year/month inherited when absent.
    header = re.compile(
        r"^(?:([一二三四五六七八九十]{1,3})年\s*)?(?:([一二三四五六七八九十]{1,3})月)?"
        r"([一二三四五六七八九十廿卅]{1,3})日(?:（星期?[一二三四五六日天]）)?$")
    year = month = None
    current, out = None, []
    for line in lines:
        s = line.strip()
        m = header.match(s) if len(s) <= 16 else None
        if m:
            if m.group(1):
                year = cn_num(m.group(1)) + 1911   # 民国纪年
            if m.group(2):
                new_month = cn_num(m.group(2))
                if year and month and new_month < month:
                    year += 1   # 年份很少标注，月份回绕即跨年
                month = new_month
            if year and month:
                if current:
                    out.append(current)
                current = {"y": year, "m": month, "d": cn_num(m.group(3)), "text": ""}
                continue
        if current:
            current["text"] += line
    if current:
        out.append(current)
    return out


def parse_hushi(lines):
    # Entry headers: "一九一一年一月卅日（星一）" / "元年九月廿五日（星三）" /
    # "一月卅一日（星二）" / "廿五日（星四）". Years are rarely written out, so
    # volume-range headings like "民国三年（1914）三月十二日至七月七日" anchor
    # the year, and a month wrapping backward means a new year.
    vol_heading = re.compile(r"^卷.*?（(191[0-7])）")     # "卷 二 民国元年（1912）…" opens a TOC
    range_line = re.compile(r"^民国.*?（(191[0-7])）")    # body repeats the range without "卷"
    label = re.compile(r"^卷\s*[一二三四五六七八九十]{1,3}$")
    header = re.compile(
        r"^(?:([一二三四五六七八九十〇]{4}|元)年)?(?:([一二三四五六七八九十]{1,3})月)?"
        r"([一二三四五六七八九十廿卅]{1,3})日(?:（星期?[一二三四五六日天]?）)?$")
    # From 卷三 on, entries are numbered 札记 items ("一、养家") whose date
    # sits below the title in parentheses: "（三月十二日）".
    item_title = re.compile(r"^[一二三四五六七八九十]{1,3}、")
    dateline = re.compile(
        r"^（([一二三四五六七八九十]{1,3})月([一二三四五六七八九十廿卅]{1,3})日[^）]{0,4}）$")
    # Every volume opens with a table of contents that repeats each entry
    # header; skip from the volume-range heading until the "卷　X" body label.
    in_toc, year, month = True, None, None
    pending_title = None
    current, out = None, []

    def wrap(new_month):
        nonlocal year, month
        if year and month and new_month < month:
            year += 1
        month = new_month

    for line in lines:
        s = line.strip()
        v = vol_heading.match(s)
        if v:
            year, month, in_toc = int(v.group(1)), None, True
            continue
        r = range_line.match(s)
        if r:
            year, month = int(r.group(1)), None
            continue
        if label.match(s):
            in_toc, month = False, None
            continue
        if not in_toc and item_title.match(s) and len(s) <= 40:
            # an item title closes the previous entry; its own entry opens
            # only if a dateline follows (undated 札记 are dropped)
            if current:
                out.append(current)
                current = None
            pending_title = s
            continue
        dl = dateline.match(s) if not in_toc and pending_title else None
        if dl and year:
            wrap(cn_num(dl.group(1)))
            if 1911 <= year <= 1917:
                current = {"y": year, "m": month, "d": cn_num(dl.group(2)),
                           "text": pending_title + "\n"}
            pending_title = None
            continue
        m = header.match(s) if not in_toc and len(s) <= 16 and "至" not in s else None
        if m:
            if m.group(1):
                year = 1912 if m.group(1) == "元" else cn_year(m.group(1))
                month = None
            if m.group(2):
                wrap(cn_num(m.group(2)))
            if year and month and 1911 <= year <= 1917:
                if current:
                    out.append(current)
                current = {"y": year, "m": month, "d": cn_num(m.group(3)), "text": ""}
                continue
        if current:
            current["text"] += line
    if current:
        out.append(current)
    return out


# ---------- Build ----------

def valid_date(y, m, d):
    try:
        from datetime import date
        date(y, m, d)
        return True
    except ValueError:
        return False


def main():
    kafka_lines = FILES["kafka"].read_text().splitlines(keepends=True)
    kafka_main = kafka_lines[:next(
        i for i, l in enumerate(kafka_lines) if l.strip() == "TRAVEL DIARIES" and i > 100)]
    parsed = {
        "woolf": parse_woolf(FILES["woolf"].read_text().splitlines(keepends=True)),
        "kafka": parse_kafka(kafka_main),
        "frank": parse_frank(FILES["frank"].read_text().splitlines(keepends=True)),
        "pepys": parse_pepys(FILES["pepys"].read_text().splitlines(keepends=True)),
        "eno": parse_eno(FILES["eno"].read_text().splitlines(keepends=True)),
        "warhol": parse_warhol(FILES["warhol"].read_text().splitlines(keepends=True)),
        "hillesum": parse_hillesum(FILES["hillesum"].read_text().splitlines(keepends=True)),
        "luxun": parse_luxun(sorted(RAW.glob("luxun_[0-9]*.html"))),
        "jixianlin": parse_jixianlin(FILES["jixianlin"].read_text().splitlines(keepends=True)),
        "hushi": parse_hushi(FILES["hushi"].read_text().splitlines(keepends=True)),
    }
    entries, seen = [], {}
    for author, items in parsed.items():
        for e in items:
            text = clean(e["text"])
            min_len = 10 if author == "luxun" else 40   # 鲁迅's entries are terse
            if len(text) < min_len or not valid_date(e["y"], e["m"], e["d"]):
                continue
            key = (author, e["y"], e["m"], e["d"])
            if key in seen:   # several 札记 items can share one date
                seen[key]["text"] += "\n\n" + text
                continue
            place, lat, lng = e.get("place") or PLACE_FN[author](e["y"], e["m"], e["d"])
            seen[key] = {"a": author, "y": e["y"], "m": e["m"], "d": e["d"],
                         "place": place, "lat": lat, "lng": lng, "text": text}
            entries.append(seen[key])
        years = sorted({x["y"] for x in entries if x["a"] == author})
        n = sum(1 for x in entries if x["a"] == author)
        print(f"{author}: {n} entries, {years[0]}–{years[-1]}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"authors": AUTHORS, "entries": entries},
                              ensure_ascii=False))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
