"""Product photo storage. Local disk for now (served at /media); object storage later (M8).

Each upload is saved twice as JPEG: 800px for the product page and 200px for lists.
The stored URL is the 800px one; thumb_url() gives the 200px one.
"""

import uuid
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import get_settings

SIZES = {"800": 800, "200": 200}
BANNER_SIZES = {"800": 1400, "200": 500}  # wide banners need more pixels; suffixes stay the same
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 40_000_000  # refuse absurdly large images (decompression bombs)


def media_root() -> Path:
    root = Path(get_settings().media_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _url_prefix() -> str:
    return get_settings().media_url_prefix.rstrip("/")


def thumb_url(url: str) -> str:
    return url[: -len("_800.jpg")] + "_200.jpg" if url.endswith("_800.jpg") else url


def _open_image(data: bytes) -> Image.Image:
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Photo is too large (max 8 MB)")
    try:
        img = Image.open(BytesIO(data))
        if img.width * img.height > MAX_PIXELS:
            raise HTTPException(413, "Photo dimensions are too large")
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(422, "File is not a photo we can read (use JPG, PNG or WebP)") from None
    img = ImageOps.exif_transpose(img)  # phone photos carry rotation in EXIF
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGB", img.size, "white")
        background.paste(img, mask=img.split()[-1])
        return background
    return img.convert("RGB")


def save_product_image(tenant_id: uuid.UUID, data: bytes) -> str:
    return save_image(tenant_id, data, "products")


def save_image(tenant_id: uuid.UUID, data: bytes, kind: str, sizes: dict[str, int] = SIZES) -> str:
    """Save a large and a small JPEG. `sizes` maps the file suffix to the longest side in pixels."""
    img = _open_image(data)
    folder = media_root() / str(tenant_id) / kind
    folder.mkdir(parents=True, exist_ok=True)
    name = uuid.uuid4().hex
    for suffix, size in sizes.items():
        copy = img.copy()
        copy.thumbnail((size, size), Image.Resampling.LANCZOS)
        copy.save(folder / f"{name}_{suffix}.jpg", "JPEG", quality=85, optimize=True)
    return f"{_url_prefix()}/{tenant_id}/{kind}/{name}_800.jpg"


def copy_product_image(tenant_id: uuid.UUID, url: str) -> str | None:
    """Copy one of our stored product photos (both sizes) so another product owns its own files.
    Returns the new URL, the same URL for external photos, or None if the file is gone."""
    import shutil

    prefix = f"{_url_prefix()}/{tenant_id}/products/"
    if not url.startswith(prefix):
        return url
    root = media_root()
    name = uuid.uuid4().hex
    new_url = f"{prefix}{name}_800.jpg"
    for old, new in ((url, new_url), (thumb_url(url), thumb_url(new_url))):
        src = (root / old[len(_url_prefix()) + 1 :]).resolve()
        if not (src.is_relative_to(root) and src.is_file()):
            return None
        shutil.copyfile(src, root / new[len(_url_prefix()) + 1 :])
    return new_url


def delete_product_image(tenant_id: uuid.UUID, url: str) -> None:
    delete_image(tenant_id, url, "products")


def delete_image(tenant_id: uuid.UUID, url: str, kind: str) -> None:
    """Remove our own stored files for this URL. External URLs are ignored."""
    prefix = f"{_url_prefix()}/{tenant_id}/{kind}/"
    if not url.startswith(prefix):
        return
    root = media_root()
    for candidate in (url, thumb_url(url)):
        path = (root / candidate[len(_url_prefix()) + 1 :]).resolve()
        if path.is_relative_to(root) and path.is_file():
            path.unlink()
