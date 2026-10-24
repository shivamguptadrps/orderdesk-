import re

_INDIAN_MOBILE = re.compile(r"[6-9]\d{9}")


def normalize_phone(raw: str) -> str:
    """Turn '98765 43210', '+91-9876543210', '09876543210' into '+919876543210'."""
    digits = re.sub(r"[\s\-()]", "", raw or "")
    if digits.startswith("+91"):
        digits = digits[3:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if not _INDIAN_MOBILE.fullmatch(digits):
        raise ValueError("Enter a valid 10-digit Indian mobile number")
    return "+91" + digits
