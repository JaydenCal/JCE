"""Sheet text taken ONLY from cited requirements (quotes) plus the maintenance schedule built from cited items."""
from __future__ import annotations

from .reqs import ReqView

NOTE_KEYS = [
    "esc.escp.prepared_by_suitably_qualified_person", "esc.sediment_fence.along_contour", "esc.sediment_fence.ends_turn_upslope",
    "esc.sediment_fence.return_interval_m", "esc.sediment_fence.trench_depth_mm", "esc.sediment_fence.post_spacing_m",
    "esc.sediment_fence.not_across_drainage_line", "esc.sediment_fence.no_material_against_fence", "esc.access.min_length_m",
    "esc.access.min_length_building_sites_m", "esc.access.divert_surface_water", "esc.stockpile.within_site_behind_sediment_controls",
    "esc.stockpile.preferred_distance_from_hazard_m", "esc.stockpile.max_height_m", "esc.stockpile.cover_when_unattended",
    "esc.diversion.no_discharge_to_neighbour_without_consent", "esc.inlet.protect_downslope_drains_and_gutters", "esc.washout.bunded",
    "esc.washout.buffer_around_largest_equipment_m", "esc.topsoil.strip_depth_min_mm", "esc.waste.bin_clearance_interval",
    "esc.stabilisation.remove_temporary_controls_after_stabilised", "esc.removal.controls_remain_until_revegetation_pct",
]

MAINT = [  # (item, key) -> (frequency / trigger text comes from the cited quote)
    ("Designated person checks all controls", "esc.inspection.designated_person_daily"),
    ("Check controls after rain / wind", "esc.inspection.after_rainfall_event"),
    ("Self-audit (check sheet): frequency", "esc.inspection.min_frequency"),
    ("Stockpiles: check and cover", "esc.inspection.stockpiles_covered_end_of_day"),
    ("Sweep road / footpath", "esc.inspection.sweep_road_footpath_daily"),
    ("Sediment fence: repair", "esc.maintenance.replace_damaged_sediment_fence"),
    ("Remove trapped sediment", "esc.maintenance.remove_collected_sediment"),
    ("Sediment capacity limit", "esc.maintenance.sediment_removal_capacity_loss_pct"),
    ("Stabilised access: top up aggregate", "esc.maintenance.access_top_up_when_worn"),
    ("Waste bins", "esc.waste.bin_clearance_interval"),
    ("Keep spare materials on site", "esc.inspection.keep_spare_materials_on_site"),
    ("Remove temporary controls", "esc.stabilisation.remove_temporary_controls_after_stabilised"),
]


def trim(q: str, n: int = 150) -> str:
    q = " ".join(q.split())
    if len(q) <= n:
        return q
    cut = q[:n].rsplit(" ", 1)[0]
    return cut + " ..."


def general_notes(rq: ReqView) -> list[str]:
    out, seen = [], set()
    for k in NOTE_KEYS:
        r = rq.used.get(k) or rq.get(k)
        if r is None or r.req.source is None:
            continue
        q = trim(r.req.source.quote)
        if q in seen:
            continue
        seen.add(q)
        out.append(f"\"{q}\" [{r.tag}]")
    return out


def maintenance_rows(rq: ReqView) -> list[tuple[str, str, str]]:
    rows = []
    for item, k in MAINT:
        r = rq.used.get(k) or rq.get(k)
        if r is None or r.req.source is None:
            rows.append((item, "UNRESOLVED - to be confirmed by the designer/certifier", ""))
            continue
        rows.append((item, f"\"{trim(r.req.source.quote, 110)}\"", r.tag))
    return rows
