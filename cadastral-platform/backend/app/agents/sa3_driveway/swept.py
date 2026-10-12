"""Kinematic single-track (bicycle) swept path. Reference point = rear-axle centre; heading theta (rad, from +x).

Vehicle dims are parameters; B85/B99 values per AS/NZS 2890.1 are flagged VERIFY.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from shapely import wkt as shw
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from .models import CheckItem


@dataclass(frozen=True)
class Vehicle:
    name: str
    length: float
    width: float
    wheelbase: float
    front_oh: float
    rear_oh: float
    min_turn_radius: float   # rear-axle-centre path radius at full lock (VERIFY: standard quotes a turning radius)

    @property
    def max_steer(self) -> float:
        return math.atan(self.wheelbase / self.min_turn_radius)


# VERIFY all against AS/NZS 2890.1:2004 Fig 2.? / Table. B99 overhangs are assumed from length/wheelbase.
VEHICLES = {
    "B85": Vehicle("B85", 4.91, 1.88, 2.8, 0.94, 1.17, 5.2),
    "B99": Vehicle("B99", 5.21, 1.94, 2.99, 0.97, 1.25, 5.5),
}


def custom_vehicle(name, length, width, wheelbase, front_oh, min_turn_radius) -> Vehicle:
    return Vehicle(name, length, width, wheelbase, front_oh, length - wheelbase - front_oh, min_turn_radius)


@dataclass
class Sweep:
    poses: list[tuple[float, float, float]] = field(default_factory=list)
    polygon: Polygon = field(default_factory=Polygon)


def footprint(v: Vehicle, pose) -> Polygon:
    x, y, th = pose
    c, s = math.cos(th), math.sin(th)
    h = v.width / 2
    pts = [(-v.rear_oh, -h), (v.wheelbase + v.front_oh, -h), (v.wheelbase + v.front_oh, h), (-v.rear_oh, h)]
    return Polygon([(x + a * c - b * s, y + a * s + b * c) for a, b in pts])


def advance(v: Vehicle, pose, ds: float, steer: float):
    """Exact bicycle-model step of signed distance ds at constant steer angle (rad)."""
    x, y, th = pose
    k = math.tan(steer) / v.wheelbase
    if abs(k) < 1e-12:
        return (x + ds * math.cos(th), y + ds * math.sin(th), th)
    th2 = th + ds * k
    return (x + (math.sin(th2) - math.sin(th)) / k, y - (math.cos(th2) - math.cos(th)) / k, th2)


def simulate(v: Vehicle, start, moves, step: float = 0.1) -> Sweep:
    """moves: iterable of (signed distance m, steer rad). Union of footprints along the path (incl. overhang corners)."""
    pose, poses = tuple(start), [tuple(start)]
    for dist, steer in moves:
        n = max(1, int(math.ceil(abs(dist) / step)))
        for _ in range(n):
            pose = advance(v, pose, dist / n, steer)
            poses.append(pose)
    return Sweep(poses, unary_union([footprint(v, p) for p in poses]))


def arc_len(v: Vehicle, heading_change_deg: float, steer: float | None = None) -> float:
    steer = v.max_steer if steer is None else abs(steer)
    return math.radians(abs(heading_change_deg)) * v.wheelbase / math.tan(steer)


def turning_circle(v: Vehicle, start, side: int = 1):
    """Full-lock circle: centre (side=+1 left), rear-axle radius, outer body (swept) radius."""
    x, y, th = start
    R = v.min_turn_radius
    c = (x - side * R * math.sin(th), y + side * R * math.cos(th))
    outer = math.hypot(R + v.width / 2, v.wheelbase + v.front_oh)
    inner = R - v.width / 2
    return c, R, outer, inner


def reverse_out(v: Vehicle, garage_xy, heading: float, to_boundary_m: float, exit_deg: float = 90.0, side: int = 1,
                step: float = 0.1) -> Sweep:
    """Vehicle parked nose-in (rear bumper at garage threshold) reverses along the driveway, then swings out.
    heading = direction INTO the lot (road -> garage). side=+1 swings the tail to the vehicle's left in reverse."""
    start = (garage_xy[0] + v.rear_oh * math.cos(heading), garage_xy[1] + v.rear_oh * math.sin(heading), heading)
    # reversing with steer s: dtheta = ds*tan(s)/L, ds<0 -> turn direction = -sign(s)
    moves = [(-max(to_boundary_m, 0.0), 0.0), (-arc_len(v, exit_deg), -side * v.max_steer)]
    return simulate(v, start, moves, step)


def three_point_turn(v: Vehicle, start, side: int = 1, total_deg: float = 180.0, split=(0.45, 0.35, 0.20),
                     step: float = 0.1) -> Sweep:
    """Forward arc (full lock), reverse arc (opposite lock), forward arc: rotates the vehicle total_deg toward `side`."""
    d = [total_deg * f for f in split]
    L = v.max_steer
    return simulate(v, start, [(arc_len(v, d[0]), side * L), (-arc_len(v, d[1]), -side * L), (arc_len(v, d[2]), side * L)], step)


def park_in_90(v: Vehicle, start, side: int = 1, approach_m: float = 3.0, run_in_m: float = 1.0, step: float = 0.1) -> Sweep:
    """Forward past the bay by approach_m, then reverse on full lock through 90 deg into the bay (bay on `side`), straighten."""
    return simulate(v, start, [(approach_m, 0.0), (-arc_len(v, 90.0), side * v.max_steer), (-run_in_m, 0.0)], step)


def check_envelope(sweep: Polygon, *, allowed: Polygon | None = None, exclusions=(), obstacles=(), min_clear_m: float = 0.3
                   ) -> list[CheckItem]:
    items: list[CheckItem] = []
    if allowed is not None:
        out = sweep.difference(allowed)
        items.append(CheckItem(name="swept_within_allowed_area", passed=out.area < 1e-6, value=round(out.area, 4), limit=0.0,
                               unit="m2", note="swept area outside lot + crossover + road side"))
        items.append(CheckItem(name="boundary_clearance", passed=sweep.distance(allowed.boundary) >= min_clear_m if allowed.contains(sweep) else False,
                               value=round(sweep.distance(allowed.boundary), 3), limit=min_clear_m, unit="m"))
    for i, g in enumerate(exclusions):
        items.append(CheckItem(name=f"exclusion_{i}", passed=not sweep.intersects(g), value=round(sweep.distance(g), 3), unit="m",
                               note="distance to envelope exclusion (0 = intersects)"))
    for i, g in enumerate(obstacles):
        d = sweep.distance(g)
        items.append(CheckItem(name=f"obstacle_{i}", passed=d >= min_clear_m, value=round(d, 3), limit=min_clear_m, unit="m"))
    return items
