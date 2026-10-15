"""The stored GLBs of the buildings of a project: ``<project folder>/building_glb/<building object id>.glb`` (written by PUT /projects/{id}/exports/building-glb/{object id}).

A GLB belongs to a building OBJECT of the saved design. ``prune`` removes the files of buildings that are no longer in the saved design (called on every PUT of the site design), so a removed
building leaves no model behind. There is no project deletion in the platform yet: a project folder that is removed takes ``building_glb/`` with it; a delete hook must call ``prune(folder, set())``.
"""
from __future__ import annotations

import contextlib
import logging
from pathlib import Path
from typing import Iterable

log = logging.getLogger(__name__)

BUILDING_GLB_DIR = "building_glb"
MAX_BUILDING_GLB_BYTES = 15 * 1024 * 1024


def glb_path(folder: Path, object_id: str) -> Path:
    return folder / BUILDING_GLB_DIR / f"{object_id}.glb"


def prune(folder: Path, keep_ids: Iterable[str]) -> list[str]:
    """Delete the stored GLBs (and their lock files) whose building id is not in ``keep_ids``. Returns the ids removed. Never raises: a file that cannot be removed is logged."""
    d = folder / BUILDING_GLB_DIR
    keep = set(keep_ids)
    removed: list[str] = []
    try:
        names = sorted(p for p in d.iterdir() if p.is_file())
    except OSError:
        return removed
    for p in names:
        stem = p.name[:-len(".glb")] if p.name.endswith(".glb") else p.name[:-len(".glb.lock")] if p.name.endswith(".glb.lock") else None
        if stem is None or stem in keep:
            continue
        try:
            p.unlink()
            if p.name.endswith(".glb"):
                removed.append(stem)
        except OSError:
            log.warning("building GLB %s could not be removed", p)
    with contextlib.suppress(OSError):
        d.rmdir()                                           # only when empty
    return removed
