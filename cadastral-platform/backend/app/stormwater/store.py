"""Per project storage of the stormwater data: the uploaded IFD table, ARR Data Hub export and soil table (each with its provenance) and the user's entries.

Location: ``<project dir>/stormwater/<name>.json`` where the project dir is the one of the site design (``SCENE_BUNDLE_DIR`` or the export dir). Writes are atomic and
locked (``app.common.filestore``). Nothing is shared across projects. Nothing is invented: a missing file is simply "not uploaded".
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.common.filestore import atomic_write_text, file_lock

NAMES = ("ifd", "arr", "soil", "inputs")
MAX_STORED_BYTES = 3 * 1024 * 1024


class StoreTooLarge(ValueError):
    """A parsed upload is larger than the stored file limit. The API answers 422 (``STORED_FILE_TOO_LARGE``), never 500."""


class StormwaterStore:
    def __init__(self, project_dir: Path) -> None:
        self.dir = Path(project_dir) / "stormwater"

    def _path(self, name: str) -> Path:
        if name not in NAMES:
            raise ValueError("unknown stormwater file")
        return self.dir / f"{name}.json"

    def load(self, name: str) -> dict[str, Any] | None:
        p = self._path(name)
        try:
            if p.stat().st_size > MAX_STORED_BYTES:
                return None
            v = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return v if isinstance(v, dict) else None

    def save(self, name: str, value: dict[str, Any]) -> None:
        p = self._path(name)
        text = json.dumps(value, separators=(",", ":"))
        if len(text.encode("utf-8")) > MAX_STORED_BYTES:
            raise StoreTooLarge(f"THE PARSED {name.upper()} DATA IS LARGER THAN THE {MAX_STORED_BYTES // (1024 * 1024)} MB STORED FILE LIMIT")
        with file_lock(p):
            atomic_write_text(p, text)

    def delete(self, name: str) -> bool:
        p = self._path(name)
        with file_lock(p):
            try:
                p.unlink()
                return True
            except OSError:
                return False

    def summary(self) -> dict[str, Any]:
        """What is stored (provenance only, no tables), for the panel."""
        ifd, arr, soil = self.load("ifd"), self.load("arr"), self.load("soil")
        return {
            "ifd": None if ifd is None else {"provenance": ifd.get("provenance"), "kind": ifd.get("kind"), "durations": len(ifd.get("durations_min") or []), "aeps_pct": ifd.get("aeps_pct"), "warnings": ifd.get("warnings") or []},
            "arr": None if arr is None else {k: arr.get(k) for k in ("location", "storm_initial_loss_mm", "storm_continuing_loss_mm_h", "impervious_initial_loss_mm", "impervious_continuing_loss_mm_h",
                                                                     "time_accessed", "data_version", "provenance")},
            "soil": None if soil is None else {"provenance": soil.get("provenance"), "label": soil.get("label"), "rows": soil.get("rows") or []},
        }
