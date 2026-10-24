"""Add 20 dummy FMCG products (made-up brands) with generated photos to a distributor.

Run from the backend folder:
    python -m scripts.seed_demo_catalog --join-code DEMO01
Safe to run again: products whose SKU already exists are skipped.
"""

import argparse
import asyncio
import textwrap
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select

from app import models  # noqa: F401
from app.core.db import SessionLocal, engine
from app.core.media import save_product_image
from app.modules.catalog.models import Product, ProductUnit
from app.modules.catalog.service import effective_attributes, load_tree, validate_attributes
from app.modules.inventory.models import Stock
from app.modules.inventory.service import change_stock
from app.modules.tenants.models import Tenant, TenantMember


def packs(*items):
    """packs(("Packet", 1, 45, 2), ("Bag", 30, 1290)) -> unit dicts; the last one is the default."""
    out = []
    for i, item in enumerate(items):
        name, pieces, price, *rest = item
        out.append({
            "name": name, "pieces_per_unit": pieces, "price": price,
            "min_qty": rest[0] if rest else 1, "step_qty": rest[1] if len(rest) > 1 else 1,
            "is_default": i == len(items) - 1, "sort_order": i,
        })
    return out


# (category, name, brand, sku, mrp, search words, features, pack sizes, stock in pieces)
PRODUCTS = [
    ("Sugar", "Mithas Sugar 1 kg", "Mithas", "DEMO-SUG-1", 52, "cheeni, chini, shakkar, शक्कर, चीनी",
     {"weight_kg": 1, "grain": "Medium"}, packs(("Packet", 1, 46, 2), ("Bag (30)", 30, 1320)), 600),
    ("Sugar", "Mithas Sugar 5 kg", "Mithas", "DEMO-SUG-5", 255, "cheeni, chini, shakkar, शक्कर, चीनी",
     {"weight_kg": 5, "grain": "Bold"}, packs(("Packet", 1, 228), ("Bag (6)", 6, 1340)), 120),
    ("Rice", "Sona Khet Basmati Rice 1 kg", "Sona Khet", "DEMO-RICE-1", 140, "chawal, chaval, चावल, basmati",
     {"weight_kg": 1, "variety": "Basmati"}, packs(("Packet", 1, 118, 2), ("Bale (20)", 20, 2300)), 400),
    ("Rice", "Sona Khet Sona Masoori Rice 10 kg", "Sona Khet", "DEMO-RICE-10", 690, "chawal, chaval, चावल, masoori",
     {"weight_kg": 10, "variety": "Sona Masoori"}, packs(("Bag", 1, 610),), 80),
    ("Atta", "Chakki Ghar Whole Wheat Atta 5 kg", "Chakki Ghar", "DEMO-ATTA-5", 265, "aata, atta, gehu, गेहूं, आटा",
     {"weight_kg": 5, "atta_type": "Whole wheat"}, packs(("Bag", 1, 238), ("Bale (4)", 4, 940)), 160),
    ("Atta", "Chakki Ghar Besan 500 g", "Chakki Ghar", "DEMO-BESAN-05", 70, "besan, chana atta, बेसन",
     {"weight_kg": 0.5, "atta_type": "Besan"}, packs(("Packet", 1, 58, 2), ("Box (24)", 24, 1350)), 480),
    ("Oil", "Sarson Rani Mustard Oil 1 L", "Sarson Rani", "DEMO-OIL-MUS-1", 185, "sarson tel, sarso ka tel, सरसों तेल",
     {"volume_l": 1, "oil_type": "Mustard", "pack_type": "Bottle"}, packs(("Bottle", 1, 164), ("Carton (12)", 12, 1920)), 240),
    ("Oil", "Surajmukhi Sunflower Oil 1 L Pouch", "Surajmukhi", "DEMO-OIL-SUN-1", 160, "refined, sunflower tel, रिफाइंड",
     {"volume_l": 1, "oil_type": "Sunflower", "pack_type": "Pouch"}, packs(("Pouch", 1, 142), ("Carton (10)", 10, 1390)), 200),
    ("Chips", "Munch Masti Classic Salted Chips 52 g", "Munch Masti", "DEMO-CHIP-SALT", 20, "chips, wafer, namkeen, चिप्स",
     {"weight_g": 52, "flavour": "Classic salted"}, packs(("Packet", 1, 17, 6, 6), ("Box (24)", 24, 390)), 960),
    ("Chips", "Munch Masti Masala Chips 52 g", "Munch Masti", "DEMO-CHIP-MAS", 20, "chips, wafer, masala, चिप्स",
     {"weight_g": 52, "flavour": "Masala"}, packs(("Packet", 1, 17, 6, 6), ("Box (24)", 24, 390)), 720),
    ("Chips", "Munch Masti Tomato Chips 90 g", "Munch Masti", "DEMO-CHIP-TOM", 35, "chips, wafer, tamatar, चिप्स",
     {"weight_g": 90, "flavour": "Tomato"}, packs(("Packet", 1, 30, 4, 2), ("Box (16)", 16, 460)), 0),
    ("Biscuits", "Biskit Bazaar Glucose Biscuits 250 g", "Biskit Bazaar", "DEMO-BIS-GLU", 30, "biscuit, biskut, glucose, बिस्कुट",
     {"weight_g": 250, "flavour": "Glucose"}, packs(("Packet", 1, 26, 4), ("Carton (48)", 48, 1180)), 960),
    ("Biscuits", "Biskit Bazaar Cream Biscuits 100 g", "Biskit Bazaar", "DEMO-BIS-CRM", 20, "biscuit, biskut, cream, बिस्कुट",
     {"weight_g": 100, "flavour": "Chocolate cream"}, packs(("Packet", 1, 17, 6, 6), ("Carton (60)", 60, 960)), 600),
    ("Biscuits", "Biskit Bazaar Marie Biscuits 200 g", "Biskit Bazaar", "DEMO-BIS-MAR", 35, "biscuit, biskut, marie, मैरी, बिस्कुट",
     {"weight_g": 200, "flavour": "Marie"}, packs(("Packet", 1, 30, 4), ("Carton (36)", 36, 1020)), 360),
    ("Beverages", "Chai Bahar Tea 250 g", "Chai Bahar", "DEMO-TEA-250", 145, "chai, chai patti, patti, चाय",
     {"volume_ml": None, "flavour": "Strong leaf"}, packs(("Packet", 1, 126, 2), ("Box (20)", 20, 2460)), 300),
    ("Beverages", "Thanda Fizz Cola 750 ml", "Thanda Fizz", "DEMO-COLA-750", 40, "cold drink, thanda, soda, कोल्ड ड्रिंक",
     {"volume_ml": 750, "flavour": "Cola"}, packs(("Bottle", 1, 34, 6, 6), ("Crate (24)", 24, 780)), 480),
    ("Personal care", "Neem Fresh Bathing Soap 100 g", "Neem Fresh", "DEMO-SOAP-100", 35, "sabun, saboon, soap, साबुन",
     {"size": "100 g"}, packs(("Piece", 1, 29, 4), ("Pack of 4", 4, 112), ("Carton (72)", 72, 1940)), 1440),
    ("Personal care", "Neem Fresh Anti-Dandruff Shampoo 180 ml", "Neem Fresh", "DEMO-SHAM-180", 150, "shampoo, sampoo, शैम्पू",
     {"size": "180 ml"}, packs(("Bottle", 1, 128), ("Carton (24)", 24, 2950)), 96),
    ("Home care", "Chamak Detergent Powder 1 kg", "Chamak", "DEMO-DET-1", 110, "surf, sarf, washing powder, कपड़े धोने का पाउडर",
     {"size": "1 kg"}, packs(("Packet", 1, 94), ("Bag (20)", 20, 1820)), 300),
    ("Home care", "Bartan Saaf Dishwash Bar 200 g", "Bartan Saaf", "DEMO-DISH-200", 20, "bartan, vim, dishwash, बर्तन",
     {"size": "200 g"}, packs(("Piece", 1, 17, 6, 6), ("Box (60)", 60, 960)), 1200),
]

# one colour per top category, so photos look different
COLORS = {
    "Staples": ((252, 238, 205), (190, 120, 30)),
    "Snacks": ((255, 224, 214), (200, 60, 40)),
    "Beverages": ((213, 236, 252), (30, 100, 180)),
    "Personal care": ((222, 245, 222), (40, 140, 70)),
    "Home care": ((236, 228, 252), (110, 70, 180)),
}


def _font(size: int):
    for path in ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def dummy_photo(name: str, brand: str, top_category: str) -> bytes:
    bg, accent = COLORS.get(top_category, ((240, 240, 240), (80, 80, 80)))
    img = Image.new("RGB", (1000, 1000), bg)
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((170, 120, 830, 880), radius=60, fill="white", outline=accent, width=12)
    draw.rectangle((170, 300, 830, 330), fill=accent)
    draw.text((500, 220), brand.upper(), fill=accent, font=_font(64), anchor="mm")
    lines = textwrap.wrap(name.removeprefix(brand).strip(), width=16)[:4]
    for i, line in enumerate(lines):
        draw.text((500, 450 + i * 80), line, fill=(40, 40, 40), font=_font(56), anchor="mm")
    draw.text((500, 830), "DEMO PRODUCT", fill=(160, 160, 160), font=_font(32), anchor="mm")
    buf = BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


async def main(join_code: str) -> None:
    async with SessionLocal() as db:
        tenant = await db.scalar(select(Tenant).where(Tenant.join_code == join_code.upper()))
        if tenant is None:
            raise SystemExit(f"No distributor with join code {join_code}")
        owner_id = await db.scalar(
            select(TenantMember.user_id).where(TenantMember.tenant_id == tenant.id, TenantMember.role == "owner")
        )
        tree = await load_tree(db, tenant.id)
        by_name = {c.name: c for c in tree.by_id.values()}
        existing = set(await db.scalars(select(Product.sku).where(Product.tenant_id == tenant.id, Product.sku.is_not(None))))
        added = 0
        for cat_name, name, brand, sku, mrp, aliases, attrs, units, stock in PRODUCTS:
            if sku in existing:
                continue
            category = by_name.get(cat_name)
            if category is None:
                print(f"  skipped {name}: category '{cat_name}' not found")
                continue
            defs = await effective_attributes(db, tenant.id, category.id, tree)
            clean = validate_attributes(defs, {k: v for k, v in attrs.items() if v is not None})
            top = tree.path_names(category.id)[0]
            image_url = save_product_image(tenant.id, dummy_photo(name, brand, top))
            product = Product(
                tenant_id=tenant.id, category_id=category.id, name=name, brand=brand, sku=sku, mrp=mrp,
                search_aliases=aliases, attributes=clean, images=[image_url],
                description=f"{name}. Demo product for testing the app.",
            )
            product.units = [ProductUnit(tenant_id=tenant.id, **u) for u in units]
            db.add(product)
            await db.flush()
            db.add(Stock(product_id=product.id, tenant_id=tenant.id, qty_pieces=0))
            await db.flush()
            if stock:
                await change_stock(
                    db, tenant_id=tenant.id, product_id=product.id, change_pieces=stock,
                    reason="opening", user_id=owner_id, note="Demo data",
                )
            added += 1
            print(f"  added {name}")
        await db.commit()
    await engine.dispose()
    print(f"Done: {added} products added to {tenant.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--join-code", required=True)
    asyncio.run(main(parser.parse_args().join_code))
