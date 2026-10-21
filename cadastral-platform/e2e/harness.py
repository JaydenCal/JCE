"""Stage 11 e2e harness: the real FastAPI app on 127.0.0.1:8765 with the offline lot2 scene bundle, for the Playwright run (run_e2e.mjs).

WHAT IS FAKED (nothing here is production behaviour; see docs/22 section 9):
* the database pool is ``object()``; the three access dependencies (site_design_access, scene_access, site_rules_dep) are overridden, so there is no login, no terms
  acceptance and no project row. The project id is fixed.
* the council rules are ``tests/ai_support.fake_rules()`` (SYNTHETIC values, not any council's rules). The pages say so through the rule basis.
* the scene bundle is built by the real SA6 adapter from the OFFLINE lot2 fixture (JCESITE_OFFLINE_FIXTURE=lot2, honoured only because JCESITE_ENV=test is set here): synthetic terrain, no
  network, status read from the bundle.
* the scene folder (SCENE_BUNDLE_DIR) and the API export_dir are DIFFERENT folders, so a route or an export that reads the wrong base folder finds no bundle (review fix 4 of docs/22).
* no ANTHROPIC_API_KEY: AI first design runs in rules mode.
* CORS is added to the app HERE ONLY (the browser page is on another port); the production API has no CORS middleware.
Run: python3 e2e/harness.py [--port 8765] [--work DIR]. It prints READY when listening.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "backend" / "tests")]

PROJECT_ID = "5a0e2e11-0000-4000-8000-00000000e2e1"


def build_bundle(base: Path) -> Path:
    os.environ["JCESITE_ENV"] = "test"
    os.environ["JCESITE_OFFLINE_FIXTURE"] = "lot2"
    import app.offline.lot2 as OFF
    from app.common.contracts import DevelopmentType
    from app.orchestrator.adapters import Sa3Dispatch, Sa6Adapter
    from app.orchestrator.adapters.sa6 import Sa6Node
    from scripts.run_site import _user_rules_sa2

    sa1 = OFF.sa1_result()
    dev = DevelopmentType.dwelling_house
    sa2 = _user_rules_sa2([{"element": "front", "value_numeric": 6.0, "unit": "m"}, {"element": "side", "value_numeric": 0.9, "unit": "m"},
                           {"element": "rear", "value_numeric": 6.0, "unit": "m"}], sa1.lot.zone_code or "R2", dev.rule_dwelling_type)
    params = {"development_type": dev.value}
    env = Sa3Dispatch().run(Sa3Dispatch.input_model.model_validate({"node": "ENV", "env": {"sa1": sa1.model_dump(mode="json"), "sa2": sa2.model_dump(mode="json"), "params": params}}))
    out_dir = base / PROJECT_ID
    node = Sa6Node.model_validate({"project_id": PROJECT_ID, "project_title": "Lot 2 offline", "sa1": sa1.model_dump(mode="json"), "env": env.model_dump(mode="json"),
                                   "params": params, "output_path": str(out_dir)})
    res = Sa6Adapter(env={"JCESITE_ENV": "test", "JCESITE_OFFLINE_FIXTURE": "lot2", "JCESITE_AERIAL": "none"}).run(node)
    return Path(res.scene_bundle_path)


def make_app(base: Path):
    import ai_support as A
    from fastapi.middleware.cors import CORSMiddleware
    from app.api.app import create_app
    from app.api.scene import scene_access
    from app.api.settings import Settings
    from app.api.site_design import site_design_access, site_rules_dep

    os.environ["SCENE_BUNDLE_DIR"] = str(base)
    os.environ.pop("ANTHROPIC_API_KEY", None)
    app = create_app(Settings(export_dir=str(base.parent / (base.name + "_export_dir_unused"))), pool=object())
    user = uuid.UUID("00000000-0000-4000-8000-000000000001")
    app.dependency_overrides[site_design_access] = lambda: user
    app.dependency_overrides[scene_access] = lambda: user
    app.dependency_overrides[site_rules_dep] = lambda: A.fake_rules()
    app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:3100", "http://localhost:3100"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["Content-Disposition"])
    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--work", default="")
    a = ap.parse_args()
    base = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="jcesite_e2e_"))
    base.mkdir(parents=True, exist_ok=True)
    p = build_bundle(base)
    app = make_app(base)
    import uvicorn
    print(f"READY bundle={p} project={PROJECT_ID}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
