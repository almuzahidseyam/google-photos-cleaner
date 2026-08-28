"""Generate the extension's PNG icons at 16/32/48/128 px.

Drawn once at 512 px and downsampled with LANCZOS so the small sizes stay crisp.
Mark: a white photo tile on Google blue, with a red badge carrying a minus bar --
"remove photos". Kept to three shapes so it survives being 16 px wide.
"""

import os

from PIL import Image, ImageDraw

S = 512
BLUE = (26, 115, 232, 255)
BLUE_DARK = (21, 92, 186, 255)  # kept for reference; the mark is flat
WHITE = (255, 255, 255, 255)
RED = (217, 48, 37, 255)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def build() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Flat background plate. Shading was tried and read as a stray shape at 16 px.
    rounded(d, (0, 0, S - 1, S - 1), radius=112, fill=BLUE)

    # Photo tile.
    tile = (96, 118, 386, 372)
    rounded(d, tile, radius=40, fill=WHITE)

    # Sun.
    d.ellipse((150, 168, 214, 232), fill=BLUE)

    # Mountain, clipped to the tile by drawing inside a mask.
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(tile, radius=40, fill=255)
    hill = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hill).polygon(
        [(120, 372), (222, 250), (300, 330), (346, 288), (386, 372)], fill=BLUE
    )
    img.alpha_composite(Image.composite(hill, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))
    d = ImageDraw.Draw(img)

    # Removal badge: white ring so it separates from the tile at small sizes.
    d.ellipse((286, 288, 470, 472), fill=WHITE)
    d.ellipse((304, 306, 452, 454), fill=RED)
    d.rounded_rectangle((334, 364, 422, 396), radius=16, fill=WHITE)

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
