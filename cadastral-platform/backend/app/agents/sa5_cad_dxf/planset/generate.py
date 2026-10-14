"""Entry point: build the multi-sheet civil plan set (PDF + DXF)."""
from __future__ import annotations

import datetime as dt
import re
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
        r = None
        for k in (1.0, 0.6, 0.35):
            try:
                sz = (max(64, int(size[0] * k)), max(64, int(size[1] * k)))
                r = inp.imagery.fetch(tuple(ext), inp.lot.mga_srid, sz)
                break
            except Exception as ex:  # noqa: BLE001
                err = ex
        if r is None:
            raise err
        p = out_dir / name
        p.write_bytes(r.data)
        m = r.meta
        return Aerial(str(p), tuple(ext), f"Aerial imagery: {m.attribution or m.source}, {m.capture_date or 'date unavailable'}; verify terms before commercial use")
    except Exception as ex:  # noqa: BLE001
        print(f"aerial fetch failed: {type(ex).__name__}: {ex}")
        return None


def build_planset(inp: PlansetInput, out_dir: str | Path, stem: str = "planset", *, style: str = "legacy", only=None) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    fi = fonts.info()
    import time as _t; _t0 = _t.time()
    print('planset: building site (local DEM)...', flush=True)
    site = build_site(inp)
    print(f'planset: site built {_t.time()-_t0:.0f}s', flush=True)
    if style == "ref":
        return _build_ref(inp, site, out, stem, only, fi)
    if style != "legacy":
        raise ValueError(f"unknown plan set style {style!r} (legacy or ref)")
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
    print(f'planset: aerial site {_t.time()-_t0:.0f}s', flush=True)
    site.aerial_loc = _aerial(inp, (cx - span * 1.05, cy - span * 0.9, cx + span * 1.05, cy + span * 0.9), out, f"{stem}_aerial_locality.png", 1400)
    if inp.esc_output is not None:
        site.esc = inp.esc_output
    elif inp.esc_runner is not None:
        try:
            site.esc = inp.esc_runner(site)
        except Exception as ex:  # noqa: BLE001
            print(f"ESC layout unavailable: {type(ex).__name__}: {ex}")
    print(f'planset: aerial loc {_t.time()-_t0:.0f}s', flush=True)
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
    if only:
        sheets = [x for x in sheets if x.number in {n.strip().upper() for n in only}]
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


def project_name(title: str, lotplan: str, address: str = "") -> str:
    """The drawing project name: a supplied title is kept, but a raw run label ("Test run: 2//DP227508") or an empty title is replaced by
    "LOT n DPnnnnnn SITE WORKS" (or the address) so the cover and every title block read as a project, never as a lot key."""
    t = (title or "").strip()
    raw = (not t) or t.lower().startswith("test run") or "//" in t
    if not raw:
        return t
    m = re.match(r"^\s*(\w+)\s*(?://|/)\s*(\S+)\s*$", lotplan or "")
    if address and address.strip():
        return f"{address.strip()} SITE WORKS"
    return f"LOT {m.group(1)} {m.group(2)} SITE WORKS".upper() if m else "SITE WORKS"


def _proj(inp: PlansetInput, site: Site, b, date: str) -> Proj:
    lot = inp.lot
    return Proj(project_name(inp.project_title, lot.lotplan, inp.address or ""), inp.address or ("" if not lot.lga_name else lot.lga_name), lot.lotplan.replace("//", " ").replace("/", " "),
                (inp.council_name or lot.lga_name or "").upper(), site.zone, f"{lot.area_m2_calculated:,.0f} m2", site.dev_label.title(), inp.drawn_by, "", date, b,
                ["Horizontal: GDA2020 MGA zone " + str(lot.mga_srid)[-2:] + " (EPSG:" + str(lot.mga_srid) + ")", "Vertical: AHD; DEM-derived, indicative only", "Units: metres. Not a survey."],
                [("A", "PRELIMINARY ISSUE", date, inp.drawn_by[:6])], inp.client, getattr(inp, "job", "") or "")


LAST_SHEETS: dict = {}
LAST_PROJ = None
LAST_SITE = None


def _build_ref(inp: PlansetInput, site: Site, out: Path, stem: str, only, fi) -> dict:
    """Reference-style (A1) sheets.  Stage 1 builds C101 only; no contours or aerial are fetched."""
    from app.agents.sa5_cad_dxf.planset import sheets_ref as SR
    from app.agents.sa5_cad_dxf.planset.frame_a1 import draw_frame_a1
    b = inp.brand
    if b is None:
        from app.branding.brand import Brand
        b = Brand.from_env()
    from app.agents.sa5_cad_dxf.planset import codes
    pb = codes.PLATFORM_BRAND                       # JCESITE is not the JCE Brand: never read the JCE Brand for the ref style
    proj = _proj(inp, site, pb, inp.issue_date or dt.date.today().isoformat())
    if inp.drawn_by in ("JCE", "JCESITE"):                       # the JCE company code is the legacy default; the platform code replaces it
        proj.drawn = pb.drawn_code
        proj.revisions = [(r, d, dt_, pb.rev_code) for r, d, dt_, _by in proj.revisions]
    from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
    order = list(codes.SHEET_NNN)                   # C000 cover, C001 general notes (sheet 2), then the drawing sheets
    names = [codes.SHEET_ALIAS.get(n.strip().upper(), n.strip().upper()) for n in (only or order) if n and n.strip()]
    bad = [n for n in names if n not in order]
    if bad:
        raise ValueError(f"reference style has no builder for {', '.join(bad)} (available: {', '.join(order)})")
    ctx = SR.RefCtx(site, proj)
    if inp.imagery is not None and site.aerial_site is None:         # faded aerial underlay behind every plan sheet when imagery is supplied
        lb = site.lot.bounds
        pad = max(max(lb[2] - lb[0], lb[3] - lb[1], 40.0) * 0.6, 100.0)
        site.aerial_site = _aerial(inp, (lb[0] - pad, lb[1] - pad, lb[2] + pad, lb[3] + pad), out, f"{stem}_aerial_site.png")
    if site.esc is None:                                             # SA10 erosion and sediment control layout for C500 (never invented here)
        if inp.esc_output is not None:
            site.esc = inp.esc_output
        elif inp.esc_runner is not None:
            try:
                site.esc = inp.esc_runner(site)
            except Exception as ex:  # noqa: BLE001
                site.esc_error = f"{type(ex).__name__}: {ex}"
                print(f"ESC layout unavailable: {site.esc_error}")
    built = {"C100": S2.c100(ctx), "C101": S2.c101(ctx), "C200": S2.c200(ctx), "C300": S2.c300(ctx), "C310": S2.c310(ctx), "C400": S2.c400(ctx),
             "C410": S2.c410(ctx), "C420": S2.c420(ctx), "C500": S2.c500(ctx), "C600": S2.c600(ctx)}
    body = [built[n] for n in order if n in built]
    built["C001"] = S2.c001(ctx, body)
    built["C000"] = S2.c000(ctx, [built["C001"]] + body, fi.note)
    sheets = [built[n] for n in order if n in names]
    global LAST_SHEETS, LAST_PROJ, LAST_SITE
    LAST_SHEETS = {sh.number: sh for sh in sheets}
    LAST_SITE = site
    LAST_PROJ = proj          # for tests that audit the real run
    pages = []
    for i, sh in enumerate(sheets, 1):
        pages.append((sh, list(sh.views) + [draw_frame_a1(sh, proj, i, len(sheets), sh.scale_text or "AS SHOWN")]))
    codes.apply_layer_scheme(pages)                 # JCS-{DISC}-{ELEMENT}-{TYPE}; ref style only, legacy layer names are untouched
    pdf, dxf = out / f"{stem}.pdf", out / f"{stem}.dxf"
    render_pdf(pages, pdf, proj.title + " - civil plan set (reference style)", pb.name)
    st = render_dxf(pages, dxf)
    return {"pdf": str(pdf), "dxf": str(dxf), "sheets": [(s.number, s.title, s.data_missing) for s in sheets], "font": fi.note, "dxf_stats": st,
            "notes": site.notes, "missing": site.missing}
