"""Survey ingest: GeoJSON / point arrays, DXF (ezdxf), CSV -> Survey."""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field

import numpy as np

from app.agents.base import AgentError

from .models import SurveyInput


@dataclass
class Survey:
    points: np.ndarray                      # (N,3)
    contours: list[np.ndarray] = field(default_factory=list)   # each (k,3) constant z
    breaklines: list[np.ndarray] = field(default_factory=list)
    srid: int = 0
    accuracy_m: float = 0.1
    source: str = ""
    warnings: list[str] = field(default_factory=list)


def _zval(props: dict) -> float | None:
    for k in ("elevation", "ELEVATION", "elev", "ELEV", "z", "Z", "level", "RL", "rl", "height"):
        if k in props and props[k] is not None:
            try:
                return float(props[k])
            except (TypeError, ValueError):
                pass
    return None


def _from_geojson(gj: dict, S: Survey, pts: list) -> None:
    feats = gj.get("features", [gj] if gj.get("type") == "Feature" else [])
    for f in feats:
        g, p = f.get("geometry") or {}, f.get("properties") or {}
        t, c = g.get("type"), g.get("coordinates")
        z = _zval(p)
        kind = str(p.get("kind", p.get("type", ""))).lower()
        if t == "Point":
            zz = c[2] if len(c) > 2 else z
            if zz is not None:
                pts.append((c[0], c[1], zz))
        elif t == "MultiPoint":
            for q in c:
                zz = q[2] if len(q) > 2 else z
                if zz is not None:
                    pts.append((q[0], q[1], zz))
        elif t in ("LineString", "MultiLineString"):
            for ln in (c if t == "MultiLineString" else [c]):
                a = np.array([[q[0], q[1], q[2] if len(q) > 2 else (z if z is not None else math.nan)] for q in ln], float)
                if np.isnan(a[:, 2]).any():
                    S.warnings.append("linestring without elevation skipped")
                elif kind == "breakline":
                    S.breaklines.append(a)
                elif np.ptp(a[:, 2]) < 1e-9:
                    S.contours.append(a)
                else:
                    S.breaklines.append(a)


def _from_dxf(path: str, S: Survey, pts: list, include_text: bool) -> None:
    import ezdxf
    doc = ezdxf.readfile(path)
    skipped = 0
    for e in doc.modelspace():
        t = e.dxftype()
        if t == "LWPOLYLINE":
            z = float(e.dxf.elevation.z if hasattr(e.dxf.elevation, "z") else e.dxf.elevation)
            xy = np.array([(p[0], p[1]) for p in e.get_points("xy")], float)
            if len(xy) < 2:
                continue
            if abs(z) < 1e-9:
                skipped += 1
                continue
            if e.closed:
                xy = np.vstack([xy, xy[:1]])
            S.contours.append(np.column_stack([xy, np.full(len(xy), z)]))
        elif t == "POLYLINE":
            v = np.array([tuple(p.dxf.location) for p in e.vertices], float)
            if len(v) < 2:
                continue
            if e.is_closed:
                v = np.vstack([v, v[:1]])
            if e.is_3d_polyline and np.ptp(v[:, 2]) > 1e-9:
                S.breaklines.append(v)
            else:
                z = float(v[0, 2]) if abs(v[0, 2]) > 1e-9 else float(getattr(e.dxf, "elevation", (0, 0, 0))[2])
                if abs(z) < 1e-9:
                    skipped += 1
                    continue
                v[:, 2] = z
                S.contours.append(v)
        elif t == "POINT":
            p = e.dxf.location
            pts.append((p[0], p[1], p[2]))
        elif t == "INSERT":
            p = e.dxf.insert
            if abs(p[2]) > 1e-9:
                pts.append((p[0], p[1], p[2]))
        elif t in ("TEXT", "MTEXT") and include_text:
            s = (e.dxf.text if t == "TEXT" else e.text).strip()
            try:
                z = float(s)
            except ValueError:
                continue
            p = e.dxf.insert
            pts.append((p[0], p[1], z))
    if skipped:
        S.warnings.append(f"{skipped} zero-elevation DXF polylines skipped")


def _from_csv(path: str, pts: list) -> None:
    with open(path, newline="") as fh:
        for row in csv.reader(fh):
            try:
                x, y, z = (float(v) for v in row[:3])
            except ValueError:
                continue  # header / junk
            pts.append((x, y, z))


def ingest(inp: SurveyInput, lot_srid: int | None = None) -> Survey:
    if inp.srid not in (7854, 7855, 7856):
        raise AgentError("BAD_SRID", f"MGA2020 zone 54-56 (7854-7856) required, got {inp.srid}")
    if lot_srid is not None and inp.srid != lot_srid:
        raise AgentError("SRID_MISMATCH", f"survey {inp.srid} != lot {lot_srid}")
    S = Survey(points=np.empty((0, 3)), srid=inp.srid, accuracy_m=inp.stated_vertical_accuracy_m, source=inp.source)
    pts: list = list(inp.points)
    for c in inp.contours:
        a = np.asarray(c["coords"], float)[:, :2]
        S.contours.append(np.column_stack([a, np.full(len(a), float(c["z"]))]))
    S.breaklines += [np.asarray(b, float) for b in inp.breaklines]
    if inp.geojson:
        _from_geojson(inp.geojson, S, pts)
    if inp.dxf_path:
        _from_dxf(inp.dxf_path, S, pts, inp.dxf_include_text)
    if inp.csv_path:
        _from_csv(inp.csv_path, pts)
    allp = [np.asarray(pts, float).reshape(-1, 3)] + S.contours + S.breaklines
    allxy = np.vstack(allp)
    if len(allxy) < 3:
        raise AgentError("NO_DATA", "fewer than 3 survey points")
    if not (np.isfinite(allxy).all()):
        raise AgentError("BAD_DATA", "non-finite survey coordinate")
    if not ((1e5 < allxy[:, 0]) & (allxy[:, 0] < 9e5) & (allxy[:, 1] > 1e6)).all():
        raise AgentError("BAD_COORDS", "coordinates do not look like MGA metres (lon/lat or local grid?)")
    n0 = len(pts)
    S.points = dedupe(np.asarray(pts, float).reshape(-1, 3))
    if len(S.points) < n0:
        S.warnings.append(f"{n0 - len(S.points)} duplicate points dropped")
    return S


def dedupe(p: np.ndarray, tol: float = 1e-3) -> np.ndarray:
    if len(p) == 0:
        return p
    _, idx = np.unique(np.round(p[:, :2] / tol).astype(np.int64), axis=0, return_index=True)
    return p[np.sort(idx)]
