# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Muhammad Al-Muzahid

"""Generate the extension's PNG icons at 16/32/48/128 px.

Drawn once at 512 px and downsampled with LANCZOS so the small sizes stay crisp.

Mark: a white bin on a slate plate, with two amber tiles tipping into it -- "a
batch of pictures, moved to Trash". The palette is deliberately not Google blue
and the shapes are deliberately not a photo tile with a sun and a hill: the
Chrome Web Store forbids an icon that implies association with Google, and the
previous mark leaned on both its colour and its subject.

Kept to four shapes, because anything finer turns to mush at 16 px.
"""

import os

from PIL import Image, ImageDraw

S = 512
SLATE = (38, 48, 66, 255)      # plate
WHITE = (255, 255, 255, 255)   # the bin
AMBER = (245, 158, 11, 255)    # the items on their way in
SHADOW = (25, 32, 45, 255)     # bin slots, only visible from 32 px up


def build() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Flat plate. Shading was tried in an earlier revision and read as a stray
    # shape once downsampled to 16 px.
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=112, fill=SLATE)

    # Two tiles tipping in, drawn before the bin so the lid overlaps them and the
    # eye reads "going in" rather than "floating above".
    d.rounded_rectangle((296, 58, 414, 176), radius=26, fill=AMBER)
    d.rounded_rectangle((224, 116, 342, 234), radius=26, fill=AMBER)

    # Bin body: a taper, with the bottom corners rounded so it does not read as a
    # bucket. Drawn as a polygon plus a rounded cap over the base.
    d.polygon([(160, 252), (372, 252), (340, 436), (192, 436)], fill=WHITE)
    d.rounded_rectangle((192, 376, 340, 436), radius=26, fill=WHITE)

    # Lid, then handle.
    d.rounded_rectangle((132, 208, 400, 256), radius=24, fill=WHITE)
    d.rounded_rectangle((226, 178, 306, 216), radius=16, fill=WHITE)

    # Slots. Slate rather than amber: at 32 px amber here fights the tiles above.
    for x in (228, 278):
        d.rounded_rectangle((x, 290, x + 26, 396), radius=13, fill=SHADOW)

    return img


def main() -> None:
    base = build()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "extension", "icons")
    os.makedirs(out, exist_ok=True)
    for size in (16, 32, 48, 128):
        base.resize((size, size), Image.LANCZOS).save(
            os.path.join(out, f"icon{size}.png"), optimize=True
        )
    base.resize((256, 256), Image.LANCZOS).save(
        os.path.join(out, "icon-preview.png"), optimize=True
    )
    print(f"written -> {out}")


if __name__ == "__main__":
    main()
