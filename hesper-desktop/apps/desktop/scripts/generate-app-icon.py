from __future__ import annotations

from pathlib import Path
from shutil import copyfile
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
SCALE = 2
WORK_SIZE = SIZE * SCALE
TILE_MARGIN = 96
TILE_RADIUS = 232
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

APP_ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = APP_ROOT / 'assets'
RENDERER_ASSETS_DIR = APP_ROOT / 'renderer' / 'src' / 'assets'
PNG_PATH = ASSETS_DIR / 'hesper-icon.png'
ICO_PATH = ASSETS_DIR / 'hesper-icon.ico'
SVG_PATH = ASSETS_DIR / 'hesper-icon.svg'
RENDERER_PNG_PATH = RENDERER_ASSETS_DIR / 'hesper-icon.png'

Color = tuple[int, int, int, int]
Point = tuple[float, float]


def scaled(value: float) -> int:
    return int(round(value * SCALE))


def mix_channel(left: int, right: int, amount: float) -> int:
    return int(round(left + (right - left) * amount))


def mix_color(left: Color, right: Color, amount: float) -> Color:
    amount = max(0.0, min(1.0, amount))
    return tuple(mix_channel(left[index], right[index], amount) for index in range(4))  # type: ignore[return-value]


def draw_rounded_gradient_tile(image: Image.Image) -> None:
    mask = Image.new('L', (WORK_SIZE, WORK_SIZE), 0)
    mask_draw = ImageDraw.Draw(mask)
    box = [scaled(TILE_MARGIN), scaled(TILE_MARGIN), scaled(SIZE - TILE_MARGIN), scaled(SIZE - TILE_MARGIN)]
    mask_draw.rounded_rectangle(box, radius=scaled(TILE_RADIUS), fill=255)

    tile = Image.new('RGBA', (WORK_SIZE, WORK_SIZE), (0, 0, 0, 0))
    pixels = tile.load()
    top = (17, 24, 39, 255)
    bottom = (5, 8, 18, 255)
    glow_center = (0.36, 0.26)

    for y in range(box[1], box[3]):
        y_ratio = y / max(1, WORK_SIZE - 1)
        base = mix_color(top, bottom, y_ratio)
        for x in range(box[0], box[2]):
            x_ratio = x / max(1, WORK_SIZE - 1)
            dx = x_ratio - glow_center[0]
            dy = y_ratio - glow_center[1]
            glow = max(0.0, 1.0 - ((dx * dx + dy * dy) ** 0.5 / 0.52)) ** 2
            pixels[x, y] = (
                min(255, base[0] + int(58 * glow)),
                min(255, base[1] + int(54 * glow)),
                min(255, base[2] + int(96 * glow)),
                255,
            )

    tile.putalpha(mask)
    image.alpha_composite(tile)

    border = Image.new('RGBA', (WORK_SIZE, WORK_SIZE), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border)
    border_draw.rounded_rectangle(
        [box[0] + scaled(2), box[1] + scaled(2), box[2] - scaled(2), box[3] - scaled(2)],
        radius=scaled(TILE_RADIUS - 2),
        outline=(255, 255, 255, 30),
        width=scaled(2),
    )
    image.alpha_composite(border)


def draw_blurred_glow(image: Image.Image, center: Point, radius: float, color: Color) -> None:
    glow = Image.new('RGBA', (WORK_SIZE, WORK_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    cx, cy = scaled(center[0]), scaled(center[1])
    r = scaled(radius)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    glow = glow.filter(ImageFilter.GaussianBlur(scaled(34)))
    image.alpha_composite(glow)


def draw_gradient_polyline(image: Image.Image, points: Iterable[Point], width: float, start: Color, end: Color, closed: bool = False) -> None:
    point_list = [(scaled(x), scaled(y)) for x, y in points]
    if closed:
        point_list = point_list + [point_list[0]]

    draw = ImageDraw.Draw(image)
    stroke_width = scaled(width)
    radius = stroke_width // 2
    segment_count = max(1, len(point_list) - 1)

    for segment_index in range(segment_count):
        x1, y1 = point_list[segment_index]
        x2, y2 = point_list[segment_index + 1]
        steps = max(6, int(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 // scaled(10)))
        for step in range(steps):
            t1 = step / steps
            t2 = (step + 1) / steps
            global_t = (segment_index + t1) / segment_count
            color = mix_color(start, end, global_t)
            xa = x1 + (x2 - x1) * t1
            ya = y1 + (y2 - y1) * t1
            xb = x1 + (x2 - x1) * t2
            yb = y1 + (y2 - y1) * t2
            draw.line([(xa, ya), (xb, yb)], fill=color, width=stroke_width)

    for index, (x, y) in enumerate(point_list[:-1] if closed else point_list):
        color = mix_color(start, end, index / max(1, len(point_list) - 2))
        draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color)


def cubic_bezier(p0: Point, p1: Point, p2: Point, p3: Point, steps: int) -> list[Point]:
    points: list[Point] = []
    for index in range(steps + 1):
        t = index / steps
        inv = 1 - t
        x = inv ** 3 * p0[0] + 3 * inv ** 2 * t * p1[0] + 3 * inv * t ** 2 * p2[0] + t ** 3 * p3[0]
        y = inv ** 3 * p0[1] + 3 * inv ** 2 * t * p1[1] + 3 * inv * t ** 2 * p2[1] + t ** 3 * p3[1]
        points.append((x, y))
    return points


def render_icon() -> Image.Image:
    image = Image.new('RGBA', (WORK_SIZE, WORK_SIZE), (0, 0, 0, 0))
    draw_rounded_gradient_tile(image)
    draw_blurred_glow(image, (512, 512), 260, (34, 211, 238, 34))
    draw_blurred_glow(image, (420, 362), 190, (167, 139, 250, 42))

    orbit_points = cubic_bezier((252, 690), (382, 818), (706, 824), (856, 634), 92)
    draw_gradient_polyline(image, orbit_points, 54, (196, 181, 253, 214), (34, 211, 238, 226))

    star_points = [
        (512, 292),
        (576, 448),
        (740, 512),
        (576, 576),
        (512, 740),
        (448, 576),
        (284, 512),
        (448, 448),
    ]
    draw_gradient_polyline(image, star_points, 66, (196, 181, 253, 255), (34, 211, 238, 255), closed=True)

    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def write_svg() -> None:
    SVG_PATH.write_text(
        '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" data-icon="hesper-evening-star-line" role="img" aria-labelledby="title desc">
  <title id="title">Hesper evening star line icon</title>
  <desc id="desc">A minimal line-style evening star with an orbital arc on a dark rounded square.</desc>
  <defs>
    <linearGradient id="tile" x1="128" y1="96" x2="896" y2="928" gradientUnits="userSpaceOnUse">
      <stop stop-color="#111827"/>
      <stop offset="1" stop-color="#050812"/>
    </linearGradient>
    <radialGradient id="glow" cx="36%" cy="26%" r="58%">
      <stop stop-color="#6366F1" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#111827" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="stroke" x1="284" y1="292" x2="856" y2="824" gradientUnits="userSpaceOnUse">
      <stop stop-color="#C4B5FD"/>
      <stop offset="1" stop-color="#22D3EE"/>
    </linearGradient>
  </defs>
  <rect x="96" y="96" width="832" height="832" rx="232" fill="url(#tile)"/>
  <rect x="96" y="96" width="832" height="832" rx="232" fill="url(#glow)"/>
  <rect x="98" y="98" width="828" height="828" rx="230" fill="none" stroke="white" stroke-opacity="0.12" stroke-width="4"/>
  <path d="M252 690 C382 818 706 824 856 634" fill="none" stroke="url(#stroke)" stroke-width="54" stroke-linecap="round" opacity="0.86"/>
  <path d="M512 292 L576 448 L740 512 L576 576 L512 740 L448 576 L284 512 L448 448 Z" fill="none" stroke="url(#stroke)" stroke-width="66" stroke-linejoin="round" stroke-linecap="round"/>
</svg>
''',
        encoding='utf8',
    )


def main() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    RENDERER_ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    icon = render_icon()
    icon.save(PNG_PATH)
    icon.save(ICO_PATH, format='ICO', sizes=ICO_SIZES)
    copyfile(PNG_PATH, RENDERER_PNG_PATH)
    write_svg()

    print(f'Wrote {PNG_PATH}')
    print(f'Wrote {ICO_PATH}')
    print(f'Wrote {SVG_PATH}')
    print(f'Wrote {RENDERER_PNG_PATH}')


if __name__ == '__main__':
    main()
