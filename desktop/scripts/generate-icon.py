"""Generate desktop marks from the TUI's canonical braille-logo family.

The welcome renderer selects logo07.txt (or logo05.txt in compact layouts). The
desktop export uses the matching high-resolution logo24.txt variant so the same
silhouette stays legible in a 256/512px system icon. Each Unicode braille cell
is decoded back into its 2x4 dot matrix. Colors follow logo.rs: neutral resting
gray with a bottom-left -> top-right text-color shimmer.
"""

from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
TUI_RENDER_SOURCE = ROOT / "crates/codegen/xai-grok-pager/assets/logo/logo07.txt"
SOURCE = ROOT / "crates/codegen/xai-grok-pager/assets/logo/logo24.txt"
MARK_OUT = ROOT / "desktop/renderer/assets/grok-mark.png"
ICON_OUT = ROOT / "desktop/build/icon.png"
BRAILLE_DOTS = ((0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2), (0, 3), (1, 3))


def decode_logo() -> Image.Image:
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    width = max(len(line) for line in lines) * 2
    height = len(lines) * 4
    mask = Image.new("L", (width, height), 0)
    pixels = mask.load()
    for cell_y, line in enumerate(lines):
        for cell_x, char in enumerate(line):
            bits = ord(char) - 0x2800 if 0x2800 <= ord(char) <= 0x28FF else 0
            for bit, (dot_x, dot_y) in enumerate(BRAILLE_DOTS):
                if bits & (1 << bit):
                    pixels[cell_x * 2 + dot_x, cell_y * 4 + dot_y] = 255
    return mask.crop(mask.getbbox())


def fitted_mask(source: Image.Image, size: int, padding: int) -> Image.Image:
    available = size - padding * 2
    scale = min(available / source.width, available / source.height)
    dimensions = (round(source.width * scale), round(source.height * scale))
    scaled = source.resize(dimensions, Image.Resampling.LANCZOS)
    canvas = Image.new("L", (size, size), 0)
    canvas.paste(scaled, ((size - dimensions[0]) // 2, (size - dimensions[1]) // 2))
    return canvas


def shimmer_fill(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    base = (126, 131, 134)
    highlight = (244, 246, 247)
    for y in range(size):
        for x in range(size):
            diagonal = (x + (size - y)) / (size * 2)
            # A parked frame from the same diagonal shimmer concept as logo.rs.
            band = max(0.0, 1.0 - abs(diagonal - 0.58) / 0.34)
            amount = 0.20 + 0.80 * band * band * (3.0 - 2.0 * band)
            pixels[x, y] = tuple(round(base[i] + (highlight[i] - base[i]) * amount) for i in range(3)) + (255,)
    return image


def make_transparent_mark(source: Image.Image) -> None:
    size = 1024
    mask = fitted_mask(source, size, 48)
    mark = shimmer_fill(size)
    mark.putalpha(mask)
    MARK_OUT.parent.mkdir(parents=True, exist_ok=True)
    mark.save(MARK_OUT, optimize=True)


def make_app_icon(source: Image.Image) -> None:
    size = 512
    supersample = 3
    large = size * supersample
    background = Image.new("RGBA", (large, large), (0, 0, 0, 0))
    draw = ImageDraw.Draw(background)
    inset = 15 * supersample
    draw.rounded_rectangle(
        (inset, inset, large - inset, large - inset),
        radius=108 * supersample,
        fill=(8, 9, 10, 255),
        outline=(43, 46, 48, 255),
        width=2 * supersample,
    )
    mask = fitted_mask(source, large, 78 * supersample)
    mark = shimmer_fill(large)
    mark.putalpha(mask)
    background.alpha_composite(mark)
    icon = background.resize((size, size), Image.Resampling.LANCZOS)
    ICON_OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(ICON_OUT, optimize=True)


if __name__ == "__main__":
    logo = decode_logo()
    make_transparent_mark(logo)
    make_app_icon(logo)
    print(f"Generated {MARK_OUT.relative_to(ROOT)} and {ICON_OUT.relative_to(ROOT)} from {SOURCE.relative_to(ROOT)}")
