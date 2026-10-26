"""Starter category templates loaded for a new distributor. The distributor can edit them freely.

Names are simple words with Hindi ("Rice / चावल"), and every category carries other names
(Hinglish, Hindi, common words) that search uses: a shop typing "chawal" or "चीनी" finds the right
products even when the product name doesn't say so.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import AttributeDefinition, Category


def _num(key, label, unit, required=False, is_filter=True):
    return {"key": key, "label": label, "type": "number", "unit": unit, "required": required, "is_filter": is_filter}


def _select(key, label, options, required=False, is_filter=True):
    return {"key": key, "label": label, "type": "select", "options": options, "required": required, "is_filter": is_filter}


def _text(key, label, required=False, is_filter=False):
    return {"key": key, "label": label, "type": "text", "required": required, "is_filter": is_filter}


# Sizes are numbers with a unit so shops can filter and sort by them.
_KG = _num("weight_kg", "Pack weight", "kg", required=True)
_G = _num("weight_g", "Pack weight", "g")
_ML = _num("volume_ml", "Volume", "ml")


def _c(name, aliases, attrs=(), children=()):
    return {"name": name, "aliases": aliases, "attrs": list(attrs), "children": list(children)}


FMCG_TEMPLATE = [
    _c("Ration / राशन", "rashan, kirana, grocery, staples, राशन, किराना", children=[
        _c("Rice / चावल", "chawal, chaawal, basmati, चावल, बासमती",
           [_KG, _select("variety", "Variety", ["Basmati", "Sona Masoori", "Kolam", "Parboiled", "Other"])]),
        _c("Atta & Flour / आटा", "aata, atta, flour, maida, sooji, suji, rava, besan, आटा, मैदा, सूजी, रवा, बेसन",
           [_KG, _select("flour_type", "Type", ["Wheat atta", "Multigrain atta", "Maida", "Sooji / Rava", "Besan", "Rice flour", "Other"])]),
        _c("Dal / दाल", "daal, dal, pulses, toor, arhar, moong, chana, urad, masoor, rajma, दाल, अरहर, मूंग, चना, उड़द, मसूर, राजमा",
           [_KG, _select("dal_type", "Type", ["Toor / Arhar", "Moong", "Chana", "Urad", "Masoor", "Rajma", "Kabuli chana", "Other"])]),
        _c("Sugar / चीनी", "cheeni, chini, shakkar, sugar, चीनी, शक्कर",
           [_KG, _select("grain", "Grain", ["Fine", "Medium", "Bold"])]),
        _c("Poha & Daliya / पोहा", "poha, chivda, chura, daliya, dalia, पोहा, चिवड़ा, दलिया", [_KG]),
        _c("Salt & Gud / नमक-गुड़", "namak, salt, gud, gur, jaggery, नमक, गुड़", [_KG]),
    ]),
    _c("Oil & Ghee / तेल-घी", "tel, oil, ghee, तेल, घी", children=[
        _c("Oil / तेल", "tel, refined, sarson, mustard, soyabean, sunflower, तेल, सरसों, रिफाइंड", [
            _num("volume_l", "Volume", "L", required=True),
            _select("oil_type", "Oil type", ["Mustard", "Sunflower", "Soybean", "Groundnut", "Rice bran", "Palm", "Other"]),
            _select("pack_type", "Pack", ["Pouch", "Bottle", "Jar", "Tin"]),
        ]),
        _c("Ghee / घी", "ghee, ghi, desi ghee, cow ghee, घी, देसी घी", [
            _ML,
            _select("ghee_type", "Type", ["Cow", "Buffalo", "Desi", "Mixed"]),
            _select("pack_type", "Pack", ["Jar", "Pouch", "Tin", "Bottle"]),
        ]),
    ]),
    _c("Masala / मसाले", "masala, spices, mirch, haldi, dhaniya, jeera, garam masala, मसाला, मसाले, मिर्च, हल्दी, धनिया, जीरा",
       [_G, _select("spice_type", "Type", ["Whole spices", "Ground spices", "Blended masala", "Other"])]),
    _c("Packet food / पैकेट फूड", "packaged food, ready food, instant", [_G], children=[
        _c("Pasta & Noodles / पास्ता", "pasta, noodles, maggi, macaroni, penne, पास्ता, नूडल्स", []),
        _c("Sweet mixes / मीठे मिक्स", "falooda, faluda, custard, jelly, kheer mix, dessert, फालूदा, कस्टर्ड",
           [_text("flavour", "Flavour", is_filter=True)]),
        _c("Cooking mixes / रेडी मिक्स", "ready to cook, instant mix, upma, idli mix, poha masala, रेडी मिक्स", []),
        _c("Breakfast / नाश्ता", "breakfast, cornflakes, oats, muesli, नाश्ता", []),
    ]),
    _c("Snacks / नमकीन", "snacks, namkeen, नमकीन, स्नैक्स", [_G, _text("flavour", "Flavour")], children=[
        _c("Chips / चिप्स", "chips, wafers, चिप्स", []),
        _c("Biscuits / बिस्कुट", "biscuit, biskut, cookies, बिस्कुट", []),
        _c("Namkeen / नमकीन", "namkeen, bhujia, mixture, नमकीन, भुजिया", []),
    ]),
    _c("Drinks / पेय", "drinks, beverages, पेय", children=[
        _c("Cold drinks / कोल्ड ड्रिंक", "cold drink, soft drink, juice, soda, कोल्ड ड्रिंक, जूस", [_ML, _text("flavour", "Flavour")]),
        _c("Tea & Coffee / चाय-कॉफी", "chai, chai patti, tea, coffee, चाय, चायपत्ती, कॉफी", [_G]),
    ]),
    _c("Soap & Care / साबुन", "personal care, sabun, soap, shampoo, साबुन, शैम्पू",
       [_num("weight_g", "Weight", "g"), _num("volume_ml", "Volume", "ml")], children=[
        _c("Soap / साबुन", "sabun, saboon, soap, body wash, साबुन", []),
        _c("Hair / बाल", "shampoo, hair oil, tel, शैम्पू, बालों का तेल", []),
        _c("Teeth / दांत", "toothpaste, manjan, brush, टूथपेस्ट, मंजन", []),
        _c("Skin / क्रीम", "cream, lotion, powder, क्रीम, पाउडर", []),
    ]),
    _c("Cleaning / सफाई", "home care, safai, cleaning, सफाई",
       [_num("weight_g", "Weight", "g"), _num("volume_ml", "Volume", "ml")], children=[
        _c("Detergent / सर्फ", "surf, sarf, washing powder, detergent, कपड़े धोने का पाउडर, सर्फ", []),
        _c("Dishwash / बर्तन", "bartan, vim, dishwash, बर्तन", []),
        _c("Cleaners / क्लीनर", "phenyl, floor cleaner, toilet cleaner, harpic, फिनाइल", []),
    ]),
]


async def apply_fmcg_template(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    async def add(nodes, parent_id):
        for order, node in enumerate(nodes):
            cat = Category(tenant_id=tenant_id, parent_id=parent_id, name=node["name"], aliases=node["aliases"], sort_order=order)
            db.add(cat)
            await db.flush()
            for a_order, attr in enumerate(node["attrs"]):
                db.add(AttributeDefinition(tenant_id=tenant_id, category_id=cat.id, sort_order=a_order, **attr))
            await add(node["children"], cat.id)

    await add(FMCG_TEMPLATE, None)
    await db.flush()
