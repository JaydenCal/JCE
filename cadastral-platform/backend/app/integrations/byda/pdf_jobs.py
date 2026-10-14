"""PDF jobs that run in a worker process under a time limit (see ``app.common.timeboxed``). Module level functions with plain data in and out, so they can be sent to a spawned
interpreter. The heavy imports happen inside the functions."""
from __future__ import annotations

from typing import Any


def render_page(path: str, page: int, width_px: int, max_px: int) -> dict[str, Any]:
    """One PDF page as PNG bytes with its size in points, or ``{"error": "BAD_PAGE", "pages": n}`` when the page number is outside the document."""
    import pymupdf
    with pymupdf.open(path) as doc:
        if not 1 <= page <= doc.page_count:
            return {"error": "BAD_PAGE", "pages": doc.page_count}
        pg = doc[page - 1]
        r = pg.rect
        zoom = min(width_px / r.width, max_px / r.height)
        png = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False).tobytes("png")
        return {"png": png, "width_pt": r.width, "height_pt": r.height, "pages": doc.page_count}


def parse_plan(path: str, page: int, control_points: list, scale_denominator: float | None, lot_ring: list | None, boundary_rgb: str | None, tolerance_m: float) -> dict[str, Any]:
    """Read a vector DBYD plan with the SA4 parser. Returns the assets as plain dicts and the georeference summary; an AgentError of the parser is re-raised (the worker
    process reports its error code)."""
    from pathlib import Path

    from app.agents.sa4_hydro.dbyd_parse import parse_dbyd
    assets, geo = parse_dbyd(Path(path).read_bytes(), page=page, control_points=control_points, scale_denominator=scale_denominator, lot_ring=lot_ring,
                             boundary_rgb=boundary_rgb, tolerance_m=tolerance_m)
    return {"assets": [{"service": a.service, "geometry_wkt": a.geometry_wkt, "diameter_mm": a.diameter_mm, "material": a.material, "depth_m": a.depth_m} for a in assets],
            "geo": {"outcome": geo.outcome, "rmse_m": geo.rmse_m, "max_residual_m": geo.max_residual_m, "n_points": geo.n_points, "messages": list(geo.messages)}}
