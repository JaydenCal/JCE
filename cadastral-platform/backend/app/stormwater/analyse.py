"""The stormwater helper (stage 9): one call that builds the catchments, finds the design rainfall, sizes the OSD, checks infiltration trenches and, when asked, computes overland flow.

The server is authoritative: the browser sends its current design document and its entries, and shows what comes back. Nothing is invented. Every value carries its basis; every
missing input is listed with the requirement key (if any) and how to supply it; a calculation that lacks an input is NOT EVALUATED and says so.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from app.design import engine_limits as EL
from app.design.site_design import SiteDesign
from app.design.site_rules import SiteRules
from app.design.terrain_source import SiteTerrain

from . import catchment as CA
from . import infiltration as INF
from . import osd as OSD
from . import overland as OVL
from .catchment import val
from .inputs import USER_REF, OverlandOptions, StormwaterInputs
from .rainfall import IfdClient, IfdResult, LiveBomProvider, UploadedIfdProvider, location_check

SCHEMA = "stormwater.v1"
COVER_LABEL = "PRE AND POST COVER DIFFERENT AREAS"
UNCLASSIFIED_TOL_M2 = CA.OVERLAP_TOL_M2
STORAGE_TYPES = ("osd", "osd_basin")


def site_lonlat(terrain: SiteTerrain | None) -> dict[str, float] | None:
    """The centre of the lot in WGS84, or None when the model has no lot or does not state its coordinate system."""
    if terrain is None or terrain.lot is None or terrain.srid is None:
        return None
    try:
        from pyproj import Transformer
        c = terrain.lot.centroid
        lon, lat = Transformer.from_crs(terrain.srid, 4326, always_xy=True).transform(c.x, c.y)
    except Exception:  # noqa: BLE001  (an unknown EPSG code is reported as "location not known")
        return None
    return {"lat": round(lat, 6), "lon": round(lon, 6)} if math.isfinite(lat) and math.isfinite(lon) else None


def peak_flows(cmp: dict[str, Any], ifd: IfdResult, aep_v: dict[str, Any], tc_pre: dict[str, Any], tc_post: dict[str, Any]) -> dict[str, Any]:
    """Peak flow by the rational method for each phase: Q = sum(C x A) x I(Tc) / 3.6e6 (m3/s), I read from the design rainfall table at the time of concentration."""
    missing: list[dict[str, Any]] = []
    out: dict[str, Any] = {"formula": "Q = sum(C x A) x I / 3.6e6   (Q m3/s, C x A m2, I mm/h, I at the duration Tc)", "phases": [], "missing": missing, "status": "NOT EVALUATED", "message": "",
                           "comparison_label": "", "comparison_note": ""}
    # the pre and post conditions are comparable only when both cover the same area: lot area that no drawn surface covers (UNCLASSIFIED) has no runoff behaviour in either total
    if cmp["pre_status"] == "OK":
        gaps = [(key, label, u["unclassified_m2"]) for key, label, u in (("pre", "PRE DEVELOPMENT", cmp["pre_unclassified"]), ("post", "POST DEVELOPMENT", cmp["post_unclassified"]))
                if u.get("status") == "OK" and (u.get("unclassified_m2") or 0.0) > UNCLASSIFIED_TOL_M2]
        if gaps:
            out["comparison_label"] = COVER_LABEL
            out["comparison_note"] = "; ".join(f"{label}: {m2:.1f} M2 OF THE LOT HAS NO SURFACE OBJECT" for _, label, m2 in gaps) + ". THE TOTALS DO NOT COVER THE SAME AREA, SO THE PEAK FLOWS ARE NOT LIKE FOR LIKE"
            for key, label, m2 in gaps:
                missing.append({"id": f"unclassified_{key}", "area": "PEAK FLOW", "what": f"{label}: {m2:.1f} M2 OF THE LOT IS UNCLASSIFIED (NO SURFACE OBJECT). {COVER_LABEL}", "key": None,
                                "how": "Draw and classify surfaces over the whole lot for both conditions (mark existing surfaces as existing or to be removed) so the pre and post development totals cover the same area."})
    if aep_v["value"] is None:
        missing.append({"id": "aep", "area": "PEAK FLOW", "what": "THE DESIGN AEP IS UNRESOLVED", "key": "stormwater.design_aep_pct", "how": aep_v["how"]})
    if ifd.table is None:
        missing.append({"id": "ifd", "area": "PEAK FLOW", "what": "DESIGN RAINFALL IS NOT AVAILABLE: " + (ifd.message or ifd.status), "key": None, "how": "Upload the IFD table CSV exported from the BoM IFD page."})
    elif aep_v["value"] is not None and ifd.table.aep_index(aep_v["value"]) is None:
        missing.append({"id": "aep_column", "area": "PEAK FLOW", "what": f"THE RAINFALL TABLE HAS NO COLUMN FOR AEP {aep_v['value']:g} PERCENT", "key": None, "how": "Choose a design AEP that is a column of the table."})
    common_ok = aep_v["value"] is not None and ifd.table is not None and ifd.table.aep_index(aep_v["value"]) is not None
    done = 0
    for phase, label, tc, tkey in (("pre", "PRE DEVELOPMENT", tc_pre, "stormwater.tc_pre_min"), ("post", "POST DEVELOPMENT", tc_post, "stormwater.tc_post_min")):
        t = cmp[phase]
        row: dict[str, Any] = {"phase": phase, "label": label, "status": "NOT EVALUATED", "tc": tc, "ca_m2": t.get("ca_m2") if t.get("complete") else None, "q_l_s": None, "text": "", "why": []}
        if phase == "pre" and cmp["pre_status"] != "OK":
            row["why"].append("THE PRE DEVELOPMENT SURFACES ARE NOT SET")
        elif not t.get("complete"):
            row["why"].append("THE CATCHMENT IS INCOMPLETE (A SURFACE HAS NO AREA OR NO RUNOFF COEFFICIENT)")
        if tc["value"] is None:
            row["why"].append(f"THE {label} TIME OF CONCENTRATION IS UNRESOLVED")
            missing.append({"id": f"tc_{phase}", "area": "PEAK FLOW", "what": f"THE {label} TIME OF CONCENTRATION IS UNRESOLVED", "key": tkey, "how": tc["how"]})
        if not row["why"] and common_ok:
            got = ifd.table.intensity(tc["value"], aep_v["value"]) if ifd.table else None
            if got is None:
                row["why"].append(f"TC {tc['value']:g} MIN IS OUTSIDE THE DURATIONS OF THE RAINFALL TABLE")
                missing.append({"id": f"tc_range_{phase}", "area": "PEAK FLOW", "what": row["why"][0], "key": None, "how": "Check the time of concentration or upload a table that covers it."})
            else:
                inten, how = got
                q = t["ca_m2"] * inten / 3.6e6
                row.update(status="EVALUATED", intensity_mm_h=round(inten, 4), intensity_method=how, q_l_s=round(q * 1000.0, 4),
                           text=f"Q = {t['ca_m2']:.4f} x {inten:.3f} / 3.6e6 = {q:.6f} m3/s = {q * 1000:.3f} L/s")
                done += 1
        out["phases"].append(row)
    out["status"] = "EVALUATED" if done == 2 else "PARTLY EVALUATED" if done else "NOT EVALUATED"
    if done < 2:
        out["message"] = "NOT EVALUATED FOR " + ", ".join(p["label"] for p in out["phases"] if p["status"] != "EVALUATED") + ": " + "; ".join(w for p in out["phases"] for w in p["why"])[:500]
    return out


def analyse(design: SiteDesign, rules: SiteRules, terrain: SiteTerrain | None, inputs: StormwaterInputs, *, ifd_stored: dict[str, Any] | None = None, soil_stored: dict[str, Any] | None = None,
            arr_stored: dict[str, Any] | None = None, rainfall_source: str = "upload", live_client: IfdClient | None = None, overland: OverlandOptions | None = None,
            now: datetime | None = None) -> dict[str, Any]:
    EL.check_site_design(design)
    lot = terrain.lot if terrain is not None else None
    cat = CA.build(design, rules, lot, inputs)
    c = cat.pop("_catchments")
    rd = c.rd
    live = [o for o in c.objs if o.status != "to_be_removed"]
    osds = [o for o in live if o.type in STORAGE_TYPES]
    rwts = [o for o in live if o.type == "rwt"]
    trenches = [o for o in live if o.type == "infiltration_trench"]
    # ---- design rainfall
    site = site_lonlat(terrain)
    if rainfall_source == "live":
        ifd = LiveBomProvider(live_client, now=now).design_rainfall(site["lat"] if site else None, site["lon"] if site else None)
    else:
        ifd = UploadedIfdProvider(ifd_stored).design_rainfall(site["lat"] if site else None, site["lon"] if site else None)
    rain: dict[str, Any] = {"status": ifd.status, "message": ifd.message, "source": ifd.source, "site": site, "table": None, "location": None, "arr": None}
    if ifd.table is not None:
        rain["table"] = ifd.table.summary()
        rain["location"] = location_check(ifd.table, site)
    if arr_stored:
        rain["arr"] = {k: arr_stored.get(k) for k in ("location", "storm_initial_loss_mm", "storm_continuing_loss_mm_h", "impervious_initial_loss_mm", "impervious_continuing_loss_mm_h",
                                                         "time_accessed", "data_version", "provenance")}
    # ---- sizing and checks
    cmp = cat["comparison"]
    aep_v = (val(inputs.design_aep_pct, "%", "USER", USER_REF, key="stormwater.design_aep_pct") if inputs.design_aep_pct is not None
             else OSD.from_rule(rules, "stormwater.design_aep_pct", "%", "Enter the design AEP in the panel, or load the requirement key stormwater.design_aep_pct for the LGA."))
    tc_pre = (val(inputs.tc_pre_min, "min", "USER", USER_REF, key="stormwater.tc_pre_min") if inputs.tc_pre_min is not None
              else OSD.from_rule(rules, "stormwater.tc_pre_min", "min", "Enter the pre development time of concentration in the panel, or load the requirement key stormwater.tc_pre_min."))
    tc_post = (val(inputs.tc_post_min, "min", "USER", USER_REF, key="stormwater.tc_post_min") if inputs.tc_post_min is not None
               else OSD.from_rule(rules, "stormwater.tc_post_min", "min", "Enter the post development time of concentration in the panel, or load the requirement key stormwater.tc_post_min."))
    peaks = peak_flows(cmp, ifd, aep_v, tc_pre, tc_post)
    lot_area = cmp["post_unclassified"].get("lot_area_m2")
    un = cmp["post_unclassified"].get("unclassified_m2")
    osd = OSD.run(rules=rules, rd=rd, inputs=inputs, osds=osds, rwts=rwts, post_rows=cat["post_rows"], unclassified_m2=un, lot_area_m2=lot_area, ifd=ifd,
                  rainfall_source=ifd.source, objs_by_id=c.by_id)
    inf = INF.run(rules=rules, rd=rd, inputs=inputs, trenches=trenches, soil=soil_stored)
    ovl = None
    if overland is not None and overland.enabled:
        ovl = OVL.analyse(design, terrain, lot, rd, cell_m=overland.cell_m, threshold_m2=overland.threshold_m2, surface=overland.surface)
    # ---- the combined list of what is missing (each item says how to supply it)
    missing: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    sources = [cat["missing"], peaks["missing"], osd["missing"], (osd.get("orifice") or {}).get("missing") or [], inf["missing"], (ovl or {}).get("missing") or []]
    for lst in sources:
        for m in lst:
            k = (m["area"], m["id"])
            if k not in seen:
                seen.add(k)
                missing.append(m)
    notes = list(cat["notes"]) + [n for n in osd["notes"] if n not in cat["notes"]]
    return {"schema": SCHEMA, "generated_at": (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec="seconds"),
            "terrain_status": terrain.status if terrain else "NO TERRAIN", "lot_area_m2": lot_area,
            "catchment": {"rows": cat["rows"], "post_rows": cat["post_rows"], "comparison": cmp, "routing": CA.routing_view(cat["post_rows"], c.by_id), "discharge_points": cat["discharge_points"]},
            "rainfall": rain, "peak_flows": peaks, "osd": osd, "infiltration": inf, "overland": ovl, "missing": missing, "notes": notes}
