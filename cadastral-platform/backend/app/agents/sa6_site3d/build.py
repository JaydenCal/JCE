"""Scene builder: SceneRequest -> SceneBundle (deterministic)."""
from __future__ import annotations

import math

import numpy as np
from scipy.interpolate import LinearNDInterpolator, NearestNDInterpolator
from shapely import wkt as swkt
from shapely.affinity import translate
from shapely.geometry import LineString, MultiPolygon, Point, Polygon

from app.agents.base import AgentError
from app.common.labels import upper_label

from . import geom as G
from .contours import contour_plan
from .models import (BuildingIn, Collider, Floor, ItemOut, Label, Layer, Link, Part, SceneBundle,
                     SceneRequest, Spawn, TinArrays, Walkable, Info)

LAYERS = [("surface", "Design surface", True), ("contours", "Design contours", True),
          ("existing", "Existing ground (survey TIN, under the works)", False), ("context", "Surrounds (survey)", True),
          ("buildings", "Buildings", True), ("drainage", "Pits, pipes, stormwater", True),
          ("services", "Underground services (depth below ground)", True), ("buffers", "Service exclusion buffers (ghost)", True),
          ("tanks", "Rainwater tank", True), ("walls", "Retaining walls", True), ("driveway", "Driveway and crossover", True),
          ("sweptpath", "Swept path and turning circle", True), ("boundary", "Boundary", True), ("road", "Road", True),
          ("adjoining", "Adjoining lots (cadastre, not survey)", True), ("aerial", "Aerial imagery (information only)", True),
          ("overlays", "Council overlays", False), ("items", "Placed items", True), ("gradearrows", "Grade arrows", False),
          ("lab_gen", "Labels: site / general", True), ("lab_svc", "Labels: services", True), ("lab_lots", "Labels: Lot / DP", True),
          ("lab_cont", "Labels: contours", True)]
DESIGN_CONTOUR_TAG = "DESIGN SURFACE CONTOUR"
SVC_COL = {"water": "#2f6fb5", "sewer": "#8a5a2b", "stormwater": "#3f8f5f", "electricity": "#c0392b",
           "gas": "#d4a72c", "telecom": "#e67e22", "other": "#7f8c8d"}
OVL_COL = {"flood": "#3b82c4", "bushfire": "#d9582b", "heritage": "#8e5ea2", "envelope": "#2e9e6b"}
MAT = dict(ro=0.9, me=0.0)


class Ground:
    def __init__(self, V=None, F=None, const: float = 0.0):
        self.const = const
        self.extrapolated = 0
        self.lin = self.near = None
        if V is not None and len(V) >= 3:
            self.lin = LinearNDInterpolator(V[:, :2], V[:, 2])
            self.near = NearestNDInterpolator(V[:, :2], V[:, 2])

    def __call__(self, x, y):
        x, y = np.asarray(x, float), np.asarray(y, float)
        if self.lin is None:
            return np.full(x.shape, self.const)
        z = self.lin(x, y)
        bad = np.isnan(z)
        if bad.any():
            # Outside the terrain hull the nearest terrain level is used so geometry can be drawn; this is
            # EXTRAPOLATED, NOT SURVEYED and the Builder reports it in the notes.
            self.extrapolated += int(bad.sum())
            z = np.where(bad, self.near(x, y), z)
        return z


def _hex(c: str) -> np.ndarray:
    return np.array([int(c[i:i + 2], 16) / 255 for i in (1, 3, 5)])


def cutfill_rgb(cf: np.ndarray) -> np.ndarray:
    """cut (negative) -> orange-red, fill (positive) -> blue, ~0 -> near white; saturates at 1.5 m."""
    t = np.clip(np.abs(cf) / 1.5, 0, 1)[:, None]
    tgt = np.where((cf < 0)[:, None], _hex("#d9582b"), _hex("#2b6fd9"))
    return np.round(1.0 * (1 - t) + tgt * t, 3)


class Builder:
    def __init__(self, req: SceneRequest):
        self.r, self.o = req, req.options
        lot_abs = swkt.loads(req.lot.boundary_wkt)
        if lot_abs.is_empty or not lot_abs.is_valid:
            raise AgentError("LOT_GEOMETRY_INVALID", "lot boundary is empty or invalid")
        c = lot_abs.centroid
        self.E0, self.N0 = req.origin or (math.floor(c.x / 10) * 10.0, math.floor(c.y / 10) * 10.0)
        self.lot = self.loc(lot_abs)
        self.parts: list[Part] = []
        self.labels: list[Label] = []
        self.notes: list[str] = []
        self.summary: list[tuple[str, str]] = []
        self.walk = dict(floors=[], colliders=[], links=[])
        self.used: set[str] = set()
        existing = req.existing_tin
        if existing is None and req.survey_points:
            try:
                existing = TinArrays.from_points(req.survey_points)
                self.notes.append(f"Existing ground is a Delaunay triangulation of {len(req.survey_points)} supplied survey points; the surface is linear "
                                  "between points. Outside the hull of the points no level is surveyed (see the EXTRAPOLATED note where it applies).")
            except ValueError:
                self.notes.append("SURVEY POINTS: fewer than three distinct points were supplied, so no ground surface was built. TERRAIN DATA NOT AVAILABLE.")
        self.tin_e = self._tin(existing)
        self.tin_d = self._tin(req.design_tin)
        # No terrain: ground is drawn flat at RL 0.00 and flagged TERRAIN DATA NOT AVAILABLE; neither the FFL nor a pad level is used as ground.
        self.eg = Ground(*(self.tin_e or (None, None)), const=0.0)
        self.dg = Ground(*(self.tin_d or self.tin_e or (None, None)), const=0.0)
        self.no_terrain = self.tin_e is None and self.tin_d is None
        self.ffl = req.ffl
        tp = req.terrain_provenance
        self.terrain_status = upper_label(tp.status) if tp is not None else "TERRAIN SOURCE NOT STATED"
        self.contour_basis = ""
        self.contour_levels = 0
        self.contour_tag = DESIGN_CONTOUR_TAG if self.tin_d is not None else self.terrain_status      # design contours never carry the existing terrain status

    # ---- helpers
    def loc(self, g):
        return translate(g, -self.E0, -self.N0)

    def lw(self, wkt_text: str):
        return self.loc(swkt.loads(wkt_text))

    def _tin(self, t):
        if t is None:
            return None
        V = np.asarray(t.vertices, float) - [self.E0, self.N0, 0.0]
        return V, np.asarray(t.triangles, np.int64)

    def add(self, name, layer, col, soup, a=1.0, ro=0.9, me=0.0, tex=None, cs=None, **kw):
        if soup is None or not len(soup):
            return None
        p = Part(n=name, c=layer, col=col, a=a, ro=ro, me=me, tex=tex, cs=cs,
                 v=np.round(soup.reshape(-1), 3).tolist(), f=list(range(len(soup) * 3)), **kw)
        self.parts.append(p)
        self.used.add(layer)
        return p

    def add_lines(self, name, layer, col, segs, lw=1.0):
        if segs is None or not len(segs):
            return
        self.parts.append(Part(n=name, c=layer, col=col, lines=np.round(np.asarray(segs).reshape(-1), 3).tolist(), lw=lw))
        self.used.add(layer)

    def label(self, t, xyz, layer="lab_gen", s=0.85):
        self.labels.append(Label(t=t, p=tuple(round(float(v), 3) for v in xyz), c=layer, s=s))
        self.used.add(layer)

    def line3(self, coords, zfunc, dz=0.05, step=2.0):
        ls = LineString(coords)
        n = max(2, int(ls.length / step) + 1)
        pts = np.array([ls.interpolate(d).coords[0] for d in np.linspace(0, ls.length, n)])
        return np.c_[pts, zfunc(pts[:, 0], pts[:, 1]) + dz]

    def polyline_segs(self, P):
        return np.stack([P[:-1], P[1:]], 1)

    # ---- layers
    def terrain(self):
        o, lot = self.o, self.lot
        budget = o.max_total_triangles
        nonterr = sum(len(p.v or []) // 9 for p in self.parts)
        B = max(budget - nonterr, 1000)
        cap_s = min(o.max_triangles_per_mesh, int(0.3 * B))
        cap_o = min(o.max_triangles_per_mesh, int(0.2 * B))
        te, td = self.tin_e, self.tin_d
        if te is None and td is None:
            self.notes.append("TERRAIN DATA NOT AVAILABLE: no survey TIN or survey points supplied. Ground is drawn flat at RL 0.00 as a placeholder only; "
                              "no level is implied.")
            c = lot.centroid
            self.label("TERRAIN DATA NOT AVAILABLE (ground drawn flat at RL 0.00, placeholder only)", (c.x, c.y, 2.0), "lab_lots")
            self._aerial_drape(None, cap_a=2)
            return
        V, F = td if td is not None else te
        # triangles of the working surface: those touching the lot
        cen = V[F].mean(1)
        import shapely
        inside = shapely.contains_xy(lot.buffer(0.01), cen[:, 0], cen[:, 1])
        Fs = F[inside] if inside.any() else F
        used = np.unique(Fs)
        remap = -np.ones(len(V), np.int64); remap[used] = np.arange(len(used))
        Vs, Fs = V[used], remap[Fs]
        cf = Vs[:, 2] - self.eg(Vs[:, 0], Vs[:, 1]) if td is not None else np.zeros(len(Vs))
        Vd, Fd, cfd = G.decimate(Vs, Fs, cap_s, cf)
        self.stats_surface = (len(Fs), len(Fd))
        soup = G.soup_from(Vd, Fd)
        cfv = np.round(cfd[Fd].reshape(-1), 3)
        self.add("FS_surface", "surface", "#cfd0cb", soup, ro=0.95, tex="conc", cf=cfv.tolist())
        if td is not None:
            self.add("FS_cutfill", "surface", "#ffffff", soup, ro=0.95, cf=cfv.tolist(),
                     vc=cutfill_rgb(cfv).reshape(-1).tolist())
            self.parts[-1].c = "cutfill"
        # contours from the full-resolution working surface (the design surface when there is one); the interval is chosen from the spacing of the
        # ground points actually sampled (contours.contour_plan), never from the nominal product resolution alone
        zmin, zmax = Vs[:, 2].min(), Vs[:, 2].max()
        tp = self.r.terrain_provenance
        res_m, res_basis = None, "data resolution"
        if tp is not None and tp.effective_spacing_m:
            res_m, res_basis = max(tp.effective_spacing_m, tp.resolution_m or 0.0), "effective point spacing as sampled"
        elif tp is not None and tp.resolution_m:
            res_m = tp.resolution_m
        if res_m is None:
            Vx = te[0] if te is not None else Vs                       # spacing of the existing ground points, not of a design surface
            inside = shapely.contains_xy(lot.buffer(1.0), Vx[:, 0], Vx[:, 1])
            if inside.sum() >= 3:
                res_m, res_basis = round(math.sqrt(lot.area / inside.sum()), 2), "mean point spacing inside the lot"
        plan = contour_plan(res_m, float(zmax - zmin), resolution_basis=res_basis)
        iv = o.contour_interval_m if o.contour_interval_m is not None else plan.interval_m
        major_every = o.major_every if o.major_every is not None else (plan.major_every if o.contour_interval_m is None else 5)
        self.contour_basis = plan.basis if o.contour_interval_m is None else f"Contour interval {iv:g} m was set explicitly for this scene (display choice, not a requirement)."
        if td is not None:
            self.contour_basis = "Contours are of the DESIGN SURFACE. " + self.contour_basis
        minor, major, per_level = [], [], []
        for k in range(math.ceil(zmin / iv), math.floor(zmax / iv) + 1):
            s_ = G.contour_segments(Vs, Fs, k * iv)
            if len(s_):
                (major if k % major_every == 0 else minor).append(s_ + [0, 0, 0.01])
                per_level.append((k * iv, k % major_every == 0, s_))
        self.contour_levels = len(per_level)
        if minor:
            self.add_lines("FS_contours_minor", "contours", "#5b4a2f", np.concatenate(minor))
        if major:
            self.add_lines("FS_contours_major", "contours", "#2e2416", np.concatenate(major), lw=1.5)
        self._contour_labels(per_level)
        c = lot.centroid
        self.label(f"TERRAIN: {self.terrain_status}", (c.x, c.y - 5.0, float(self.eg(c.x, c.y)) + 6.0), "lab_gen")
        self._aerial_drape(te if te is not None else td, cap_a=max(500, int(0.25 * B)))
        # existing ground inside lot / context outside
        if te is not None:
            Ve, Fe = te
            cen = Ve[Fe].mean(1)
            ins = shapely.contains_xy(lot, cen[:, 0], cen[:, 1])
            for nm, layer, sel, col, a in (("EG_survey_TIN", "existing", ins, "#b59a72", 0.35),
                                           ("Existing_ground_context", "context", ~ins, "#b3ad9f", 1.0)):
                if sel.any():
                    Vp, Fp, _ = G.decimate(Ve, Fe[sel], cap_o)
                    self.add(nm, layer, col, G.soup_from(Vp, Fp), a=a, ro=1.0)

    def _contour_labels(self, per_level, max_labels: int = 6):
        """RL labels on the major contours (every level when no major contour falls inside the lot), each with the terrain status (existing ground)
        or DESIGN SURFACE CONTOUR (design surface)."""
        majors = [t for t in per_level if t[1]] or per_level
        if len(majors) > max_labels:
            idx = np.unique(np.round(np.linspace(0, len(majors) - 1, max_labels)).astype(int))
            majors = [majors[i] for i in idx]
        for z, _, segs in majors:
            ln = np.linalg.norm(segs[:, 1, :2] - segs[:, 0, :2], axis=1)
            seg = segs[int(np.argmax(ln))]
            m = (seg[0] + seg[1]) / 2
            self.label(f"CONTOUR RL {z:.2f}, {self.contour_tag}", (m[0], m[1], z + 0.4), "lab_cont", 0.6)

    def _aerial_drape(self, tin, cap_a: int):
        """Aerial image draped on the terrain (a copy of the TIN raised 0.02 m, with texture coordinates from the image extent)."""
        a = self.r.aerial
        if a is None:
            return
        ex0, ey0, ex1, ey1 = a.extent[0] - self.E0, a.extent[1] - self.N0, a.extent[2] - self.E0, a.extent[3] - self.N0
        if tin is None:
            ring = np.array([[ex0, ey0], [ex1, ey0], [ex1, ey1], [ex0, ey1]], float)
            V, F = np.c_[ring, np.zeros(4)], np.array([[0, 1, 2], [0, 2, 3]], np.int64)
        else:
            V, F = tin
            cen = V[F].mean(1)
            keep = (cen[:, 0] >= ex0) & (cen[:, 0] <= ex1) & (cen[:, 1] >= ey0) & (cen[:, 1] <= ey1)
            if not keep.any():
                self.notes.append("AERIAL IMAGERY: the image extent does not overlap the terrain, so no aerial layer was draped.")
                return
            F = F[keep]
        Vd, Fd, _ = G.decimate(V, F, cap_a)
        soup = G.soup_from(Vd, Fd)
        soup = soup.copy()
        soup[..., 2] += 0.02
        uv = np.stack([(soup[..., 0] - ex0) / (ex1 - ex0), (soup[..., 1] - ey0) / (ey1 - ey0)], -1)
        self.add("AERIAL_drape", "aerial", "#ffffff", soup, ro=1.0, uv=np.round(uv.reshape(-1), 5).tolist())

    def boundary_and_road(self):
        lot, g, o = self.lot, self.eg, self.o
        for i, p in enumerate(G.polys(lot)):
            P = self.line3(p.exterior.coords, g, 0.05, 1.0)
            self.add_lines("Property_boundary", "boundary", "#d11d1d", self.polyline_segs(P), lw=2)
            if o.boundary_posts:        # corner posts (display only): one at each boundary vertex
                xy = [(x, y) for x, y in list(p.exterior.coords)[:-1]]
                self.add("Boundary_posts", "boundary", "#d11d1d", G.post_boxes(xy, g, o.post_height_m, o.post_size_m), ro=0.8)
        segs = sorted(self.r.lot.segments, key=lambda s: s.seq)
        front = [s for s in segs if s.is_front]
        self.front = None
        self.kerb_info = None
        if front:
            a, b = (np.array(front[0].start_xy) - [self.E0, self.N0], np.array(front[0].end_xy) - [self.E0, self.N0])
            d = (b - a) / max(np.linalg.norm(b - a), 1e-9)
            n = np.array([-d[1], d[0]])
            if lot.contains(Point(*(a + b) / 2 + n * 0.5)):
                n = -n
            w, run = o.road_width_m, o.road_run_m
            verge = o.verge_depth_m if o.verge_depth_m is not None else 0.0
            k0, k1 = a - d * run + n * verge, b + d * run + n * verge          # ASSUMED kerb line: parallel to the front boundary, `verge` metres towards the road
            road = Polygon([k0, k1, k1 + n * w, k0 + n * w])
            self.add("Road_carriageway", "road", "#5c5e5f", G.drape(road, self.eg, 2.0, -0.02), ro=0.95, tex="asphalt")
            K = self.line3([tuple(k0), tuple(k1)], self.eg, 0.0, 2.0)
            self.add("Kerb_assumed", "road", "#a9abac", G.strip_extrude(K[:, :2], K[:, 2] - 0.02, K[:, 2] + o.kerb_height_m, o.kerb_width_m), ro=0.9, tex="conc", cs=1)
            self.add_lines("Kerb_line_assumed", "road", "#f0b400", self.polyline_segs(K + [0, 0, o.kerb_height_m + 0.03]), lw=2)
            self.front = (a, b, d, n)
            self.kerb_info = (verge, w)
            self.label(f"Road frontage (ASSUMED ROAD WIDTH {w:g} m, PLATFORM DEFAULT, NOT SURVEYED)", (*((a + b) / 2 + n * (verge + w / 2)), self.eg(*((a + b) / 2 + n * (verge + w / 2))) + 1.5), "lab_lots")
            mk = (k0 + k1) / 2
            self.label(f"ASSUMED KERB LINE (PLATFORM DEFAULT, NOT SURVEYED), VERGE DEPTH {verge:g} m ASSUMED, KERB HEIGHT {o.kerb_height_m * 1000:.0f} mm ASSUMED",
                       (mk[0], mk[1], float(self.eg(*mk)) + 3.0), "lab_lots", 0.7)
        c = lot.centroid
        self.label(f"{self.r.lot.lotplan}  {lot.area:.0f} m2", (c.x, c.y, float(self.eg(c.x, c.y)) + 8), "lab_lots")
        self.adjoining_lots()

    def adjoining_lots(self, window_m: float = 60.0):
        """Adjoining parcels from the cadastre (SA1 neighbours): outline, pale fill and the LOT / DP label exactly as the cadastre gave it.
        A parcel with no label is labelled LOT AND PLAN NOT AVAILABLE; a label is never made up."""
        win = self.lot.buffer(window_m)
        for i, nb in enumerate(self.r.lot.neighbours):
            g = self.lw(nb.wkt).intersection(win)
            ps = G.polys(g)
            if not ps:
                continue
            col = "#8a8f94" if nb.is_road else "#7d7a6e"
            for p in ps:
                self.add_lines(f"Adjoining_{i}", "adjoining", col, self.polyline_segs(self.line3(p.exterior.coords, self.eg, 0.05, 2.0)), lw=1.2)
                self.add(f"Adjoining_fill_{i}", "adjoining", "#c9bfa2" if not nb.is_road else "#b4b8bb", G.drape(p, self.eg, 4.0, 0.01), a=0.3, ro=1.0)
            rp = max(ps, key=lambda q: q.area).representative_point()
            text = (nb.label or "").strip().upper()
            if nb.is_road:
                text = f"ROAD RESERVE: {text}" if text else "ROAD RESERVE (LOT AND PLAN NOT AVAILABLE)"
            elif not text:
                text = "LOT AND PLAN NOT AVAILABLE"
            self.label(text, (rp.x, rp.y, float(self.eg(rp.x, rp.y)) + 2.5), "lab_lots", 0.8)

    def retaining_walls(self):
        for i, w in enumerate(self.r.walls):
            P = np.array(w.alignment, float) - [self.E0, self.N0]
            P = self.line3(P, self.eg, 0.0, 1.0)[:, :3]
            low = P[:, 2]
            z0, z1 = low - 0.3, low + w.height_m
            self.add(f"Wall_{i}", "walls", "#b4b2aa", G.strip_extrude(P[:, :2], z0, z1, w.thickness_m), ro=0.9, tex="conc", cs=1)
            m = P[len(P) // 2]
            self.label(f"{w.label} {w.height_m:.1f} m ({w.mode}) - screening only, NOT structural design", (m[0], m[1], m[2] + w.height_m + 0.5))
            for j in range(len(P) - 1):
                self._box_collider(f"wall{i}_{j}", P[j, :2], P[j + 1, :2], w.thickness_m, P[j:j + 2, 2].min() - 0.3, P[j:j + 2, 2].max() + w.height_m)

    def _box_collider(self, id_, a, b, thick, z0, z1):
        a, b = np.asarray(a), np.asarray(b)
        L = float(np.linalg.norm(b - a))
        if L < 1e-6:
            return
        m = (a + b) / 2
        self.walk["colliders"].append(Collider(id=id_, kind="box", c=(round(m[0], 3), round(m[1], 3), round((z0 + z1) / 2, 3)),
                                               size=(round(L, 3), round(thick, 3), round(z1 - z0, 3)),
                                               yaw_deg=round(math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])), 2)))

    def _roller_door(self, pre, fp, b, base):
        from shapely.geometry import Polygon as _P
        ring = np.array(G.orient(fp, 1.0).exterior.coords)[:-1]
        i = b.roller_door.edge_index % len(ring)
        p, q = ring[i], ring[(i + 1) % len(ring)]
        L = float(np.linalg.norm(q - p))
        t = (q - p) / L
        n = np.array([t[1], -t[0]])                     # outward for a CCW ring
        w = min(b.roller_door.width_m, L - 0.2)
        m = (p + q) / 2
        a0, a1 = m - t * w / 2, m + t * w / 2
        quad = _P([a0, a1, a1 + n * 0.06, a0 + n * 0.06])
        self.add(pre + "_RollerDoor", "buildings", b.roller_door.colour,
                 G.prism(quad, base, base + min(b.roller_door.height_m, b.wall_height_m)), ro=0.4, me=0.5, cs=1)

    def buildings(self):
        slab = None
        if self.r.slab_wkt:
            slab = self.lw(self.r.slab_wkt)
        elif self.r.overlay is not None:
            slab = self.lw(self.r.overlay.footprint_wkt)
        for b in self.r.buildings:
            fp = G.polys(self.lw(b.footprint_wkt))[0]
            # No terrain: the building sits on the placeholder ground. Its FFL is never drawn against a ground that has no levels.
            base = float(self.eg(fp.centroid.x, fp.centroid.y)) if self.no_terrain else b.base_rl
            top = base + b.wall_height_m
            pre = ("EX_" if b.is_existing else "PW_") + b.name.replace(" ", "_")
            self.add(pre + "_Walls", "buildings", b.wall_colour, G.prism(fp, base, top, caps=False), ro=0.6, me=0.2, tex="trimclad", cs=1)
            self.add(pre + "_Slab", "buildings", "#cfcfc9", G.prism(fp, base - 0.2, base, sides=True), tex="conc", cs=1)
            if b.roof_type != "none":
                self.add(pre + "_Roof", "buildings", b.roof_colour, G.roof(fp, top, b.roof_type, b.roof_pitch_deg, b.eaves_m), ro=0.5, me=0.3, cs=1)
            if b.roller_door:
                self._roller_door(pre, fp, b, base)
            c = fp.centroid
            ffl_txt = (f"FFL {b.base_rl:.2f} NOT SHOWN AGAINST GROUND, TERRAIN DATA NOT AVAILABLE" if self.no_terrain else f"FFL {b.base_rl:.2f}")
            self.label(f"{b.name}{'' if b.habitable else ' (non-habitable, Class 10a)'}: {ffl_txt}, {b.roof_type} roof" + (f" {b.roof_pitch_deg:g} deg" if b.roof_type not in ("flat", "none") else ""),
                       (c.x, c.y, top + 3.0))
            ring = [(round(x, 3), round(y, 3)) for x, y in G.orient(fp, 1.0).exterior.coords][:-1]
            self.walk["floors"].append(Floor(id=pre, kind="floor", level=base, ring=ring))
            for j in range(len(ring)):
                self._box_collider(f"{pre}_w{j}", ring[j], ring[(j + 1) % len(ring)], 0.2, base, top)
            if b.door_xy and not self.no_terrain:       # a stair needs a real ground level to climb from
                d = np.array(b.door_xy) - [self.E0, self.N0]
                gz = float(self.eg(*d))
                rise = b.base_rl - gz
                if abs(rise) > 0.15:
                    n = max(1, round(abs(rise) / 0.175))
                    self.walk["links"].append(Link(kind="stairs", id=pre + "_entry", a=(*map(lambda v: round(float(v), 3), d), round(gz, 3)),
                                                   b=(round(float(d[0]), 3), round(float(d[1]), 3), b.base_rl), width_m=1.0, steps=n))
        if slab is not None and not slab.is_empty and not self.r.buildings:
            lvl = self.ffl if (self.ffl is not None and not self.no_terrain) else float(self.dg(slab.centroid.x, slab.centroid.y))
            self.add("PW_Slab", "buildings", "#cfcfc9", G.prism(slab, lvl - 0.2, lvl), tex="conc", cs=1)
            self.label((f"Slab footprint (plan overlay), FFL {self.ffl:.2f} NOT SHOWN AGAINST GROUND, TERRAIN DATA NOT AVAILABLE" if self.ffl is not None and self.no_terrain
                        else f"Slab footprint (plan overlay), {self.r.ffl_label}" if self.r.ffl_label and self.ffl is not None
                        else f"Slab footprint (plan overlay), FFL {lvl:.2f}" if self.ffl is not None
                        else "Slab footprint (plan overlay), FFL DATA NOT AVAILABLE (drawn at ground level)"), (slab.centroid.x, slab.centroid.y, lvl + 3))
            self.walk["floors"].append(Floor(id="slab", kind="floor", level=lvl,
                                             ring=[(round(x, 3), round(y, 3)) for x, y in G.polys(slab)[0].exterior.coords][:-1]))
        if self.ffl is None and self.r.buildings:
            self.ffl = self.r.buildings[0].base_rl

    def driveway(self):
        d = self.r.driveway
        if d is None:
            return
        cl = self.lw(d.centreline_wkt)
        cx = self.lw(d.crossover_wkt)
        shape = cl.buffer(d.width_m / 2, cap_style=2).union(cx)
        zf = self.dg
        if self.r.driveway_levels:
            k0, k1 = self.r.driveway_levels
            c0 = np.array(cl.coords[0]); L = max(cl.length, 1e-6)
            def zf(x, y, c0=c0, L=L, k0=k0, k1=k1, line=cl):  # noqa: E306
                t = np.array([line.project(Point(a, b)) for a, b in zip(np.atleast_1d(x), np.atleast_1d(y))]) / L
                return k0 + (k1 - k0) * np.clip(t, 0, 1)
        self.add("Driveway", "driveway", "#8d8f8e", G.drape(shape, zf, 1.5, 0.01), ro=0.95, tex="conc")
        P = self.line3(cl.coords, zf, 0.0, 1.0)
        # The grade is real only when the levels come from terrain or from supplied driveway levels; flat placeholder ground gives no grade.
        g = (P[-1, 2] - P[0, 2]) / max(cl.length, 1e-6) * 100 if (self.r.driveway_levels or not self.no_terrain) else None
        self.dw_grade = g
        self.walk["links"].append(Link(kind="ramp", id="driveway", a=tuple(np.round(P[0], 3)), b=tuple(np.round(P[-1], 3)), width_m=d.width_m))
        ring = [(round(x, 3), round(y, 3)) for x, y in G.polys(shape)[0].exterior.coords][:-1]
        self.walk["floors"].append(Floor(id="driveway", kind="driveway", level=round(float(P[:, 2].mean()), 3), ring=ring))
        m = P[len(P) // 2]
        self.label(f"Driveway {d.width_m:g} m wide, " + (f"average grade {g:.1f}%" if g is not None else "GRADE DATA NOT AVAILABLE") + (f" (max {d.max_grade_pct:.1f}%)" if d.max_grade_pct else ""), (m[0], m[1], m[2] + 1.5))
        for lab, p1, p2 in d.dimensions:
            a, b = np.array(p1) - [self.E0, self.N0], np.array(p2) - [self.E0, self.N0]
            mid = (a + b) / 2
            self.label(lab, (*mid, float(self.eg(*mid)) + 1.0))
        if d.turning_path_wkt:
            for p in G.polys(self.lw(d.turning_path_wkt)):
                self.add_lines("Swept_path_" + d.design_vehicle, "sweptpath", "#e67e22", self.polyline_segs(self.line3(p.exterior.coords, zf, 0.06, 1.0)), lw=2)
            c = self.lw(d.turning_path_wkt).centroid
            self.label(f"Swept path, design vehicle {d.design_vehicle} (illustrative)", (c.x, c.y, float(zf(np.array([c.x]), np.array([c.y]))[0]) + 1.5))
        if d.turning_circle_centre_xy and d.turning_circle_radius_m:
            cx0, cy0 = np.array(d.turning_circle_centre_xy) - [self.E0, self.N0]
            ring = G.ring_pts(cx0, cy0, d.turning_circle_radius_m, 64)
            ring = np.vstack([ring, ring[:1]])
            self.add_lines("Turning_circle", "sweptpath", "#c0392b", self.polyline_segs(np.c_[ring, zf(ring[:, 0], ring[:, 1]) + 0.06]), lw=2)

    def services(self):
        o = self.o
        self.svc_min_cover = None
        self.no_depth_count = 0
        for i, s in enumerate(self.r.services):
            ln = self.lw(s.geometry_wkt)
            depth = s.depth_m                   # None = DEPTH NOT AVAILABLE: never assumed, the service is drawn on the ground surface
            if depth is None:
                self.no_depth_count += 1
            dia = (s.diameter_mm or 100) / 1000.0
            for part in (ln.geoms if hasattr(ln, "geoms") else [ln]):
                gz = self.line3(part.coords, self.eg, 0.0, 2.0)
                gz[:, 2] += dia / 2 if depth is None else -(depth + dia / 2)     # known: centre depth, cover = depth to top of pipe; unknown: pipe sits on the ground
                layer = "drainage" if s.service == "stormwater" else "services"
                col = SVC_COL[s.service]
                self.add(f"{'Proposed' if s.is_proposed else 'Existing'}_{s.service}_{i}", layer, col, G.tube(gz, dia / 2, o.tube_sides),
                         a=1.0, ro=0.6, me=0.1, cs=0)
                m = gz[len(gz) // 2]
            self.label(f"{s.label}: {s.service}" + (f" DN{s.diameter_mm}" if s.diameter_mm else "") +
                       (", DEPTH NOT AVAILABLE" if depth is None else f", cover {depth:.2f} m") + (" PROPOSED" if s.is_proposed else ""),
                       (m[0], m[1], float(self.eg(m[0], m[1])) + 1.0), "lab_svc")
            if depth is not None:
                self.svc_min_cover = depth if self.svc_min_cover is None else min(self.svc_min_cover, depth)
            if s.exclusion_wkt:
                ex = self.lw(s.exclusion_wkt)
                zs = self.eg(*np.array(G.polys(ex)[0].exterior.coords).T) if G.polys(ex) else np.array([0.0])
                zb = float(zs.min()) - 0.05 if depth is None else float(zs.min()) - depth - dia - 0.3     # no depth: thin ghost on the surface
                self.add(f"Buffer_{s.service}_{i}", "buffers", col, G.prism(ex, zb, float(zs.max())),
                         a=0.18, ro=1.0, cs=0)
        for i, p in enumerate(self.r.pits):
            x, y = np.array(p.xy) - [self.E0, self.N0]
            gz = float(self.eg(x, y)); h = p.size_m / 2
            self.add(f"Pit_{i}", "drainage", "#b7b5ac", G.prism(Polygon([(x - h, y - h), (x + h, y - h), (x + h, y + h), (x - h, y + h)]),
                                                                  gz - p.depth_m if p.depth_m is not None else gz - 0.02, gz + 0.02), cs=1)     # no depth: a lid on the surface
            self.label(f"{p.label} (" + (f"invert {p.depth_m:.2f} m below ground" if p.depth_m is not None else "DEPTH NOT AVAILABLE") + ")", (x, y, gz + 1.0), "lab_svc")

    def tank(self):
        t = self.r.rwt
        if t is None:
            return
        x, y = np.array(t.location_xy) - [self.E0, self.N0]
        r = t.diameter_m / 2
        h = self.r.rwt_height_m or max(t.tank_volume_l / 1000.0 / (math.pi * r * r), 0.5)
        gz = float(self.eg(x, y))
        self.add("RWT", "tanks", "#9aa39b", G.cylinder(x, y, r, gz, gz + h), ro=0.5, me=0.2, cs=1)
        self.walk["colliders"].append(Collider(id="rwt", kind="prism", ring=[(round(a, 3), round(b, 3)) for a, b in G.ring_pts(x, y, r, 16)], z0=gz, z1=gz + h))
        self.label(f"Rainwater tank {t.tank_volume_l} L, dia {t.diameter_m:g} m ({t.regime})", (x, y, gz + h + 0.8))

    def overlays(self):
        for i, ov in enumerate(self.r.council_overlays):
            g = self.lw(ov.geometry_wkt)
            col = OVL_COL.get(ov.kind.lower(), "#a8842f")
            self.add(f"Overlay_{ov.kind}_{i}", "overlays", col, G.drape(g, self.eg, 3.0, 0.08), a=0.3, ro=1.0, cs=0)
            c = g.centroid
            self.label(f"{ov.label} ({ov.kind})", (c.x, c.y, float(self.eg(c.x, c.y)) + 2.0), "lab_lots")

    def placed_items(self) -> list[ItemOut]:
        out, bufs = [], [(s.label, self.lw(s.exclusion_wkt)) for s in self.r.services if s.exclusion_wkt]
        for it in self.r.items:
            x, y = it.x - self.E0, it.y - self.N0
            z = it.z if it.z is not None else float(self.eg(x, y))
            w = []
            if not self.lot.buffer(0.01).contains(Point(x, y)):
                w.append("outside lot boundary")
            w += [f"on service exclusion buffer: {n}" for n, b in bufs if b.contains(Point(x, y))]
            out.append(ItemOut(id=it.item_id, name=it.name, t=(round(x, 3), round(y, 3), round(z, 3)), yaw_deg=it.yaw_deg, scale=it.scale,
                               dims_m=it.dims_m, proxy="model" if it.model_url else "box", model_url=it.model_url, catalogue_id=it.catalogue_id,
                               retailer=it.retailer, source_url=it.source_url, price=it.price, level=it.level, warnings=w))
        return out

    def spawn(self) -> Spawn:
        c = self.lot.centroid
        if self.front:
            a, b, d, n = self.front
            p = (a + b) / 2 - n * 3.0
        else:
            p = np.array([c.x, c.y])
        if not self.lot.contains(Point(*p)):
            p = np.array(self.lot.representative_point().coords[0])
        yaw = math.degrees(math.atan2(c.y - p[1], c.x - p[0]))
        return Spawn(pos=(round(float(p[0]), 3), round(float(p[1]), 3), round(float(self.eg(*p)), 3)), yaw_deg=round(yaw, 1), eye_height_m=self.o.eye_height_m)
