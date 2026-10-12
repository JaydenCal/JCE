"""PDF upload validation and storage."""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.api.deps import ApiError

ALLOWED_MIME = {"application/pdf", "application/x-pdf"}
_ACTIVE = re.compile(
    rb"/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA)(?![A-Za-z0-9_#.\-])")


@dataclass
class StoredPdf:
    path: Path
    sha256: str
    byte_size: int
    page_count: int
    page_width_pt: float | None
    page_height_pt: float | None
    rotation_deg: int
    producer: str | None
    creator: str | None
    content_class: str


def safe_filename(name: str | None) -> str:
    base = os.path.basename((name or "upload.pdf").replace("\\", "/"))
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base)[:200].strip(" .")
    return base or "upload.pdf"


def store_pdf(src: BinaryIO, content_type: str | None, upload_dir: str, max_bytes: int) -> StoredPdf:
    """Validate (MIME, size, %PDF magic, parseable, no active content), hash, and store
    immutably at <upload_dir>/<sha[:2]>/<sha>.pdf (content-addressed; identical files share a path)."""
    if (content_type or "").split(";")[0].strip().lower() not in ALLOWED_MIME:
        raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/pdf")
    root = Path(upload_dir)
    root.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256()
    size = 0
    first = b""
    fd, tmp_name = tempfile.mkstemp(dir=root, suffix=".part")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := src.read(1024 * 1024):
                if not first:
                    first = chunk[:8]
                size += len(chunk)
                if size > max_bytes:
                    raise ApiError(413, "FILE_TOO_LARGE", f"limit is {max_bytes} bytes")
                h.update(chunk)
                out.write(chunk)
        if size == 0:
            raise ApiError(400, "EMPTY_FILE", "file is empty")
        if not first.startswith(b"%PDF-"):
            raise ApiError(415, "NOT_A_PDF", "file does not start with %PDF-")
        raw = tmp.read_bytes()
        if _ACTIVE.search(raw):
            raise ApiError(422, "PDF_ACTIVE_CONTENT", "PDFs with JavaScript, launch actions or embedded files are rejected")
        meta = _inspect(tmp)
        sha = h.hexdigest()
        final = root / sha[:2] / f"{sha}.pdf"
        final.parent.mkdir(parents=True, exist_ok=True)
        os.replace(tmp, final)
        final.chmod(0o444)
        return StoredPdf(final.resolve(), sha, size, **meta)
    finally:
        if tmp.exists():
            tmp.unlink()


def _inspect(path: Path) -> dict:
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(str(path), strict=False)
        if reader.is_encrypted:
            raise ApiError(422, "PDF_ENCRYPTED", "encrypted PDFs are not supported")
        n = len(reader.pages)
        if n < 1:
            raise ApiError(422, "PDF_UNREADABLE", "PDF has no pages")
        root = reader.trailer["/Root"]
        names = root.get("/Names") or {}
        if hasattr(names, "get_object"):
            names = names.get_object()
        if "/JavaScript" in names or "/EmbeddedFiles" in names or "/AA" in root:
            raise ApiError(422, "PDF_ACTIVE_CONTENT", "PDFs with JavaScript or embedded files are rejected")
        page = reader.pages[0]
        w, h = float(page.mediabox.width), float(page.mediabox.height)
        rot = int(page.get("/Rotate", 0) or 0) % 360
        info = reader.metadata
        try:
            has_text = bool((page.extract_text() or "").strip())
        except Exception:  # noqa: BLE001
            has_text = True
        try:
            has_img = len(page.images) > 0
        except Exception:  # noqa: BLE001
            has_img = False
        cls = "hybrid" if has_text and has_img else "raster" if has_img else "vector" if has_text else "hybrid"
        return {
            "page_count": n, "page_width_pt": round(w, 3), "page_height_pt": round(h, 3),
            "rotation_deg": rot if rot in (0, 90, 180, 270) else 0,
            "producer": getattr(info, "producer", None) if info else None,
            "creator": getattr(info, "creator", None) if info else None,
            "content_class": cls,
        }
    except ApiError:
        raise
    except (PyPdfError, KeyError, ValueError, OSError, RecursionError) as e:
        raise ApiError(422, "PDF_UNREADABLE", f"could not parse PDF: {type(e).__name__}") from e
