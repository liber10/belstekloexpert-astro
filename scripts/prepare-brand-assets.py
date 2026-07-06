from pathlib import Path
import sys

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"


def crop_square(image: Image.Image) -> Image.Image:
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return image.crop((left, top, left + side, top + side))


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python scripts/prepare-brand-assets.py <source-logo.png>")

    source = Path(sys.argv[1]).resolve()
    if not source.exists():
        raise SystemExit(f"Source image not found: {source}")

    image = Image.open(source).convert("RGBA")
    square = crop_square(image)

    images_dir = PUBLIC / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    square.resize((640, 640), Image.Resampling.LANCZOS).save(
        images_dir / "belstekloexpert-logo.png",
        optimize=True,
    )
    square.resize((180, 180), Image.Resampling.LANCZOS).save(
        PUBLIC / "apple-touch-icon.png",
        optimize=True,
    )
    square.resize((64, 64), Image.Resampling.LANCZOS).save(
        PUBLIC / "favicon.png",
        optimize=True,
    )
    square.save(
        PUBLIC / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )


if __name__ == "__main__":
    main()
