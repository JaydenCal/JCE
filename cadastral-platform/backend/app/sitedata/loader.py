"""Read a site data folder (docs/14-site-data-import.md).  Reads whatever exists, never fails on a missing or malformed optional file, and records the
provenance of every item plus a list of what is missing.  Nothing is copied, redistributed or sent anywhere.  BYDA plan PDFs are only listed by name."""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import transform as shp_transform
from shapely.validation import explain_validity

from app.sitedata import mdparse as MD
from app.sitedata.models import (AREA_TOLERANCE, DRAFT, FLAG, MISSING, NOT_USED, USED, BoundaryData, BydaData, ContourLine, DraftFeature, LidarData, SiteData,
                                 SourceItem)

LOT_ID = re.compile(r"\bLot\s+(\w+)\s*,?\s*(DP|SP|CP|BUP|SL|PS|GTP)\s*(\d{1,7})\b", re.I)


def find_ci(root: Path, *parts: str) -> Path | None:
    """Case-insensitive path lookup under ``root`` (the collector writes LiDAR/ and BYDA/ but a copy may change the case)."""
    cur = root
    for part in parts:
        if not cur.is_dir():
            return None
        hit = next((c for c in sorted(cur.iterdir()) if c.name.lower() == part.lower()), None)
        if hit is None:
            return None
        cur = hit
    return cur


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def srid_for_zone(zone: int) -> int | None:
    return 7800 + zone if 54 <= zone <= 56 else None


def srid_for_lon(lon: float) -> int | None:
    return 7854 if 138.0 <= lon < 144.0 else 7855 if 144.0 <= lon < 150.0 else 7856 if 150.0 <= lon < 156.0 else None


def _big(g):
    if isinstance(g, MultiPolygon):
        return max(g.geoms, key=lambda p: p.area)
    return g


# ---------------------------------------------------------------------------------------------------------------- boundary
def load_boundary(root: Path, sd: SiteData, srid_hint: int | None = None) -> BoundaryData | None:
    gj_path = find_ci(root, "lot_boundary.geojson")
    csv_path = find_ci(root, "lot_boundary_mga.csv")
    poly = srid = None
    name, stated = "", None
    src = ""
    notes: list[str] = []
    if gj_path is not None:
        try:
            gj = json.loads(_read(gj_path))
            feats = gj.get("features") if gj.get("type") == "FeatureCollection" else [gj] if gj.get("type") == "Feature" else [{"type": "Feature", "properties": {}, "geometry": gj}]
            cand = [(f.get("properties") or {}, shape(f["geometry"])) for f in feats if f.get("geometry") and f["geometry"].get("type") in ("Polygon", "MultiPolygon")]
            if not cand:
                raise ValueError("no Polygon feature")
            props, g = max(cand, key=lambda t: t[1].area)
            g = _big(g)
            name = str(props.get("name") or props.get("lot") or "").strip()
            for k in ("area_ha", "area_hectares", "AREA_HA"):
                if props.get(k) not in (None, ""):
                    try:
                        stated = float(props[k])
                    except (TypeError, ValueError):
                        notes.append(f"stated area {props[k]!r} is not a number")
                    break
            x0, y0 = g.exterior.coords[0][:2]
            if abs(x0) > 360:                                        # projected (already MGA metres)
                srid = srid_hint or (srid_for_zone(int(m.group(1))) if (m := re.search(r"mga\D*(\d{2})", json.dumps(gj.get("crs", "")), re.I)) else None)
                poly = g
            else:
                srid = srid_for_lon(x0)
                if srid is None:
                    raise ValueError(f"longitude {x0} outside MGA zones 54 to 56")
                t = Transformer.from_crs(7844, srid, always_xy=True)
                poly = shp_transform(t.transform, g)
            src = gj_path.name
        except Exception as ex:  # noqa: BLE001 - a bad optional file is reported, never fatal
            sd.warnings.append(f"lot_boundary.geojson not read ({type(ex).__name__}: {ex})")
            sd.items.append(SourceItem("Lot boundary", gj_path.name, status=NOT_USED, note=f"not readable: {type(ex).__name__}"))
    if poly is None and csv_path is not None:
        try:
            rows = _csv_rows(csv_path)
            zone = re.search(r"mga\D*(\d{2})", _read(csv_path).split("\n")[0], re.I)
            srid = srid_for_zone(int(zone.group(1))) if zone else srid_hint
            if srid is None or len(rows) < 3:
                raise ValueError("fewer than 3 vertices or MGA zone not stated")
            poly = Polygon([(r[0], r[1]) for r in rows])
            src = csv_path.name
            notes.append("boundary built from the MGA vertex CSV (no GeoJSON)")
        except Exception as ex:  # noqa: BLE001
            sd.warnings.append(f"lot_boundary_mga.csv not read ({type(ex).__name__}: {ex})")
    if poly is None:
        sd.missing.append("lot boundary (lot_boundary.geojson / lot_boundary_mga.csv)")
        sd.items.append(SourceItem("Lot boundary", "", status=MISSING, note="no readable boundary file"))
        return None
    if not poly.is_valid:                                            # never repaired (as SA1)
        sd.warnings.append(f"collector boundary is not a valid polygon ({explain_validity(poly)}); NOT USED")
        sd.items.append(SourceItem("Lot boundary", src, status=NOT_USED, note=f"invalid geometry: {explain_validity(poly)}"))
        return None
    comp = poly.area / 10000.0
    diff = (comp - stated) / stated * 100.0 if stated else None
    flag = bool(stated) and abs(comp - stated) / stated > AREA_TOLERANCE
    m = LOT_ID.search(name)
    lotplan = f"{m.group(1)}//{m.group(2).upper()}{m.group(3)}" if m else None
    b = BoundaryData(name=name or "UNNAMED LOT", polygon=poly, srid=srid, lotplan=lotplan, stated_area_ha=stated, computed_area_ha=comp, area_diff_pct=diff,
                     area_flag=flag, source_file=src, notes=notes)
    if csv_path is not None and src == "lot_boundary.geojson":
        try:
            rows = _csv_rows(csv_path)
            if rows:
                vs = np.array(poly.exterior.coords)[:, :2]
                b.csv_file = csv_path.name
                b.csv_max_diff_m = float(max(np.min(np.hypot(vs[:, 0] - r[0], vs[:, 1] - r[1])) for r in rows))
                b.csv_note = ("MGA vertex CSV agrees with the GeoJSON boundary" if b.csv_max_diff_m <= 0.5
                              else f"MGA vertex CSV differs from the GeoJSON boundary by up to {b.csv_max_diff_m:.2f} m: CHECK")
                if b.csv_max_diff_m > 0.5:
                    sd.warnings.append(b.csv_note)
        except Exception as ex:  # noqa: BLE001
            b.csv_note = f"MGA vertex CSV not compared ({type(ex).__name__})"
    area_txt = f"computed {comp:.2f} ha" + (f" against stated {stated:.2f} ha ({diff:+.2f} percent)" if stated else ", stated area not supplied")
    sd.items.append(SourceItem("Lot boundary", src + (f" + {b.csv_file}" if b.csv_file else ""), dataset=b.name, date="", accuracy="NOT STATED (collector boundary, not a survey)",
                               crs=f"GDA2020 (EPSG:7844) transformed to MGA (EPSG:{srid})", status=FLAG if flag else USED,
                               note="; ".join([area_txt] + ([b.csv_note] if b.csv_note else []) + (["AREA DIFFERS BY MORE THAN 2 PERCENT"] if flag else []))))
    return b


def _csv_rows(p: Path) -> list[tuple[float, float]]:
    out = []
    for ln in _read(p).splitlines():
        parts = [c.strip() for c in ln.split(",")]
        nums = []
        for c in parts:
            try:
                nums.append(float(c))
            except ValueError:
                pass
        if len(nums) >= 3 and len(parts) >= 3:
            out.append((nums[-2], nums[-1]))
    return out


# ---------------------------------------------------------------------------------------------------------------- lidar
def _read_xyz(p: Path) -> np.ndarray | None:
    pts = []
    with open(p, errors="replace") as fh:
        for ln in fh:
            c = ln.replace("\t", ",").replace(";", ",").split(",") if "," in ln or "\t" in ln or ";" in ln else ln.split()
            if len(c) < 3:
                continue
            try:
                pts.append((float(c[0]), float(c[1]), float(c[2])))
            except ValueError:
                continue                                             # header or junk line
    if not pts:
        return None
    a = np.array(pts, float)
    ok = np.isfinite(a).all(1) & (a[:, 2] > -100.0) & (a[:, 2] < 9000.0)
    return a[ok]


def _read_geotiff(p: Path) -> np.ndarray | None:
    """Minimal north-up GeoTIFF reader (float32 or integer band, ModelPixelScale + ModelTiepoint).  Returns pixel-centre points, or None if unreadable."""
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(p)
    sc, tp = im.tag_v2.get(33550), im.tag_v2.get(33922)
    if not sc or not tp:
        return None
    arr = np.array(im, float)
    nd = im.tag_v2.get(42113)
    if arr.ndim != 2:
        return None
    rows, cols = np.indices(arr.shape)
    x = tp[3] + (cols + 0.5 - tp[0]) * sc[0]
    y = tp[4] - (rows + 0.5 - tp[1]) * sc[1]
    z = arr
    ok = np.isfinite(z) & (z > -100.0) & (z < 9000.0)
    try:
        if nd is not None:
            ok &= np.abs(z - float(str(nd).strip("\x00"))) > 1e-6
    except ValueError:
        pass
    return np.column_stack([x[ok], y[ok], z[ok]])


def _contours_geojson(p: Path, srid: int | None, notes: list[str]) -> list[ContourLine] | None:
    gj = json.loads(_read(p))
    crs_name = json.dumps(gj.get("crs", ""))
    m = re.search(r"EPSG(?:::|:)(\d{4,5})", crs_name)
    file_srid = int(m.group(1)) if m else None
    tr = None
    if file_srid in (4326, 7844):
        tr = Transformer.from_crs(file_srid, srid or 7856, always_xy=True)
        notes.append(f"contours supplied in EPSG:{file_srid}, transformed to MGA")
    elif file_srid and srid and file_srid != srid and 7854 <= file_srid <= 7856:
        tr = Transformer.from_crs(file_srid, srid, always_xy=True)
        notes.append(f"contours supplied in EPSG:{file_srid}, transformed to EPSG:{srid}")
    elif file_srid is None:
        notes.append("contour file states no CRS: MGA assumed")
    out: list[ContourLine] = []
    for f in gj.get("features", []):
        g, pr = f.get("geometry") or {}, f.get("properties") or {}
        rl = next((pr[k] for k in ("rl", "RL", "elevation", "elev", "z", "Z", "level") if k in pr and pr[k] is not None), None)
        try:
            rl = float(rl)
        except (TypeError, ValueError):
            continue
        lines = [g.get("coordinates")] if g.get("type") == "LineString" else g.get("coordinates") if g.get("type") == "MultiLineString" else []
        for ln in lines:
            a = np.array([c[:2] for c in ln], float)
            if len(a) < 2 or not np.isfinite(a).all():
                continue
            if tr is not None:
                a = np.column_stack(tr.transform(a[:, 0], a[:, 1]))
            out.append(ContourLine(rl, bool(pr.get("major", pr.get("index", False))), a))
    return out or None


def _contours_dxf(p: Path) -> list[ContourLine] | None:
    import ezdxf
    doc = ezdxf.readfile(str(p))
    out = []
    for e in doc.modelspace():
        if e.dxftype() != "LWPOLYLINE":
            continue
        z = float(e.dxf.elevation if not hasattr(e.dxf.elevation, "z") else e.dxf.elevation.z)
        if abs(z) < 1e-9:
            continue
        out.append(ContourLine(z, "MAJ" in e.dxf.layer.upper(), np.array([(q[0], q[1]) for q in e.get_points("xy")], float)))
    return out or None


def load_lidar(root: Path, sd: SiteData, srid_hint: int | None) -> LidarData | None:
    d = find_ci(root, "LiDAR")
    if d is None or not d.is_dir():
        sd.missing.append("LiDAR folder (levels and contours): terrain falls back to the NSW 5 m DEM when available, else no levels are drawn")
        sd.items.append(SourceItem("LiDAR levels and contours", "", status=MISSING, note="no LiDAR folder"))
        return None
    notes: list[str] = []
    stp = find_ci(d, "lidar_status.md")
    st = MD.parse_lidar_status(_read(stp)) if stp is not None else None
    if stp is None:
        sd.missing.append("LiDAR/lidar_status.md (dataset, capture date, vertical datum and stated accuracy)")
    srid = None
    if st is not None and st.crs:
        m = re.search(r"zone\s*(\d{2})", st.crs, re.I)
        srid = srid_for_zone(int(m.group(1))) if m else None
    csvp = next((c for c in sorted(d.iterdir()) if c.is_file() and re.search(r"xyz|dem.*\.csv|points", c.name, re.I) and c.suffix.lower() in (".csv", ".xyz", ".txt")), None)
    if csvp is not None and srid is None:
        m = re.search(r"mga\D*(\d{2})", _read(csvp)[:200], re.I)
        srid = srid_for_zone(int(m.group(1))) if m else None
    srid = srid or srid_hint
    pts, pfile = None, None
    if csvp is not None:
        try:
            pts, pfile = _read_xyz(csvp), csvp.name
        except Exception as ex:  # noqa: BLE001
            sd.warnings.append(f"{csvp.name} not read ({type(ex).__name__}: {ex})")
    tif = next((c for c in sorted(d.iterdir()) if c.is_file() and c.suffix.lower() in (".tif", ".tiff")), None)
    if (pts is None or len(pts) < 6) and tif is not None:
        try:
            pts, pfile = _read_geotiff(tif), tif.name
            if pts is not None:
                notes.append("levels read from the clipped GeoTIFF (no XYZ CSV)")
        except Exception as ex:  # noqa: BLE001
            sd.warnings.append(f"{tif.name} not read ({type(ex).__name__}: {ex})")
    if pts is not None and len(pts) >= 3 and not (((1e5 < pts[:, 0]) & (pts[:, 0] < 9e5) & (pts[:, 1] > 1e6)).all()):
        sd.warnings.append("LiDAR levels do not look like MGA metres: NOT USED")
        pts = None
    gj = find_ci(d, "contours_1m.geojson") or next((c for c in sorted(d.iterdir()) if c.suffix.lower() in (".geojson", ".json") and "contour" in c.name.lower()), None)
    dxfp = next((c for c in sorted(d.iterdir()) if c.suffix.lower() == ".dxf" and "contour" in c.name.lower()), None)
    cont, cfile = None, None
    if gj is not None:
        try:
            cont, cfile = _contours_geojson(gj, srid, notes), gj.name
        except Exception as ex:  # noqa: BLE001
            sd.warnings.append(f"{gj.name} not read ({type(ex).__name__}: {ex})")
    if cont is None and dxfp is not None:
        try:
            cont, cfile = _contours_dxf(dxfp), dxfp.name
            if cont:
                notes.append("contours read from the DXF (no GeoJSON); the major flag comes from the layer name")
        except Exception as ex:  # noqa: BLE001
            sd.warnings.append(f"{dxfp.name} not read ({type(ex).__name__}: {ex})")
    ld = LidarData(st, stp.name if stp else None, pts, pfile, srid, cont, cfile, dxfp is not None, tif.name if tif else None, notes)
    # ---- provenance rows
    ds = st.dataset if st else ""
    acc = (st.accuracy_text or "NOT STATED") if st else "NOT STATED (no lidar_status.md)"
    crs = ((st.crs + ("; heights " + st.vertical_datum if st.vertical_datum else "")) if st and st.crs else (f"MGA (EPSG:{srid})" if srid else "NOT STATED"))
    cap = (st.capture_year or "NOT STATED") if st else "NOT STATED"
    rec = f"received {st.received}" if st and st.received else ""
    if stp is not None:
        sd.items.append(SourceItem("LiDAR status", stp.name, dataset=ds or "NOT STATED", date=cap, accuracy=acc, crs=crs, status=USED,
                                   note="; ".join(x for x in [rec, f"ELVIS job {st.order_ref}" if st and st.order_ref else ""] if x)))
    if ld.has_points:
        sd.items.append(SourceItem("LiDAR levels (spot levels, TIN)", pfile, dataset=ds or "NOT STATED", date=cap, accuracy=acc, crs=crs, status=USED,
                                   note=f"{len(pts):,} points read; thinned for the plan set by the run (see the run JSON)"))
    else:
        sd.missing.append("LiDAR levels (LiDAR/dem_2m_xyz.csv or a clipped GeoTIFF)")
        sd.items.append(SourceItem("LiDAR levels (spot levels, TIN)", "", status=MISSING, note="no readable level points"))
    if cont:
        sd.items.append(SourceItem("Existing contours", cfile, dataset=ds or "NOT STATED", date=cap, accuracy=acc, crs=crs, status=USED,
                                   note=f"{len(cont)} lines, interval {ld.interval_m:g} m, major {ld.major_interval_m:g} m" if ld.interval_m and ld.major_interval_m else f"{len(cont)} lines"))
    elif gj is None and dxfp is None:
        sd.missing.append("LiDAR/contours_1m.geojson (contours are regenerated from the levels when present)")
    if dxfp is not None and cfile != dxfp.name:
        sd.items.append(SourceItem("Contours (DXF)", dxfp.name, dataset=ds or "NOT STATED", date=cap, accuracy=acc, crs=crs, status=NOT_USED, note="GeoJSON contours used instead"))
    if tif is not None and pfile != tif.name:
        sd.items.append(SourceItem("Clipped DEM (GeoTIFF)", tif.name, dataset=ds or "NOT STATED", date=cap, accuracy=acc, crs=crs, status=NOT_USED, note="XYZ levels used instead"))
    if st is not None and st.vertical_accuracy_text is None:
        sd.warnings.append("lidar_status.md does not state a vertical accuracy: the label and cut and fill uncertainty cannot quote one (NOT STATED)")
    return ld


# ---------------------------------------------------------------------------------------------------------------- byda
def _gis_features(gdir: Path, srid: int | None, sd: SiteData, byda: BydaData) -> None:
    for f in sorted(p for p in gdir.rglob("*") if p.is_file()):
        rel = f.relative_to(gdir).as_posix()
        byda.gis_files.append(rel)
        owner = f.parent.name if f.parent != gdir else (re.sub(r"[_-]+", " ", f.stem))
        try:
            if f.suffix.lower() in (".geojson", ".json"):
                gj = json.loads(_read(f))
                m = re.search(r"EPSG(?:::|:)(\d{4,5})", json.dumps(gj.get("crs", "")))
                fs = int(m.group(1)) if m else 7844
                tr = None if (fs and srid and fs == srid) else Transformer.from_crs(fs, srid or 7856, always_xy=True)
                for i, ft in enumerate(gj.get("features", [])):
                    if not ft.get("geometry"):
                        continue
                    g = shape(ft["geometry"])
                    if tr is not None:
                        g = shp_transform(tr.transform, g)
                    pr = ft.get("properties") or {}
                    byda.gis_features.append(DraftFeature(f"gis:{rel}:{i}", rel, str(pr.get("owner") or pr.get("asset_owner") or owner), g.wkt, dict(pr)))
            elif f.suffix.lower() == ".dxf":
                import ezdxf
                doc = ezdxf.readfile(str(f))
                for i, e in enumerate(doc.modelspace()):
                    if e.dxftype() == "LINE":
                        wkt = f"LINESTRING ({e.dxf.start.x} {e.dxf.start.y}, {e.dxf.end.x} {e.dxf.end.y})"
                    elif e.dxftype() == "LWPOLYLINE":
                        wkt = "LINESTRING (" + ", ".join(f"{q[0]} {q[1]}" for q in e.get_points("xy")) + ")"
                    elif e.dxftype() == "POINT":
                        wkt = f"POINT ({e.dxf.location.x} {e.dxf.location.y})"
                    else:
                        continue
                    byda.gis_features.append(DraftFeature(f"gis:{rel}:{i}", rel, owner, wkt, {"layer": e.dxf.layer, "crs": "ASSUMED MGA (DXF states none)"}))
            else:
                sd.warnings.append(f"BYDA/gis/{rel}: file type not read (geojson, json and dxf only); listed, not loaded")
        except Exception as ex:  # noqa: BLE001
            sd.warnings.append(f"BYDA/gis/{rel} not read ({type(ex).__name__}: {ex})")


def load_byda(root: Path, sd: SiteData, srid: int | None) -> BydaData | None:
    d = find_ci(root, "BYDA")
    if d is None or not d.is_dir():
        sd.missing.append("BYDA folder (enquiry status and asset owner responses): existing services are NOT CONFIRMED")
        sd.items.append(SourceItem("BYDA enquiry", "", status=MISSING, note="no BYDA folder: existing services not confirmed, not checked"))
        return None
    sp = find_ci(d, "byda_status.md")
    if sp is None:
        by = BydaData(status_file=None)
        sd.missing.append("BYDA/byda_status.md (job number, dates, validity and the owner table)")
    else:
        by = MD.parse_byda_status(_read(sp))
        by.status_file = sp.name
    for sub in sorted(c for c in d.iterdir() if c.is_dir() and c.name.lower() != "gis"):
        pdfs = sorted(f.name for f in sub.rglob("*") if f.is_file())
        if pdfs:
            by.plan_files[sub.name] = pdfs
    loose = sorted(f.name for f in d.iterdir() if f.is_file() and f.suffix.lower() == ".pdf")
    if loose:
        by.plan_files["(BYDA folder)"] = loose
    g = find_ci(d, "gis")
    if g is not None and g.is_dir():
        _gis_features(g, srid, sd, by)
    n_pl = sum(len(v) for v in by.plan_files.values())
    if sp is not None:
        sd.items.append(SourceItem("BYDA enquiry", sp.name, dataset=f"BYDA job {by.job_no or 'NOT STATED'}, enquiry {by.enquiry_no or 'NOT STATED'}",
                                   date=by.lodged or "NOT STATED", accuracy="NOT APPLICABLE (referral status only)", crs="NOT APPLICABLE", status=USED,
                                   note=f"{by.responded} of {by.total} owners responded" + (f"; valid until {MD.ddmmyyyy(by.valid_until)}" if by.valid_until else "; validity date not stated")))
        if by.total == 0:
            sd.warnings.append("byda_status.md has no readable owner table: no owner is treated as having responded")
    sd.items.append(SourceItem("BYDA asset owner plans", ", ".join(f"{k}/ ({len(v)} file(s))" for k, v in by.plan_files.items()) if n_pl else "",
                               dataset="ASSET OWNER PLANS (THIRD PARTY CONTENT)", date="", accuracy="NOT APPLICABLE", crs="NOT APPLICABLE",
                               status=NOT_USED if n_pl else MISSING,
                               note=("listed only; not read, not copied, not traced; FOR THIS PROJECT ONLY" if n_pl else "plan files are not in the folder (held elsewhere by the owner of the enquiry); not traced")))
    if by.gis_files:
        sd.items.append(SourceItem("BYDA vector data (gis)", f"BYDA/gis/ ({len(by.gis_files)} file(s))", dataset="ASSET OWNER VECTOR DATA", date="", accuracy="NOT STATED",
                                   crs="AS SUPPLIED", status=DRAFT, note=f"{len(by.gis_features)} draft feature(s) stored in the run JSON for the verification step; not drawn on any sheet"))
    else:
        sd.items.append(SourceItem("BYDA vector data (gis)", "", status=MISSING, note="no vector data supplied; no service is drawn"))
    return by


# ---------------------------------------------------------------------------------------------------------------- entry point
def load_site_data(folder: str | Path) -> SiteData:
    """Parse a site data folder.  Never raises for a missing or malformed file: the problem is recorded in ``missing`` or ``warnings``."""
    root = Path(folder)
    sd = SiteData(root=str(root))
    if not root.is_dir():
        sd.warnings.append(f"site data folder {root} does not exist")
        sd.missing.append("the whole site data folder")
        return sd
    sd.boundary = load_boundary(root, sd)
    hint = sd.boundary.srid if sd.boundary else None
    sd.lidar = load_lidar(root, sd, hint)
    if sd.boundary is None and sd.lidar is not None and sd.lidar.srid:       # boundary unreadable: nothing to re-derive, zone from LiDAR only used for later files
        hint = sd.lidar.srid
    sd.byda = load_byda(root, sd, hint)
    cp = find_ci(root, "site_controls.md")
    if cp is not None:
        sd.controls_file, sd.controls_text = cp.name, _read(cp)
        sd.items.append(SourceItem("Site controls", cp.name, dataset="COLLECTOR NOTES", status=NOT_USED,
                                   note="present; read as text only, not interpreted and not used for any drawing or check"))
    return sd
