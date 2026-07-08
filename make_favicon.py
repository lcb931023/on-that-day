"""Draw the favicon: a rust wax seal stamped with 日, echoing the map markers."""
from PIL import Image, ImageDraw

SIZE = 512
SEAL = (176, 86, 66)       # --frank rust, the site's accent
SEAL_LIGHT = (196, 108, 86)
PAPER = (242, 234, 217)    # --paper
OUT_DIR = "site"


def draw_seal(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = size * 0.03
    d.ellipse([m, m, size - m, size - m], fill=SEAL)
    # soft highlight toward the upper left, like the map seals' gradient
    hl = size * 0.16
    d.ellipse([m + hl * 0.6, m + hl * 0.5, size - m - hl * 1.4, size - m - hl * 1.5],
              fill=SEAL_LIGHT)
    d.ellipse([m + hl, m + hl, size - m - hl, size - m - hl], fill=SEAL)

    # 日, drawn as strokes so no font is needed
    w = size * 0.20          # glyph half-width
    h = size * 0.30          # glyph half-height
    t = size * 0.075         # stroke thickness
    cx = cy = size / 2
    left, right, top, bottom = cx - w, cx + w, cy - h, cy + h
    for box in [
        (left, top, right, top + t),           # top bar
        (left, bottom - t, right, bottom),     # bottom bar
        (left, cy - t / 2, right, cy + t / 2), # middle bar
        (left, top, left + t, bottom),         # left stem
        (right - t, top, right, bottom),       # right stem
    ]:
        d.rectangle(box, fill=PAPER)
    return img


base = draw_seal(SIZE)
base.save(f"{OUT_DIR}/favicon-512.png")
base.resize((192, 192), Image.LANCZOS).save(f"{OUT_DIR}/favicon-192.png")
base.resize((32, 32), Image.LANCZOS).save(
    f"{OUT_DIR}/favicon.ico", sizes=[(16, 16), (32, 32)])
print("wrote favicon-512.png, favicon-192.png, favicon.ico")
