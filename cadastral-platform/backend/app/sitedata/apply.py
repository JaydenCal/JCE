"""Turn a parsed ``SiteData`` into the inputs the run uses: the subject lot, the terrain survey, the plan set contours, the BYDA data panel and the
"Site data sources" table.  Nothing here invents a value; anything not supplied is reported as missing."""
from __future__ import annotations

import datetime as dt
import math
import uuid
from dataclasses import dataclass, field

import numpy as np
import shapely
from shapely.geometry import MultiPolygon, Point, Polygon, box

from app.sitedata.models import AREA_TOLERANCE, DRAFT, FLAG, NOT_USED, SiteData, SourceItem, ddmmyyyy

MAX_TIN_POINTS = 15000            # level points kept for the TIN and the plan set (small lots keep every point; see thin_points)
POINT_BUFFER_M = 60.0             # points are kept this far outside the lot so the plan window and the TIN edge are covered


# ---------------------------------------------------------------------------------------------------------------- subject lot
def lot_from_boundary(sd: SiteData, lotplan: str | None = None, lga: str | None = None, zone: str | None = None):
    """An ``Sa1Result`` built from the collector boundary.  No road, neighbour or zoning data exist in the folder, so none are invented: the segments
    adjoin "unknown", no frontage is identified, the neighbour list is empty and the zone is only set when the caller supplies it."""
    from app.agents.sa1_cadastre.geometry import compute_segments
    from app.agents.sa1_cadastre.models import LotIdentifier, Sa1Result, ZoneShare
    b = sd.boundary
    if b is None:
        raise ValueError("site data has no boundary")
    from app.common.contracts import LotContext
    segs, det, names = compute_segments(b.polygon, roads=[])
    lp = lotplan or b.lotplan or "UNRESOLVED"
    lot = LotContext(lot_id=uuid.uuid5(uuid.NAMESPACE_URL, "site_data:" + lp + b.source_file), jurisdiction="NSW", lotplan=lp,
                     lga_name=(lga or "UNRESOLVED").upper(), mga_srid=b.srid, area_m2_calculated=round(b.polygon.area, 1),
                     area_m2_registered=round(b.stated_area_ha * 10000.0, 1) if b.stated_area_ha else None, boundary_wkt=b.polygon.wkt, segments=segs,
                     road_names=[], zone_code=zone, envelope_wkt=None, neighbours=[])
    try:
        ident = LotIdentifier.parse(lp, "NSW")
    except Exception:  # noqa: BLE001 - an unparseable lot number is shown as UNRESOLVED, not guessed
        ident = LotIdentifier(jurisdiction="NSW", lot="UNRESOLVED", plan_type="DP", plan_number="0")
    zones = [ZoneShare(zone_code=zone, zone_name="USER SUPPLIED (--zone-code)", instrument="NOT STATED", is_residential=False, overlap_area_m2=lot.area_m2_calculated,
                       overlap_fraction=1.0, is_dominant=True)] if zone else []
    flags = ["site_data_boundary", "no_road_data", "no_neighbour_data"] + (["area_mismatch_stated"] if b.area_flag else [])
    return Sa1Result(lot=lot, identifier=ident, segment_details=det, zones=zones, multi_zone=False, is_residential=None, area_mismatch=b.area_flag, flags=flags,
                     snapshots=[], boundary_wkt_gda2020="", attributes={"site_data_boundary": b.source_label})


def compare_with_sa1(sd: SiteData, sa1_lot) -> dict:
    """Collector boundary against the SA1 lot: area difference (flag over 2 percent) and the overlap of the two polygons.  Neither is silently chosen."""
    from shapely import wkt as swkt
    b = sd.boundary
    a_sa1 = float(sa1_lot.area_m2_calculated)
    a_col = float(b.polygon.area)
    diff = (a_col - a_sa1) / a_sa1 * 100.0 if a_sa1 else math.nan
    try:
        g = swkt.loads(sa1_lot.boundary_wkt)
        iou = float(g.intersection(b.polygon).area / g.union(b.polygon).area)
    except Exception:  # noqa: BLE001
        iou = None
    flag = bool(a_sa1) and abs(a_col - a_sa1) / a_sa1 > AREA_TOLERANCE
    return {"sa1_area_m2": round(a_sa1, 1), "collector_area_m2": round(a_col, 1), "difference_pct": round(diff, 3), "flag": flag,
            "overlap_iou": round(iou, 4) if iou is not None else None, "tolerance_pct": AREA_TOLERANCE * 100.0}


# ---------------------------------------------------------------------------------------------------------------- terrain
def thin_points(pts: np.ndarray, max_points: int = MAX_TIN_POINTS) -> tuple[np.ndarray, dict]:
    """Keep every point when there are no more than ``max_points``; otherwise keep one point per square cell (the point nearest the cell centre), the
    cell size chosen from the extent so about ``max_points`` remain.  Deterministic."""
    n = len(pts)
    if n <= max_points:
        return pts, {"points_in": n, "points_out": n, "cell_m": None, "thinned": False}
    w = float(np.ptp(pts[:, 0])) or 1.0
    h = float(np.ptp(pts[:, 1])) or 1.0
    cell = math.sqrt(w * h / max_points)
    for _ in range(8):
        ix = np.floor((pts[:, 0] - pts[:, 0].min()) / cell).astype(np.int64)
        iy = np.floor((pts[:, 1] - pts[:, 1].min()) / cell).astype(np.int64)
        cx = pts[:, 0].min() + (ix + 0.5) * cell
        cy = pts[:, 1].min() + (iy + 0.5) * cell
        d2 = (pts[:, 0] - cx) ** 2 + (pts[:, 1] - cy) ** 2
        key = ix * 1_000_003 + iy
        order = np.lexsort((d2, key))
        first = np.ones(n, bool)
        first[1:] = key[order][1:] != key[order][:-1]
        keep = np.sort(order[first])
        if len(keep) <= max_points * 1.15:
            break
        cell *= 1.12
    out = pts[keep]
    return out, {"points_in": n, "points_out": int(len(out)), "cell_m": round(cell, 2), "thinned": True}


def level_points(sd: SiteData, lot: Polygon, max_points: int = MAX_TIN_POINTS) -> tuple[np.ndarray, dict]:
    """LiDAR points in and around the lot (buffer POINT_BUFFER_M), thinned for the lot size.  Raises ValueError without LiDAR points."""
    if sd.lidar is None or not sd.lidar.has_points:
        raise ValueError("no LiDAR points in the site data")
    P = sd.lidar.points
    zone = lot.buffer(POINT_BUFFER_M)
    m = shapely.contains_xy(zone, P[:, 0], P[:, 1])
    P = P[m]
    if len(P) < 6:
        raise ValueError("fewer than 6 LiDAR points within the lot and its surrounds")
    out, info = thin_points(P, max_points)
    info.update(buffer_m=POINT_BUFFER_M, in_lot=int(shapely.contains_xy(lot, out[:, 0], out[:, 1]).sum()))
    return out, info


def survey_kwargs(sd: SiteData, pts: np.ndarray, srid: int) -> dict:
    """``SurveyInput`` keyword arguments.  The stated vertical accuracy comes from lidar_status.md; without one the survey cannot state an accuracy and
    the caller must not invent it (a pessimistic placeholder is used and the source text says so)."""
    acc = sd.vertical_accuracy_m
    label = sd.terrain_label or "LIDAR DEM"
    return {"srid": srid, "points": [(round(float(x), 3), round(float(y), 3), round(float(z), 3)) for x, y, z in pts],
            "stated_vertical_accuracy_m": acc if acc is not None else 5.0,
            "source": f"SITE DATA COLLECTOR: {sd.lidar.points_file} ({label})" + ("" if acc is not None else "; vertical accuracy NOT STATED (5.0 m placeholder, not a stated figure)")}


def window_fetch(sd: SiteData, pts: np.ndarray, srid: int):
    """Plan set ``dem_fetch``: polygon -> survey kwargs from the already thinned LiDAR points inside the polygon."""
    def fetch(poly: Polygon) -> dict | None:
        m = shapely.contains_xy(poly, pts[:, 0], pts[:, 1])
        return survey_kwargs(sd, pts[m], srid) if m.sum() >= 6 else None
    return fetch


def supplied_contours(sd: SiteData) -> list | None:
    """[(rl, major, (n,2) array)] to hand to the plan set, or None (the plan set then builds contours from the TIN)."""
    if sd.lidar is None or not sd.lidar.contours:
        return None
    return [(c.rl, c.major, c.coords) for c in sd.lidar.contours]


def collector_fall_check(sd: SiteData, fall: dict | None) -> dict:
    """The collector's own best fit plane (lidar_status.md) against the platform's recomputation from the levels.  Reported, not used for design."""
    st = sd.lidar.status.stats if sd.lidar is not None and sd.lidar.status is not None else {}
    out = {"collector_grade_pct": st.get("fit_grade_pct"), "collector_bearing_deg": st.get("fit_bearing_deg"),
           "platform_grade_pct": round(fall["pct"], 2) if fall else None, "platform_bearing_deg": round(fall["bearing"], 1) if fall else None}
    if fall and st.get("fit_bearing_deg") is not None:
        d = abs((fall["bearing"] - st["fit_bearing_deg"] + 180.0) % 360.0 - 180.0)
        out["bearing_difference_deg"] = round(d, 1)
    return out


# ---------------------------------------------------------------------------------------------------------------- BYDA data panel
@dataclass
class BydaPanel:
    """Text for the C100 and C310 data panels, the report and the SoEE.  Every line is stated from the status file or says it is not stated."""
    headline: str
    lines: list[str] = field(default_factory=list)
    validity_state: str = "unknown"
    job_no: str | None = None
    responded: int = 0
    total: int = 0
    gis_draft_count: int = 0

    def all_lines(self) -> list[str]:
        return [self.headline] + self.lines

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def byda_panel(sd: SiteData, run_date: dt.date) -> BydaPanel | None:
    by = sd.byda
    if by is None or by.status_file is None:
        return None
    job = by.job_no or "NOT STATED"
    plans = "PLANS RECEIVED, NOT TRACED" if by.responded > 0 else "NO RESPONSES RECEIVED, NO PLANS"
    head = f"BYDA JOB {job}: {by.responded} OF {by.total} OWNERS RESPONDED; {plans}. EXISTING SERVICES NOT CONFIRMED ON THIS DRAWING"
    state, vtext = by.validity(run_date)
    lines: list[str] = []
    enq = []
    if by.enquiry_no:
        enq.append(f"ENQUIRY {by.enquiry_no}")
    if by.lodged:
        enq.append(f"LODGED {by.lodged}")
    if by.job_from and by.job_to:
        enq.append(f"JOB DATES {ddmmyyyy(by.job_from)} TO {ddmmyyyy(by.job_to)}")
    if enq:
        lines.append(", ".join(enq))
    lines.append(vtext)
    out = [o for o in by.owners if not o.responded]
    if by.total == 0:
        lines.append("OWNER TABLE NOT READ FROM THE STATUS FILE: NO RESPONSE IS COUNTED")
    elif out:
        lines.append("NO RESPONSE RECORDED: " + "; ".join(f"{o.name.upper()} ({o.status.upper()})" for o in out))
    lines.append("OWNER STATUS: " + "; ".join(f"{o.name.upper()}, {o.status.upper()}" for o in by.owners) if by.owners else "OWNER STATUS NOT AVAILABLE")
    lines.append("ASSET OWNER PLANS ARE FOR THIS PROJECT ONLY: NOT TO BE REUSED OR REDISTRIBUTED")
    if by.gis_features:
        lines.append(f"{len(by.gis_features)} DRAFT VECTOR FEATURE(S) FROM BYDA/GIS HELD AS UNVERIFIED IN THE RUN FILE: NOT DRAWN")
    lines.append("LOCATION OF ANY SERVICE TO BE CONFIRMED BY POTHOLING")
    return BydaPanel(head, lines, state, by.job_no, by.responded, by.total, len(by.gis_features))


# ---------------------------------------------------------------------------------------------------------------- run JSON and sources table
def sources_rows(sd: SiteData, comparison: dict | None, boundary_used: bool, boundary_label: str | None, terrain_used: bool, notes: list[str] | None = None,
                 run_date: dt.date | None = None) -> list[dict]:
    """The "Site data sources" table: one row per item with file, date, accuracy and status for THIS run (USED, NOT USED, MISSING, DRAFT)."""
    rows: list[SourceItem] = []
    for it in sd.items:
        c = SourceItem(**it.as_dict())
        if c.item == "Lot boundary":
            if not boundary_used:
                c.status = NOT_USED
                c.note += "; SA1 cadastre lot used as the subject lot"
            elif comparison and comparison.get("flag"):
                c.status = FLAG
            if comparison:
                c.note += (f"; SA1 lot area {comparison['sa1_area_m2']:,.0f} m2 against collector {comparison['collector_area_m2']:,.0f} m2 "
                           f"({comparison['difference_pct']:+.2f} percent)" + ("; DIFFERENCE OVER 2 PERCENT, CHECK BOTH" if comparison["flag"] else ""))
        if c.item in ("LiDAR levels (spot levels, TIN)",) and not terrain_used and c.status == "USED":
            c.status = NOT_USED
            c.note += "; not used in this run"
        rows.append(c)
    if run_date is not None:
        rows.append(SourceItem("Run date", "", dataset="DATE OF THIS RUN", date=ddmmyyyy(run_date), accuracy="NOT APPLICABLE", crs="NOT APPLICABLE", status="INFORMATION"))
    return [r.as_dict() for r in rows]


def run_record(sd: SiteData, *, run_date: dt.date, comparison: dict | None, boundary_used: bool, thin: dict | None, panel: BydaPanel | None,
               fall_check: dict | None, rows: list[dict]) -> dict:
    """JSON stored in run_steps.json facts["site_data"].  BYDA draft features are stored here (unverified) for the future verification step and are
    never given to any drawing."""
    b, ld, by = sd.boundary, sd.lidar, sd.byda
    return {
        "folder": sd.root, "run_date": ddmmyyyy(run_date), "missing": list(sd.missing), "warnings": list(sd.warnings),
        "boundary": ({"label": b.source_label, "name": b.name, "lotplan": b.lotplan, "srid": b.srid, "stated_area_ha": b.stated_area_ha,
                      "computed_area_ha": round(b.computed_area_ha, 4), "difference_pct": None if b.area_diff_pct is None else round(b.area_diff_pct, 3),
                      "area_flag": b.area_flag, "csv_max_diff_m": b.csv_max_diff_m, "used_as_subject_lot": boundary_used, "comparison_with_sa1": comparison} if b else None),
        "lidar": ({"label": sd.terrain_label, "dataset": ld.status.dataset if ld.status else None, "capture_year": ld.status.capture_year if ld.status else None,
                   "vertical_accuracy_m": sd.vertical_accuracy_m, "accuracy_text": ld.status.accuracy_text if ld.status else None,
                   "crs": ld.status.crs if ld.status else None, "vertical_datum": ld.status.vertical_datum if ld.status else None,
                   "received": ld.status.received if ld.status else None, "order_ref": ld.status.order_ref if ld.status else None,
                   "collector_stats": ld.status.stats if ld.status else {}, "points_file": ld.points_file, "points_read": int(len(ld.points)) if ld.has_points else 0,
                   "thinning": thin, "contours_file": ld.contours_file, "contour_interval_m": ld.interval_m, "major_interval_m": ld.major_interval_m,
                   "contour_lines": len(ld.contours or []), "fall_check": fall_check} if ld else None),
        "byda": ({"job_no": by.job_no, "enquiry_no": by.enquiry_no, "lodged": by.lodged, "job_from": ddmmyyyy(by.job_from), "job_to": ddmmyyyy(by.job_to),
                  "valid_until": ddmmyyyy(by.valid_until), "validity_state": panel.validity_state if panel else None,
                  "owners": [{"name": o.name, "status": o.status, "responded": o.responded} for o in by.owners], "responded": by.responded, "total": by.total,
                  "project_only": by.project_only, "plan_files_listed_only": {k: len(v) for k, v in by.plan_files.items()},
                  "panel": panel.as_dict() if panel else None,
                  "draft_features": [{"id": f.feature_id, "file": f.source_file, "owner": f.owner, "status": "draft", "verified": False, "geometry_wkt": f.geometry_wkt,
                                      "properties": f.properties, "drawn": False} for f in by.gis_features]} if by else None),
        "sources": rows,
    }
