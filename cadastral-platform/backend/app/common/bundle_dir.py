"""The one place that decides where the per project files of the 3D site tool live (scene bundle, site design, imports, stormwater, building GLBs, first design ledger).

``<base>/<project_id>/...`` where ``<base>`` is the ``SCENE_BUNDLE_DIR`` environment variable when it is set, otherwise the export directory of the API (``EXPORT_DIR``). The orchestrator's
SA6 writer, ``GET /projects/{id}/scene-bundle``, the site design routes and the exports all call ``scene_base_dir``, so a bundle that SA6 writes is the bundle the viewer and the exports read,
whichever of the two settings is in use.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping

ENV_NAME = "SCENE_BUNDLE_DIR"


def scene_base_dir(export_dir: str | os.PathLike[str], env: Mapping[str, str] | None = None) -> Path:
    v = (os.environ if env is None else env).get(ENV_NAME)
    return Path(v) if v else Path(export_dir)


def project_dir(export_dir: str | os.PathLike[str], project_id: object, env: Mapping[str, str] | None = None) -> Path:
    return scene_base_dir(export_dir, env) / str(project_id)
