from decimal import Decimal

from app.modules.orders.bill import inr, pack_label


def test_indian_money_format():
    assert inr(Decimal("0")) == "₹0.00"
    assert inr(Decimal("999")) == "₹999.00"
    assert inr(Decimal("12345")) == "₹12,345.00"
    assert inr(Decimal("1234567.5")) == "₹12,34,567.50"
    assert inr(Decimal("123456789")) == "₹12,34,56,789.00"


def test_pack_label():
    assert pack_label("Packet", 1) == "Packet"
    assert pack_label("Carton", 24) == "Carton (24 pcs)"
    assert pack_label("Bag (30)", 30) == "Bag (30)"
    assert pack_label("Box of 12", 12) == "Box of 12"
