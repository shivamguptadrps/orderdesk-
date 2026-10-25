"""Add sample home-screen banners to a distributor (two designed photo banners + one text banner).

Run from the backend folder:
    python -m scripts.seed_demo_banners --join-code DEMO01
Re-running replaces the sample banners (it deletes the distributor's existing banners first).
"""

import argparse
import asyncio
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import delete, select

from app.core.db import SessionLocal, engine
from app.core.media import BANNER_SIZES, media_root, save_image
from app.modules.catalog.models import Banner, Category, Product
from app.modules.tenants.models import Tenant

FONTS = Path(__file__).resolve().parent.parent / "app" / "assets" / "fonts"
W, H = 1400, 700


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / ("NotoSans-Bold.ttf" if bold else "NotoSans-Regular.ttf")), size)


def gradient(c1: tuple, c2: tuple) -> Image.Image:
    img = Image.new("RGB", (W, H), c1)
    draw = ImageDraw.Draw(img)
    for x in range(W):
        t = x / W
        draw.line([(x, 0), (x, H)], fill=tuple(int(a + (b - a) * t) for a, b in zip(c1, c2, strict=True)))
    return img


def product_photo(url: str | None, size: int) -> Image.Image | None:
    if not url:
        return None
    path = media_root() / url.removeprefix("/media/")
    if not path.is_file():
        return None
    img = Image.open(path).convert("RGB")
    img.thumbnail((size, size))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width, img.height], radius=36, fill=255)
    out = Image.new("RGBA", img.size)
    out.paste(img, mask=mask)
    return out


def poster(kicker: str, headline: list[str], sub: str, cta: str, c1: tuple, c2: tuple, photos: list[str | None]) -> bytes:
    img = gradient(c1, c2)
    draw = ImageDraw.Draw(img)
    # soft circles for depth
    for cx, cy, r, a in ((1180, 120, 260, 28), (1300, 640, 200, 22), (80, 660, 160, 18)):
        layer = Image.new("RGBA", (W, H))
        ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, a))
        img.paste(layer, mask=layer)
    draw = ImageDraw.Draw(img)
    x = 80
    draw.rounded_rectangle([x, 90, x + draw.textlength(kicker, font=font(30)) + 44, 146], radius=28, fill=(255, 255, 255))
    draw.text((x + 22, 94), kicker, font=font(30), fill=c1)
    y = 180
    for line in headline:
        draw.text((x, y), line, font=font(84), fill="white")
        y += 100
    draw.text((x, y + 10), sub, font=font(36, bold=False), fill=(255, 255, 255))
    w = draw.textlength(cta, font=font(34)) + 64
    draw.rounded_rectangle([x, y + 90, x + w, y + 160], radius=35, fill=(255, 255, 255))
    draw.text((x + 32, y + 98), cta, font=font(34), fill=c1)
    # product photos on the right, slightly overlapping
    spots = [(830, 110), (1090, 110), (960, 330)]  # two on top, one in front below; all inside the frame
    for (px, py), url in zip(spots, [p for p in photos if p], strict=False):
        ph = product_photo(url, 260)
        if ph is not None:
            img.paste(ph, (px, py), ph)
    buf = BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


async def main(code: str) -> None:
    async with SessionLocal() as db:
        tenant = await db.scalar(select(Tenant).where(Tenant.join_code == code.upper()))
        if tenant is None:
            raise SystemExit(f"No distributor with join code {code}")
        cats = {c.name: c.id for c in await db.scalars(select(Category).where(Category.tenant_id == tenant.id))}
        products = list(await db.scalars(select(Product).where(Product.tenant_id == tenant.id, Product.status == "active")))

        def photos(*words: str) -> list[str | None]:
            out = []
            for w in words:
                p = next((p for p in products if w.lower() in p.name.lower() and p.images), None)
                out.append(p.images[0] if p else None)
            return out

        await db.execute(delete(Banner).where(Banner.tenant_id == tenant.id))
        staples = poster(
            "THIS WEEK",
            ["Stock up on", "staples"],
            "Sugar, atta, rice and oil in bulk packs",
            "Order now  ›",
            (183, 110, 0),
            (226, 150, 30),
            photos("Sugar 1", "Atta", "Rice"),
        )
        snacks = poster(
            "NEW STOCK",
            ["Snacks &", "biscuits"],
            "Fresh cartons of chips and biscuits",
            "Shop snacks  ›",
            (207, 34, 46),
            (240, 90, 70),
            photos("Masala Chips", "Cream Biscuits", "Marie"),
        )
        rows = [
            Banner(tenant_id=tenant.id, image_url=save_image(tenant.id, staples, "banners", BANNER_SIZES),
                   link_category_id=cats.get("Staples"), sort_order=1),
            Banner(tenant_id=tenant.id, image_url=save_image(tenant.id, snacks, "banners", BANNER_SIZES),
                   link_category_id=cats.get("Snacks"), sort_order=2),
            Banner(tenant_id=tenant.id, title="No online payment needed",
                   subtitle="Order here, pay your distributor the usual way", color="#1A7F37", sort_order=3),
        ]
        db.add_all(rows)
        await db.commit()
        print(f"Added {len(rows)} banners to {tenant.name}")
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--join-code", default="DEMO01")
    asyncio.run(main(parser.parse_args().join_code))
