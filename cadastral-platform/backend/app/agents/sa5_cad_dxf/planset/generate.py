"""Entry point: build the multi-sheet civil plan set (PDF + DXF)."""
from __future__ import annotations

import datetime as dt
from pathlib import Path

from shapely.geometry import box

from app.agents.sa5_cad_dxf.planset import contours as K
from app.agents.sa5_cad_dxf.planset import fonts, sheets_other as SO, sheets_plan as SP
from app.agents.sa5_cad_dxf.planset.data import Aerial, PlansetInput, Site, build_site, contour_sets
from app.agents.sa5_cad_dxf.planset.render_dxf import render_dxf
from app.agents.sa5_cad_dxf.planset.render_pdf import render_pdf
from app.agents.sa5_cad_dxf.planset.titleblock import Proj, draw_frame


def _aerial(inp: PlansetInput, ext, out_dir: Path, name: str, long_px: int = 1800) -> Aerial | None:
    if inp.imagery is None:
        return None
    try:
        w, h = ext[2] - ext[0], ext[3] - ext[1]
        size = (long_px, max(64, int(long_px * h / w))) if w >= h else (max(64, int(long_px * w / h)), long_px)
        r = inp.imagery.fetch(tuple(ext), inp.lot.mga_srid, size)
        p = out_dir / name
        p.write_bytes(r.data)
        m = r.meta
        return Aerial(str(p), tuple(ext), f"Aerial imagery: {m.attribution or m.source}, {m.capture_date or 'date unavailable'}; verify terms before commercial use")
    except Exception as ex:  # noqa: BLE001
        print(f"aerial fetch failed: {type(ex).__name__}: {ex}")
        return None


def build_planset(inp: PlansetInput, out_dir: str | Path, stem: str = "planset") -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    fi = fonts.info()
    site = build_site(inp)
    scale, centre = SP.plan_window(site)
    from app.agents.sa5_cad_dxf.planset.core import View
    win_v = View("w", SP.MAIN, centre, scale)
    wnd = win_v.model_window()
    contour_sets(site, wnd)
    site.window = wnd
    site.aerial_site = _aerial(inp, wnd, out, f"{stem}_aerial_site.png")
    lb = site.lot.bounds
    cx, cy = (lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2
    span = max(lb[2] - lb[0], lb[3] - lb[1], 200) * 0.75
    site.aerial_loc = _aerial(inp, (cx - span * 1.05, cy - span * 0.9, cx + span * 1.05, cy + span * 0.9), out, f"{stem}_aerial_locality.png", 1400)
    if inp.esc_output is not None:
        site.esc = inp.esc_output
    elif inp.esc_runner is not None:
        try:
            site.esc = inp.esc_runner(site)
        except Exception as ex:  # noqa: BLE001
            print(f"ESC layout unavailable: {type(ex).__name__}: {ex}")
    ks, kc = SP.key_window(site, win_v.window_poly())
    b = inp.brand
    if b is None:
        from app.branding.brand import Brand
        b = Brand.from_env()
    date = inp.issue_date or dt.date.today().isoformat()
    lot = inp.lot
    proj = Proj(inp.project_title, inp.address or ("" if not lot.lga_name else lot.lga_name), lot.lotplan.replace("//", " ").replace("/", " "),
                (inp.council_name or lot.lga_name or "").upper(), site.zone, f"{lot.area_m2_calculated:,.0f} m2", site.dev_label.title(), inp.drawn_by, "", date, b,
                ["Horizontal: GDA2020 MGA zone " + str(lot.mga_srid)[-2:] + " (EPSG:" + str(lot.mga_srid) + ")", "Vertical: AHD; DEM-derived, indicative only", "Units: metres. Not a survey."],
                [("A", "PRELIMINARY ISSUE", date, inp.drawn_by[:6])])
    ctx = SP.Ctx(site, proj, scale, centre, kc, ks)
    body = [SP.c100(ctx), SP.c101(ctx), SP.c200(ctx), SP.c300(ctx), SP.c310(ctx), SO.c400(ctx), SO.c410(ctx), SO.c420(ctx), SO.c500(ctx), SO.c600(ctx)]
    c700 = SO.c700(ctx, body)
    c000 = SO.c000(ctx, body + [c700], fi.note)
    sheets = [c000] + body + [c700]
    pages = []
    n = len(sheets)
    for i, sh in enumerate(sheets, 1):
        fr = draw_frame(sh, proj, i, n, sh.scale_text or "AS SHOWN")
        pages.append((sh, [v for v in sh.views] + [fr]))
    pdf, dxf = out / f"{stem}.pdf", out / f"{stem}.dxf"
    render_pdf(pages, pdf, inp.project_title + " - civil plan set")
    st = render_dxf(pages, dxf)
    return {"pdf": str(pdf), "dxf": str(dxf), "sheets": [(s.number, s.title, s.data_missing) for s in sheets], "font": fi.note, "dxf_stats": st,
            "notes": site.notes, "missing": site.missing}
