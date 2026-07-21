"""Parse the diaries in diaries_txt/ and raw/ into per-day shards under
site/data/: authors.json plus days/MM-DD.json for each calendar day, each
holding the entries to show that day (exact date matches per author, else
the nearest entries within FALLBACK_WINDOW days, carrying their distance
as "delta")."""
import html as htmllib
import json
import re
import shutil
from datetime import date, timedelta
from pathlib import Path

BASE = Path(__file__).parent
TXT = BASE / "diaries_txt"
RAW = BASE / "raw"
DATA_DIR = BASE / "site" / "data"
SOURCE_DIR = BASE / "data" / "source"
VOYAGES = SOURCE_DIR / "voyages"
FALLBACK_WINDOW = 10

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
    "mukhina": {
        "name": "Lena Mukhina", "born": "1924-11-21",
        "source": "The Diary of Lena Mukhina (tr. Amanda Love Darragh, 2014)",
        "note": "A Leningrad schoolgirl's siege diary, kept at her aunt's flat at "
                "26 Zagorodny Prospekt by the Five Corners; she was evacuated in "
                "June 1942 and survived the war.",
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
    "einstein": {
        "name": "爱因斯坦", "born": "1879-03-14",
        "source": "《爱因斯坦旅行日记》(泽夫·罗森克兰茨编，中译本)",
        "note": "1922年10月—1923年3月的远东与中东之旅，途经锡兰、新加坡、香港、"
                "上海、日本、巴勒斯坦与西班牙；每篇日记都写于旅途中的不同地点。",
    },
    "darwin": {
        "name": "Charles Darwin", "born": "1809-02-12",
        "source": "A Naturalist's Voyage Round the World (the Beagle journal)",
        "note": "Kept aboard H.M.S. Beagle, 1832–36; each entry is pinned along "
                "the voyage's route, from Brazil and Patagonia round to the "
                "Galapagos, Tahiti, Australia and home.",
    },
    "bouton": {
        "name": "Jim Bouton", "born": "1939-03-08",
        "source": "Ball Four (ed. Leonard Shecter, 1970)",
        "note": "A season with the Seattle Pilots, then the Houston Astros, "
                "spring through October 1969; each entry is pinned to the "
                "ballpark named in its dateline.",
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
    "mukhina": TXT / "Mukhina, Elena/Diary of Lena Mukhina, The/Diary of Lena Mukhina, The - Mukhina, Elena.txt",
    "jixianlin": TXT / "季羡林/清华园日记(季羡林作品珍藏本)(图文版)/清华园日记(季羡林作品珍藏本)(图文版) - 季羡林.txt",
    "hushi": TXT / "胡适/胡适留学日记全集套装17册 (胡适经典全集)/胡适留学日记全集套装17册 (胡适经典全集) - 胡适.txt",
    "einstein": TXT / "阿尔伯特·爱因斯坦 & 泽夫·罗森克兰茨/爱因斯坦旅行日记（作为世俗游客的爱因斯坦，他的所见所思与你我的异同！）/爱因斯坦旅行日记（作为世俗游客的爱因斯坦，他的所见所思与你我的异同！） - 阿尔伯特·爱因斯坦 & 泽夫·罗森克兰茨.txt",
    "darwin": TXT / "Darwin, Charles/Naturalist's Voyage Round the World, A/Naturalist's Voyage Round the World, A - Charles Darwin.txt",
    "bouton": TXT / "Bouton, Jim/Ball Four (RosettaBooks Sports Classics)/Ball Four (RosettaBooks Sports Classics) - Bouton, Jim.txt",
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


def mukhina_place(y, m, d):
    return ("26 Zagorodny Prospekt, Leningrad", 59.9252, 30.3409)


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


# Einstein's 1922–23 voyage, reconstructed from the book's own 行程年表:
# each row is the leg starting on that date (months 10–12 → 1922, 1–3 → 1923).
EINSTEIN_ITINERARY = [
    ((10, 6), "马赛", 43.2965, 5.3698),
    ((10, 9), "地中海海上", 37.5, 15.5),
    ((10, 13), "塞得港", 31.2653, 32.3019),
    ((10, 14), "苏伊士运河", 30.59, 32.27),
    ((10, 15), "红海海上", 20.0, 38.5),
    ((10, 19), "阿拉伯海上", 12.0, 55.0),
    ((10, 25), "印度洋上", 4.2, 73.0),
    ((10, 28), "科伦坡，锡兰", 6.9271, 79.8612),
    ((10, 31), "马六甲海峡上", 3.4, 99.0),
    ((11, 2), "新加坡", 1.3521, 103.8198),
    ((11, 4), "南海海上", 10.0, 111.5),
    ((11, 9), "香港", 22.3193, 114.1694),
    ((11, 11), "东海海上", 26.5, 121.5),
    ((11, 13), "上海", 31.2304, 121.4737),
    ((11, 15), "东海海上", 30.0, 124.5),
    ((11, 17), "神户", 34.6901, 135.1956),
    ((11, 18), "京都", 35.0116, 135.7681),
    ((11, 19), "东京", 35.6762, 139.6503),
    ((12, 3), "仙台", 38.2682, 140.8694),
    ((12, 4), "日光", 36.7199, 139.6982),
    ((12, 7), "名古屋", 35.1815, 136.9066),
    ((12, 10), "京都", 35.0116, 135.7681),
    ((12, 11), "大阪", 34.6937, 135.5023),
    ((12, 12), "京都", 35.0116, 135.7681),
    ((12, 13), "神户", 34.6901, 135.1956),
    ((12, 15), "京都", 35.0116, 135.7681),
    ((12, 18), "奈良", 34.6851, 135.8048),
    ((12, 19), "宫岛", 34.2966, 132.3199),
    ((12, 23), "门司", 33.9460, 130.9614),
    ((12, 24), "福冈", 33.5904, 130.4017),
    ((12, 26), "门司", 33.9460, 130.9614),
    ((12, 29), "东海海上", 30.0, 126.0),
    ((12, 31), "上海", 31.2304, 121.4737),
    ((1, 3), "南海海上", 19.0, 114.5),
    ((1, 5), "香港", 22.3193, 114.1694),
    ((1, 7), "南海海上", 8.0, 108.0),
    ((1, 10), "新加坡", 1.3521, 103.8198),
    ((1, 13), "马六甲", 2.1896, 102.2501),
    ((1, 14), "槟城", 5.4141, 100.3288),
    ((1, 15), "科伦坡，锡兰", 6.9271, 79.8612),
    ((1, 17), "阿拉伯海上", 8.0, 63.0),
    ((1, 27), "红海海上", 20.0, 38.5),
    ((1, 31), "苏伊士", 29.9668, 32.5498),
    ((2, 1), "塞得港", 31.2653, 32.3019),
    ((2, 2), "耶路撒冷", 31.7683, 35.2137),
    ((2, 8), "特拉维夫", 32.0853, 34.7818),
    ((2, 9), "海法", 32.7940, 34.9896),
    ((2, 12), "加利利海，太巴列", 32.7940, 35.5300),
    ((2, 13), "耶路撒冷", 31.7683, 35.2137),
    ((2, 14), "坎塔拉，埃及", 30.8546, 32.3179),
    ((2, 16), "地中海海上", 34.5, 22.0),
    ((2, 22), "巴塞罗那", 41.3874, 2.1686),
    ((3, 1), "马德里", 40.4168, -3.7038),
    ((3, 12), "萨拉戈萨", 41.6488, -0.8891),
]


def einstein_seq(m, d):
    """Order dates along the voyage: Oct 1922 sorts before Jan 1923."""
    return (m + 12 if m < 10 else m, d)


def einstein_place(y, m, d):
    place = EINSTEIN_ITINERARY[0][1:]
    for (im, id_), name, lat, lng in EINSTEIN_ITINERARY:
        if einstein_seq(im, id_) <= einstein_seq(m, d):
            place = (name, lat, lng)
    return place


# The Beagle's route, keyed by real date: each row is where Darwin was from
# that day on. Only spans the dated entries of the Journal (it opens at sea
# after Bahia, March 1832) — the pin follows him around the world.
DARWIN_ITINERARY = [
    ((1832, 3, 18), "At sea, off the coast of Brazil", -14.5, -38.0),
    ((1832, 4, 8), "Riding north toward Cape Frio, Brazil", -22.75, -42.5),
    ((1832, 4, 13), "Socêgo, on the Rio Macaé, Brazil", -22.32, -41.92),
    ((1832, 4, 19), "Returning to Rio de Janeiro", -22.75, -42.5),
    ((1832, 7, 26), "Monte Video", -34.9011, -56.1645),
    ((1832, 12, 20), "Good Success Bay, Tierra del Fuego", -54.80, -65.22),
    ((1832, 12, 25), "Wigwam Cove, near Cape Horn", -55.85, -67.50),
    ((1833, 1, 15), "Goeree Roads, Tierra del Fuego", -55.05, -66.85),
    ((1833, 1, 19), "Beagle Channel, Tierra del Fuego", -54.88, -68.10),
    ((1833, 2, 6), "Woollya, Ponsonby Sound", -55.05, -68.15),
    ((1833, 8, 11), "El Carmen (Patagones), Río Negro", -40.80, -62.98),
    ((1833, 9, 10), "Crossing the Pampas, near the Sierra Ventana", -38.15, -61.80),
    ((1833, 9, 16), "Sierra Tapalguen, Argentina", -37.32, -60.02),
    ((1833, 9, 19), "Guardia del Monte, Argentina", -35.45, -58.80),
    ((1833, 9, 20), "Buenos Ayres", -34.6037, -58.3816),
    ((1833, 9, 28), "Luxan, Argentina", -34.57, -59.11),
    ((1833, 10, 1), "Crossing the Pampas toward St. Fé", -32.90, -60.40),
    ((1833, 10, 3), "St. Fé, Argentina", -31.63, -60.70),
    ((1833, 10, 5), "St. Fé Bajada, on the Paraná", -31.73, -60.53),
    ((1833, 10, 12), "Descending the Río Paraná", -32.50, -60.70),
    ((1833, 10, 20), "Mouth of the Paraná", -34.00, -58.40),
    ((1833, 11, 14), "Riding west from Monte Video", -34.60, -56.80),
    ((1833, 11, 18), "Near Colonia del Sacramiento", -34.35, -57.70),
    ((1833, 11, 19), "Las Vacas, Banda Oriental", -33.90, -58.35),
    ((1833, 11, 22), "Mercedes, on the Río Negro", -33.25, -58.03),
    ((1833, 11, 26), "Riding back to Monte Video", -34.10, -57.00),
    ((1833, 12, 6), "At sea, leaving the Río Plata", -36.50, -55.50),
    ((1833, 12, 23), "Port Desire, Patagonia", -47.75, -65.90),
    ((1834, 1, 9), "Port St. Julian, Patagonia", -49.31, -67.71),
    ((1834, 3, 16), "East Falkland Island", -51.69, -59.15),
    ((1834, 4, 13), "Mouth of the Santa Cruz River", -50.13, -68.35),
    ((1834, 4, 19), "Tracking up the Santa Cruz River", -50.25, -69.20),
    ((1834, 4, 26), "Upper valley of the Santa Cruz", -50.30, -70.20),
    ((1834, 4, 29), "Santa Cruz valley, in sight of the Cordillera", -50.35, -70.80),
    ((1834, 5, 4), "Furthest point up the Santa Cruz", -50.35, -71.20),
    ((1834, 5, 5), "Descending the Santa Cruz River", -50.20, -69.50),
    ((1834, 6, 1), "Port Famine, Strait of Magellan", -53.61, -70.93),
    ((1834, 6, 8), "Strait of Magellan", -53.80, -71.50),
    ((1834, 6, 9), "Magdalen Channel, Tierra del Fuego", -54.05, -71.20),
    ((1834, 6, 10), "Entering the open Pacific", -54.20, -73.50),
    ((1834, 8, 14), "Riding toward Quillota, Chile", -32.88, -71.25),
    ((1834, 8, 16), "The Bell of Quillota (La Campana)", -32.96, -71.19),
    ((1834, 8, 18), "Descending toward San Felipe, Chile", -32.83, -70.90),
    ((1834, 8, 26), "Jajuel, near San Felipe", -32.68, -70.62),
    ((1834, 8, 27), "Riding toward Santiago", -33.20, -70.70),
    ((1834, 9, 5), "Crossing the Maipo, central Chile", -33.75, -70.55),
    ((1834, 9, 6), "Rancagua, Chile", -34.17, -70.74),
    ((1834, 9, 13), "Baths of Cauquenes, Chile", -34.24, -70.57),
    ((1834, 9, 19), "Yaquil, near Nancagua, Chile", -34.62, -71.20),
    ((1834, 9, 22), "Riding back to Valparaiso", -34.20, -71.40),
    ((1834, 11, 24), "East coast of Chiloe", -42.30, -73.45),
    ((1834, 11, 30), "Castro, Chiloe", -42.48, -73.76),
    ((1834, 12, 1), "Island of Lemuy, Chiloe", -42.62, -73.66),
    ((1834, 12, 6), "Caylen, southern Chiloe", -43.12, -73.60),
    ((1834, 12, 10), "San Pedro, south of Chiloe", -43.33, -73.75),
    ((1834, 12, 18), "At sea, off the Chonos Archipelago", -44.50, -74.50),
    ((1834, 12, 28), "Peninsula of Tres Montes", -46.65, -75.00),
    ((1835, 1, 7), "Low's Harbour, Chonos Archipelago", -43.90, -73.95),
    ((1835, 1, 23), "Cucao, west coast of Chiloe", -42.60, -74.00),
    ((1835, 2, 4), "At sea, leaving Chiloe", -41.00, -73.90),
    ((1835, 2, 8), "Valdivia, Chile", -39.81, -73.25),
    ((1835, 3, 4), "Concepcion, Chile", -36.83, -73.05),
    ((1835, 3, 18), "Leaving Santiago for the Portillo Pass", -33.60, -70.35),
    ((1835, 3, 19), "Valley of the Maipo, ascending the Andes", -33.75, -70.00),
    ((1835, 3, 22), "The Portillo Pass, Cordillera", -33.70, -69.60),
    ((1835, 3, 23), "Eastern slope of the Andes", -33.60, -69.30),
    ((1835, 3, 27), "Mendoza", -32.89, -68.85),
    ((1835, 3, 29), "Villa Vicencio, Argentina", -32.53, -69.02),
    ((1835, 4, 1), "The Uspallata range", -32.60, -69.25),
    ((1835, 4, 4), "Puente del Inca, Uspallata Pass", -32.83, -69.91),
    ((1835, 4, 6), "Descending the Aconcagua valley", -32.85, -70.50),
    ((1835, 4, 28), "Foot of the Bell Mountain, road to Coquimbo", -32.65, -71.20),
    ((1835, 5, 2), "Quilimari, coast road, Chile", -32.12, -71.47),
    ((1835, 5, 4), "Turning inland toward Illapel", -31.70, -71.20),
    ((1835, 5, 14), "Coquimbo, Chile", -29.95, -71.34),
    ((1835, 5, 21), "Silver-mines of Arqueros", -29.80, -71.07),
    ((1835, 5, 23), "Valley of Coquimbo", -29.95, -70.90),
    ((1835, 6, 2), "Coast road toward Guasco", -29.30, -71.30),
    ((1835, 6, 3), "Carizal, Chile", -28.08, -71.15),
    ((1835, 6, 8), "Ballenar, valley of Guasco", -28.57, -70.76),
    ((1835, 6, 11), "Crossing the desert to Copiapó", -28.00, -70.40),
    ((1835, 6, 26), "Valley of Copiapó", -27.37, -70.33),
    ((1835, 6, 27), "Ravine of Paypote, the Despoblado", -27.10, -69.70),
    ((1835, 7, 12), "Iquique, Peru", -20.21, -70.15),
    ((1835, 7, 19), "Bay of Callao, near Lima", -12.05, -77.14),
    ((1835, 9, 23), "Charles Island, Galapagos", -1.28, -90.43),
    ((1835, 9, 29), "Albemarle Island, Galapagos", -0.25, -91.35),
    ((1835, 10, 8), "James Island, Galapagos", -0.23, -90.72),
    ((1835, 11, 15), "Matavai Bay, Tahiti", -17.49, -149.49),
    ((1835, 11, 18), "The mountains of Tahiti", -17.62, -149.50),
    ((1835, 11, 25), "Matavai Bay, Tahiti", -17.49, -149.49),
    ((1835, 12, 19), "At sea, approaching New Zealand", -35.00, 173.00),
    ((1835, 12, 21), "Bay of Islands, New Zealand", -35.26, 174.12),
    ((1835, 12, 23), "Waimate, New Zealand", -35.31, 173.88),
    ((1835, 12, 26), "Bay of Islands, New Zealand", -35.26, 174.12),
    ((1835, 12, 30), "At sea, bound for Australia", -35.50, 172.00),
    ((1836, 1, 12), "Sydney Cove, Australia", -33.86, 151.21),
    ((1836, 1, 17), "Crossing the Nepean, Blue Mountains road", -33.75, 150.67),
    ((1836, 1, 18), "Blackheath, Blue Mountains", -33.63, 150.28),
    ((1836, 1, 20), "Bathurst, Australia", -33.42, 149.58),
    ((1836, 1, 22), "Returning to Sydney", -33.60, 150.20),
    ((1836, 1, 30), "At sea, bound for Hobart Town", -36.50, 152.00),
    ((1836, 2, 7), "Leaving Hobart Town, Tasmania", -42.88, 147.33),
    ((1836, 4, 1), "Keeling (Cocos) Islands", -12.12, 96.87),
    ((1836, 5, 1), "Port Louis, Mauritius", -20.16, 57.50),
    ((1836, 5, 9), "At sea, bound for the Cape of Good Hope", -25.00, 50.00),
    ((1836, 8, 6), "Bahia, Brazil", -12.97, -38.51),
]


def darwin_place(y, m, d):
    place = DARWIN_ITINERARY[0][1:]
    for when, name, lat, lng in DARWIN_ITINERARY:
        if when <= (y, m, d):
            place = (name, lat, lng)
    return place


# "Ball Four" datelines each entry with the city the club is playing in, so the
# season can be followed park by park. Home parks are pinned to the ballpark,
# road cities to the park the Pilots or Astros played in that year.
BOUTON_DATELINES = {
    "Tempe": ("Tempe Diablo Stadium, Arizona", 33.3906, -111.9553),
    "Mesa": ("Mesa, Arizona", 33.4152, -111.8315),
    "Scottsdale": ("Scottsdale, Arizona", 33.4942, -111.9261),
    "Phoenix": ("Phoenix, Arizona", 33.4484, -112.0740),
    "Tucson": ("Tucson, Arizona", 32.2226, -110.9747),
    "Yuma": ("Yuma, Arizona", 32.6927, -114.6277),
    "Holtville": ("Holtville, California", 32.8112, -115.3800),
    "Palm Springs": ("Palm Springs, California", 33.8303, -116.5453),
    "San Diego": ("San Diego, California", 32.7157, -117.1611),
    "Anaheim": ("Anaheim Stadium, California", 33.8003, -117.8827),
    "Seattle": ("Sicks' Stadium, Seattle", 47.5609, -122.3214),
    "Vancouver": ("Capilano Stadium, Vancouver", 49.2646, -123.1387),
    "Tacoma": ("Tacoma, Washington", 47.2529, -122.4443),
    "Oakland": ("Oakland Coliseum, California", 37.7516, -122.2005),
    "San Francisco": ("Candlestick Park, San Francisco", 37.7135, -122.3861),
    "Los Angeles": ("Dodger Stadium, Los Angeles", 34.0739, -118.2400),
    "Honolulu": ("Honolulu, Hawaii", 21.3069, -157.8583),
    "Minneapolis": ("Metropolitan Stadium, Minnesota", 44.8560, -93.2274),
    "Kansas City": ("Municipal Stadium, Kansas City", 39.0900, -94.5583),
    "Chicago": ("Comiskey Park, Chicago", 41.8300, -87.6339),
    "Milwaukee": ("County Stadium, Milwaukee", 43.0280, -87.9712),
    "Detroit": ("Tiger Stadium, Detroit", 42.3320, -83.0685),
    "Cleveland": ("Municipal Stadium, Cleveland", 41.5061, -81.6995),
    "Boston": ("Fenway Park, Boston", 42.3467, -71.0972),
    "New York": ("Yankee Stadium, New York", 40.8296, -73.9262),
    "Baltimore": ("Memorial Stadium, Baltimore", 39.2980, -76.6224),
    "Baltimore-St. Louis": ("Memorial Stadium, Baltimore", 39.2980, -76.6224),
    "Washington": ("RFK Stadium, Washington", 38.8897, -76.9722),
    "Atlanta": ("Atlanta Stadium, Georgia", 33.7345, -84.3897),
    "Cincinnati": ("Crosley Field, Cincinnati", 39.0975, -84.5083),
    "Houston": ("The Astrodome, Houston", 29.6869, -95.4108),
}


def bouton_place(y, m, d):
    # The 1968 entries predate spring training; Bouton was home in Wyckoff, New
    # Jersey. Everything from 26 February 1969 on carries a dateline.
    return ("Wyckoff, New Jersey", 40.9976, -74.1718)


PLACE_FN = {"woolf": woolf_place, "kafka": kafka_place, "frank": frank_place,
            "pepys": pepys_place, "eno": eno_place, "hillesum": hillesum_place,
            "mukhina": mukhina_place,
            "luxun": luxun_place, "jixianlin": jixianlin_place, "hushi": hushi_place,
            "einstein": einstein_place, "darwin": darwin_place,
            "bouton": bouton_place}


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


def parse_mukhina(lines):
    # "9 September 1941" headers. The same dates appear first in the table of
    # contents, so skip everything until the "22 MAY 1941–..." body divider,
    # and stop at the closing "Endnotes". Endnote reference numbers survive the
    # epub-to-text conversion glued to the preceding word ("garden13",
    # "Youth.12"), so strip a 1–3 digit run that trails a letter or its
    # sentence punctuation.
    header = re.compile(r"^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$")
    started = False
    current, out = None, []
    for line in lines:
        s = line.strip()
        if not started:
            started = s.startswith("22 MAY 1941")
            continue
        m = header.match(s)
        if m and m.group(2)[:3].lower() in MONTHS:
            if current:
                out.append(current)
            current = {"y": int(m.group(3)), "m": MONTHS[m.group(2)[:3].lower()],
                       "d": int(m.group(1)), "text": ""}
        elif s == "Endnotes":
            break
        elif current:
            current["text"] += line
    if current:
        out.append(current)
    for e in out:
        e["text"] = re.sub(r"\*\*", "", e["text"])
        e["text"] = re.sub(r"(?<=[A-Za-z][.,])\d{1,3}\b", "", e["text"])
        e["text"] = re.sub(r"(?<=[A-Za-z])\d{1,3}\b", "", e["text"])
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


def parse_einstein(lines):
    # Diary entries look like "10月6日。text…" and sit between the
    # "旅行日记　远东…" heading and the "其他文件选" appendix; the book's
    # 行程年表 uses a full-width space ("12月29日　…") so it never matches.
    header = re.compile(r"^(\d{1,2})月(\d{1,2})日。\s*(.*)$")
    in_diary = False
    current, out = None, []
    for line in lines:
        s = line.strip()
        if s.startswith("旅行日记　"):
            in_diary = True
            continue
        if s == "其他文件选":
            break
        m = header.match(s) if in_diary else None
        if m:
            if current:
                out.append(current)
            month = int(m.group(1))
            current = {"y": 1922 if month >= 10 else 1923, "m": month,
                       "d": int(m.group(2)), "text": m.group(3) + "\n"}
        elif current:
            current["text"] += line
    if current:
        out.append(current)
    # Footnote markers sit as bare digits after sentence-ending punctuation
    # ("……讨人喜爱。62街上……"). Digits starting a date/count ("1922年") are
    # kept by excluding counter characters after the digits.
    for e in out:
        e["text"] = re.sub(
            r"(?<=[。！？）”])\d{1,3}(?=[^\d年月日点时分万千百十亿])", "", e["text"])
    return out


# The Journal is arranged by region, not by time: chapters (and the Falklands
# pages inside chapter IX) jump between the voyage's 1832–33 and 1834–36
# passes along South America, and only three markers spell out a year. These
# anchors, keyed by (body chapter, day of the first such marker), re-seed the
# year — and the month, for bare-day markers after a jump. Verified against
# the Beagle's documented route.
DARWIN_ANCHORS = {
    (4, 11): (1833, None),   # Rio Negro ride: a year after ch. III's Monte Video
    (9, 16): (1834, 3),      # back to the Falklands (March) after the Santa Cruz trip
    (10, 20): (1832, None),  # Tierra del Fuego, first arrival, December 1832
    (11, 1): (1834, None),   # Strait of Magellan, June 1834
    (17, 23): (1835, 9),     # Charles Island; the Galapagos chapter opens undated
    (19, 17): (1836, 1),     # Blue Mountains ride, January 1836
}

# Keep whole paragraphs up to this size: the paragraph after a date marker is
# the day's narrative, but the essays that often follow it belong to the
# region, not the day (and would swallow pages — the last entry would take
# the book's whole closing retrospect).
DARWIN_MAX_CHARS = 2400


def parse_darwin(lines):
    # Markers head a paragraph: "March 18th.—", "18th and 19th.—" (dated by
    # the first day), "April 24th,—", "December 10th—", "January 9th, 1834.—".
    # Bare-day markers inherit the current month; a month stepping backward
    # means a new year unless a DARWIN_ANCHORS jump says otherwise.
    marker = re.compile(
        r"^(?:([A-Z][a-z]+) )?(\d{1,2})(?:st|nd|rd|th|d)"
        r"(?:,? and \d{1,2}(?:st|nd|rd|th|d))?(?:, (18\d\d))?[.,]?—\s*(.*)$")
    chapter_hdr = re.compile(r"^CHAPTER [IVX]+$")
    anchors = dict(DARWIN_ANCHORS)
    # the contents also list "CHAPTER I…XXI"; the body starts at the second one
    seen_ch1, in_body, chapter = 0, False, 0
    year, month = 1832, None
    current, out = None, []
    for line in lines:
        s = line.strip()
        if chapter_hdr.match(s):
            if s == "CHAPTER I":
                seen_ch1 += 1
                in_body = seen_ch1 >= 2
                chapter = 1
            else:
                chapter += 1
            if current:
                out.append(current)
                current = None   # a new chapter's preamble is not the last entry's text
            continue
        if in_body and s == "INDEX":
            break
        mk = marker.match(line) if in_body else None
        if mk and (not mk.group(1) or mk.group(1)[:3].lower() in MONTHS):
            day = int(mk.group(2))
            new_month = MONTHS[mk.group(1)[:3].lower()] if mk.group(1) else None
            anchor = anchors.pop((chapter, day), None)
            if anchor:
                year, month = anchor[0], anchor[1] or new_month or month
            else:
                if mk.group(3):
                    year = int(mk.group(3))
                if new_month:
                    if not mk.group(3) and month and new_month < month:
                        year += 1
                    month = new_month
            if month:
                if current:
                    out.append(current)
                current = {"y": year, "m": month, "d": day, "text": mk.group(4) + "\n"}
                continue
        if current and len(current["text"]) < DARWIN_MAX_CHARS:
            current["text"] += line
    if current:
        out.append(current)
    # The facsimile flattens superscript footnote digits into the text
    # ("…its name of Red Sea is derived.8 Their numbers…"): drop digits glued
    # to a word or its closing punctuation.
    for e in out:
        e["text"] = re.sub(r"([a-zé][.,;:!?’”)]{0,2})\d{1,3}(?=[\s—]|$)", r"\1",
                           e["text"])
    return out


def parse_bouton(lines):
    # "Ball Four" uses standalone uppercase month headings followed by a
    # standalone day number; the diary runs from November 1968 through October
    # 1969. Stop before the retrospective addenda.
    month_hdr = re.compile(r"^(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|"
                           r"AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)$")
    day_hdr = re.compile(r"^(\d{1,2})$")
    stop = re.compile(r"^(WINTER,\s*1969/70|Statistics|TELL YOUR STATISTICS|"
                      r"Ball Five)")
    year = 1968
    month = None
    in_diary = False
    current, out = None, []
    for line in lines:
        s = line.strip()
        if month_hdr.match(s):
            in_diary = True
            new_month = MONTHS[s[:3].lower()]
            if month and new_month < month:
                year += 1
            month = new_month
            continue
        if not in_diary:
            continue
        if stop.match(s):
            break
        m = day_hdr.match(s)
        if m and month:
            if current:
                out.append(current)
            current = {"y": year, "m": month, "d": int(m.group(1)), "text": ""}
            continue
        if current:
            current["text"] += line
    if current:
        out.append(current)

    # A dateline names the city and holds until the next one, so carry the last
    # one forward; entries before the first dateline fall back to bouton_place.
    place = None
    for e in out:
        head, sep, rest = e["text"].lstrip().partition("\n")
        if sep and head.strip() in BOUTON_DATELINES:
            place = BOUTON_DATELINES[head.strip()]
            e["text"] = rest
        if place:
            e["place"] = place
    return out


# ---------- Build ----------

def valid_date(y, m, d):
    try:
        date(y, m, d)
        return True
    except ValueError:
        return False


def day_delta(m1, d1, m2, d2):
    """Distance in days between two month/days, wrapping around the year end
    (computed in leap year 2000 so Feb 29 exists)."""
    diff = abs((date(2000, m1, d1) - date(2000, m2, d2)).days)
    return min(diff, 366 - diff)


def write_shards(entries):
    """One file per calendar day with each author's picks for that day."""
    days_dir = DATA_DIR / "days"
    days_dir.mkdir(parents=True, exist_ok=True)
    for old in days_dir.glob("*.json"):
        old.unlink()
    authors_present = sorted({e["a"] for e in entries}, key=list(AUTHORS).index)
    total = 0
    day = date(2000, 1, 1)
    while day.year == 2000:
        m, d = day.month, day.day
        picked = []
        for author in authors_present:
            mine = [(day_delta(e["m"], e["d"], m, d), e) for e in entries
                    if e["a"] == author]
            best = min(delta for delta, _ in mine)
            if best <= FALLBACK_WINDOW:
                picked.extend(
                    dict(e, delta=best) if best else e
                    for delta, e in sorted(mine, key=lambda x: x[1]["y"])
                    if delta == best)
        shard = days_dir / f"{m:02d}-{d:02d}.json"
        shard.write_text(json.dumps({"entries": picked}, ensure_ascii=False))
        total += shard.stat().st_size
        day += timedelta(days=1)
    authors = dict(AUTHORS)
    authors.update(voyage_authors())
    (DATA_DIR / "authors.json").write_text(
        json.dumps(authors, ensure_ascii=False))
    print(f"wrote {DATA_DIR}/authors.json and 366 day shards "
          f"({total // 1024 // 1024} MB total, "
          f"~{total // 366 // 1024} KB each)")
    mirror_to_source()


def voyage_authors():
    """Voyage routes are hand-built rather than parsed, so they only need to
    contribute their authors here; the JSON itself is served as-is."""
    authors = {}
    for src in sorted(VOYAGES.glob("*.json")):
        author = json.loads(src.read_text())["author"]
        authors[author["key"]] = {k: v for k, v in author.items() if k != "key"}
    return authors


def mirror_to_source():
    """The Docker image reads data/source/ while GitHub Pages reads site/data/.
    Keep them identical so the two deploys cannot drift."""
    for name in ("authors.json", "days"):
        src, dst = DATA_DIR / name, SOURCE_DIR / name
        if dst.is_dir():
            shutil.rmtree(dst)
        elif dst.exists():
            dst.unlink()
        (shutil.copytree if src.is_dir() else shutil.copy2)(src, dst)
    print(f"mirrored {DATA_DIR} into {SOURCE_DIR}")


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
        "mukhina": parse_mukhina(FILES["mukhina"].read_text().splitlines(keepends=True)),
        "luxun": parse_luxun(sorted(RAW.glob("luxun_[0-9]*.html"))),
        "jixianlin": parse_jixianlin(FILES["jixianlin"].read_text().splitlines(keepends=True)),
        "hushi": parse_hushi(FILES["hushi"].read_text().splitlines(keepends=True)),
        "einstein": parse_einstein(FILES["einstein"].read_text().splitlines(keepends=True)),
        "darwin": parse_darwin(FILES["darwin"].read_text().splitlines(keepends=True)),
        "bouton": parse_bouton(FILES["bouton"].read_text().splitlines(keepends=True)),
    }
    entries, seen = [], {}
    for author, items in parsed.items():
        for e in items:
            text = clean(e["text"])
            # 鲁迅 and Einstein wrote terse CJK entries; 40 chars would drop them
            min_len = 10 if author in ("luxun", "einstein") else 40
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
    write_shards(entries)


if __name__ == "__main__":
    main()
