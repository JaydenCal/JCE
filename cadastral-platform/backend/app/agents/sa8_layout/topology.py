"""Derive walls / roofs from room polygons while preserving stable ids, finishes and openings."""
from __future__ import annotations

import math

from pydantic import BaseModel
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from .model import BuildingModel, Roof, Wall

EXT_T, INT_T = 0.25, 0.10
INT_FINISH = "mat_internal_paint"


class Issue(BaseModel):
    code: str
    message: str
    ids: list[str] = []
    severity: str = "warning"


def _pieces(rooms):
    segs = []
    for r in rooms:
        c = r.polygon + [r.polygon[0]]
        for a, b in zip(c, c[1:]):
            if math.dist(a, b) > 1e-6:
                segs.append(LineString([a, b]))
    if not segs:
        return []
    u = unary_union(segs)
    geoms = list(u.geoms) if hasattr(u, "geoms") else [u]
    out = []
    for g in geoms:
        cs = list(g.coords)
        for a, b in zip(cs, cs[1:]):
            if math.dist(a, b) > 1e-6:
                out.append((a, b))
    return out


def _unit(a, b):
    L = math.dist(a, b)
    return ((b[0] - a[0]) / L, (b[1] - a[1]) / L)


def _candidates(m: BuildingModel, lv):
    rooms = [r for r in m.rooms if r.level_id == lv.id and r.enclosed]
    polys = {r.id: r.poly for r in rooms}
    groups: dict[tuple, list] = {}
    for a, b in _pieces(rooms):
        mid = Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        rids = tuple(sorted(i for i, p in polys.items() if p.boundary.distance(mid) < 1e-5))
        ext = len(rids) <= 1
        if ext and rids:
            d = _unit(a, b)
            lp = Point(mid.x - d[1] * 0.01, mid.y + d[0] * 0.01)
            if not polys[rids[0]].contains(lp):
                a, b = b, a
        elif (a[0], a[1]) > (b[0], b[1]):
            a, b = b, a
        d = _unit(a, b)
        off = d[0] * a[1] - d[1] * a[0]
        groups.setdefault((ext, round(d[0], 3), round(d[1], 3), round(off, 3), rids), []).append((a, b, d))
    cands = []
    for (ext, _, _, _, rids), items in groups.items():
        d = items[0][2]
        items.sort(key=lambda it: it[0][0] * d[0] + it[0][1] * d[1])
        cur_a, cur_b = items[0][0], items[0][1]
        for a, b, _ in items[1:]:
            if math.dist(cur_b, a) < 1e-5:
                cur_b = b
            else:
                cands.append((cur_a, cur_b, ext, list(rids)))
                cur_a, cur_b = a, b
        cands.append((cur_a, cur_b, ext, list(rids)))
    cands.sort(key=lambda c: (c[0][1], c[0][0], c[1][1], c[1][0]))
    return cands


def _match(old: list[Wall], cands):
    pairs = []
    for i, (a, b, *_r) in enumerate(cands):
        d = _unit(a, b)
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        for j, w in enumerate(old):
            wd = w.direction
            if abs(d[0] * wd[1] - d[1] * wd[0]) > 0.02:
                continue
            dist = abs(wd[0] * (mid[1] - w.a[1]) - wd[1] * (mid[0] - w.a[0]))
            if dist > 2.5:
                continue
            t0 = (a[0] - w.a[0]) * wd[0] + (a[1] - w.a[1]) * wd[1]
            t1 = (b[0] - w.a[0]) * wd[0] + (b[1] - w.a[1]) * wd[1]
            ov = min(max(t0, t1), w.length) - max(min(t0, t1), 0.0)
            if ov < 0.3 * min(math.dist(a, b), w.length):
                continue
            pairs.append((dist + 0.1 * (1 - ov / max(math.dist(a, b), 1e-6)), i, j))
    pairs.sort()
    ci, oj, assign = set(), set(), {}
    for _, i, j in pairs:
        if i in ci or j in oj:
            continue
        assign[i] = j
        ci.add(i)
        oj.add(j)
    donors = {}
    for _, i, j in pairs:
        if i not in assign and i not in donors:
            donors[i] = j
    return assign, donors


def resync(m: BuildingModel) -> list[Issue]:
    issues: list[Issue] = []
    old_walls = list(m.walls)
    old_by_id = {w.id: w for w in old_walls}
    open_world = {}
    for o in m.openings:
        w = old_by_id.get(o.wall_id)
        if w:
            open_world[o.id] = (w.point_at(o.position), w.level_id, o.wall_id)
    new_walls: list[Wall] = []
    id_map: dict[str, str] = {}
    for lv in m.levels:
        cands = _candidates(m, lv)
        olds = [w for w in old_walls if w.level_id == lv.id]
        assign, donors = _match(olds, cands)
        for i, (a, b, ext, rids) in enumerate(cands):
            ow = olds[assign[i]] if i in assign else None
            dn = ow or (olds[donors[i]] if i in donors else None)
            if ow is not None:
                wid = ow.id
                id_map[ow.id] = wid
            else:
                wid = m.new_id("wl")
            if dn is not None:
                th, fin = dn.thickness, dn.finish
                if dn.external != ext:
                    th, fin = (EXT_T, m.external_finish) if ext else (INT_T, INT_FINISH)
            else:
                th, fin = (EXT_T, m.external_finish) if ext else (INT_T, INT_FINISH)
            new_walls.append(Wall(id=wid, level_id=lv.id, a=(round(float(a[0]), 6), round(float(a[1]), 6)), b=(round(float(b[0]), 6), round(float(b[1]), 6)),
                                  thickness=th, height=lv.ceiling_height, external=ext, finish=fin, room_ids=rids))
    m.walls = new_walls
    nw = {w.id: w for w in new_walls}
    kept = []
    for o in m.openings:
        info = open_world.get(o.id)
        if info is None:
            issues.append(Issue(code="OPENING_DROPPED", message=f"opening {o.id} had no host wall", ids=[o.id]))
            continue
        pt, lvid, owid = info
        target = nw.get(owid)
        pos = None

        def proj(w):
            d = w.direction
            s = (pt[0] - w.a[0]) * d[0] + (pt[1] - w.a[1]) * d[1]
            dist = abs(d[0] * (pt[1] - w.a[1]) - d[1] * (pt[0] - w.a[0]))
            return s, dist
        if target is not None:
            s, dist = proj(target)
            if dist < 2.5 and o.width / 2 - 1e-6 <= s <= target.length - o.width / 2 + 1e-6:
                pos = s
        if pos is None:
            for w in new_walls:
                if w.level_id != lvid:
                    continue
                s, dist = proj(w)
                if dist < 0.05 and o.width / 2 - 1e-6 <= s <= w.length - o.width / 2 + 1e-6:
                    target, pos = w, s
                    break
        if pos is None:
            issues.append(Issue(code="OPENING_DROPPED", message=f"opening {o.id} no longer fits on any wall and was removed", ids=[o.id]))
            continue
        o.wall_id, o.position = target.id, round(float(pos), 6)
        kept.append(o)
    m.openings = kept
    _sync_roofs(m)
    ids = {r.id for r in m.rooms}
    m.stairs = [s for s in m.stairs if any(l.id == s.from_level for l in m.levels)]
    del ids
    return issues


def _sync_roofs(m: BuildingModel):
    old = {r.level_id: r for r in m.roofs}
    template = next((r for r in reversed(m.roofs)), None)
    roofs = []
    for i, lv in enumerate(m.levels):
        poly = m.level_polygon(lv.id)
        upper = [m.level_polygon(u.id) for u in m.levels if u.rl > lv.rl + 1e-6]
        if upper:
            poly = poly.difference(unary_union(upper).buffer(0.01))
        polys = [p for p in (list(poly.geoms) if hasattr(poly, "geoms") else [poly]) if isinstance(p, Polygon) and p.area > 0.5]
        if not polys:
            continue
        coords = [[(round(float(x), 6), round(float(y), 6)) for x, y in p.exterior.coords][:-1] for p in polys]
        r = old.get(lv.id)
        if r is None:
            r = Roof(id=m.new_id("rf"), level_id=lv.id, **({} if template is None else
                     dict(type=template.type, pitch_deg=template.pitch_deg, eaves=template.eaves, material=template.material,
                          ridge_dir_deg=template.ridge_dir_deg)))
        r.polygons = coords
        roofs.append(r)
    m.roofs = roofs
