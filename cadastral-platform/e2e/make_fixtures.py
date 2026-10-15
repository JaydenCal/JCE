"""Writes the SYNTHETIC e2e fixtures into e2e/fixtures/: an IFD table (not BoM data), a box GLB standing in for a Plan Studio GLB, and a copy of the synthetic Plan Studio design."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend")]
OUT = Path(__file__).resolve().parent / "fixtures"

IFD_CSV = """SYNTHETIC TEST FIXTURE, NOT BOM DATA
Issued: 01/01/2016
Location label: Synthetic Test Point
Requested coordinate: Latitude -33.5000 S, Longitude 151.2000 E
Nearest grid cell: Latitude -33.5000 S, Longitude 151.2000 E
Intensity (mm/h)
Duration,50%,20%,10%,1%
5 min,120,140,150,200
10 min,80,95,100,140
20 min,50,56,60,85
30 min,38,43,45,66
60 min,25,28,30,45
"""


def box_glb() -> bytes:
    """A 7 m by 10 m by 2.55 m box, Y up, plan Y running to negative Z (Plan Studio space), standing in for the exported GLB."""
    from app.exports import glb as XG
    x0, x1, z0, z1, h = -0.5, 7.5, -3.5, 7.5, 2.55
    c = [(x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1), (x0, h, z0), (x1, h, z0), (x1, h, z1), (x0, h, z1)]
    f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]
    g = XG.Glb()
    m = g.material("#b8b2a6", name="wall")
    mesh = g.mesh("box", [g.primitive(c, f, m)])
    return g.to_bytes([g.node("building", mesh)], {})


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ifd_synthetic.csv").write_text(IFD_CSV)
    (OUT / "building_synthetic.glb").write_bytes(box_glb())
    shutil.copyfile(ROOT / "backend" / "tests" / "fixtures" / "planstudio_synthetic.planstudio.json", OUT / "building_synthetic.planstudio.json")
    for p in sorted(OUT.iterdir()):
        print(p.name, p.stat().st_size)


if __name__ == "__main__":
    main()
