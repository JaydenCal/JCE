"""live_levels with a stubbed exportImage (no network)."""
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.agents.sa3_terrain.live_levels import fetch_levels  # noqa: E402
from app.agents.sa3_terrain.models import SurveyInput  # noqa: E402

WKT = "POLYGON((228000 6575000,228047 6575000,228047 6575020,228000 6575020,228000 6575000))"


def stub(service, bbox, w, h):
    buf = io.BytesIO()
    Image.fromarray(np.fromfunction(lambda r, c: 100 + 0.1 * c, (h, w)).astype("float32"), mode="F").save(buf, "TIFF")
    return buf.getvalue()


def test_levels_small_lot_warns_and_validates():
    lv = fetch_levels(WKT, 7856, export=stub)
    SurveyInput(**lv.survey)
    assert lv.provenance["points"] > 50 and lv.survey["stated_vertical_accuracy_m"] == 5.0
    assert any("too coarse" in w for w in lv.warnings) and any("UNKNOWN" in w for w in lv.warnings)


def test_user_accuracy_and_cap():
    big = "POLYGON((228000 6575000,229500 6575000,229500 6575500,228000 6575500,228000 6575000))"
    lv = fetch_levels(big, 7856, export=stub, accuracy_m=1.5, max_points=500)
    assert lv.provenance["vertical_accuracy_source"] == "user_entered" and lv.provenance["points"] <= 800 and lv.provenance["stride"] > 1
