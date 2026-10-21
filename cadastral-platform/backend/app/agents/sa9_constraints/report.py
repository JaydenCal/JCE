"""SA9 outputs: GeoJSON + OverlayPolygon helpers and the report entry point (the PDF itself is built by app.report)."""
from __future__ import annotations

import json
from pathlib import Path

from shapely import wkt
from shapely.geometry import mapping

from app.agents.sa9_constraints.intersect import LayerResult
from app.agents.sa9_constraints.layers import REGISTRY
from app.agents.sa9_constraints.triggers import TriggerResult
from app.common.contracts import OverlayPolygon



def overlay_polygons(results: list[LayerResult]) -> list[OverlayPolygon]:
    return [OverlayPolygon(label=r.label, kind=REGISTRY[r.key].kind if r.key in REGISTRY else "constraint", geometry_wkt=w)
            for r in results if r.status == "affected" for w in r.geometries_wkt]


def geojson(results: list[LayerResult], lot_wkt: str, footprint_wkt: str | None, srid: int) -> dict:
    feats = [{"type": "Feature", "properties": {"role": "lot"}, "geometry": mapping(wkt.loads(lot_wkt))}]
    if footprint_wkt:
        feats.append({"type": "Feature", "properties": {"role": "footprint"}, "geometry": mapping(wkt.loads(footprint_wkt))})
    for r in results:
        if r.status == "affected":
            for w, i in zip(r.geometries_wkt, range(len(r.geometries_wkt))):
                a = r.attributes[i] if i < len(r.attributes) else {}
                feats.append({"type": "Feature", "geometry": mapping(wkt.loads(w)),
                              "properties": {"role": "constraint", "layer": r.key, "label": r.label,
                                             "kind": REGISTRY[r.key].kind if r.key in REGISTRY else "constraint", **a}})
    return {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": f"EPSG:{srid}"}}, "features": feats}


def build_report(path_pdf: Path, path_json: Path, meta: dict, results: list[LayerResult], triggers: list[TriggerResult],
                 lot_wkt: str, fp_wkt: str | None, acknowledgements: list[str], imagery="env", **extras) -> bytes:
    """Write the Site Assessment and Planning Constraints Report (PDF) and its JSON. extras: SiteReportInputs fields
    (neighbours, segments, road_names, requirements, unresolved_requirements, civil, pathway, brand, srid)."""
    from app.report import SiteReportInputs, build_site_report
    from app.report.inputs import IMAGERY_FROM_ENV
    maps_dir = extras.pop("maps_dir", None)
    inp = SiteReportInputs(meta=meta, results=results, triggers=triggers, lot_wkt=lot_wkt, footprint_wkt=fp_wkt,
                           srid=int(extras.pop("srid", meta.get("mga_srid", 7856))), acknowledgements=list(acknowledgements),
                           imagery=IMAGERY_FROM_ENV if imagery == "env" else imagery, **extras)
    pdf, js = build_site_report(inp, maps_dir=maps_dir)
    Path(path_pdf).write_bytes(pdf)
    out = {"meta": meta, "layers": [r.model_dump() for r in results], "triggers": [t.model_dump() for t in triggers], "legal": js["legal"], "report": js}
    Path(path_json).write_text(json.dumps(out, indent=1, default=str))
    return pdf
