"""Pure SQL/params builders (psycopg %s style) + optional persist(conn, ...)."""
from __future__ import annotations

import json
from uuid import UUID, uuid4

from shapely import wkt as _wkt

from .models import Sa1Result, Snapshot

ALLOWED_PLAN = {"NSW": {"DP", "SP", "CP", "BUP", "SL", "PS", "GTP", "OTHER"},
                "QLD": {"RP", "SP", "CP", "BUP", "SL", "AP", "CSH", "OTHER"}}


def snapshot_insert(s: Snapshot, snapshot_id: UUID):
    sql = ("INSERT INTO cadastre.source_snapshots (snapshot_id, jurisdiction, provider, service_url, layer_name, "
           "query_params, response_sha256, http_etag, licence, attribution, fetched_at) "
           "VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s)")
    return sql, (snapshot_id, s.jurisdiction, s.provider, s.service_url, s.layer_name,
                 json.dumps(s.query_params, sort_keys=True), bytes.fromhex(s.response_sha256),
                 s.http_etag, s.licence, s.attribution, s.fetched_at)


def lot_insert(r: Sa1Result, snapshot_id: UUID):
    i, c = r.identifier, r.lot
    plan = i.plan_type if i.plan_type in ALLOWED_PLAN[i.jurisdiction] else "OTHER"
    a = r.attributes
    sql = ("INSERT INTO cadastre.lots (lot_id, jurisdiction, lot_number, section_number, plan_type, plan_number, "
           "nsw_lot_id, qld_lotplan_id, locality, lga_name, geom_gda2020, mga_srid, geom_mga, area_m2_registered, snapshot_id) "
           "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_Multi(ST_GeomFromText(%s,7844)),%s,ST_Multi(ST_GeomFromText(%s,%s)),%s,%s)")
    return sql, (c.lot_id, c.jurisdiction, i.lot, i.section, plan, i.plan_number,
                 c.lotplan if c.jurisdiction == "NSW" else None, c.lotplan if c.jurisdiction == "QLD" else None,
                 a.get("locality"), c.lga_name, r.boundary_wkt_gda2020, c.mga_srid, c.boundary_wkt, c.mga_srid,
                 c.area_m2_registered, snapshot_id)


def segment_inserts(r: Sa1Result):
    c = r.lot
    sql = ("INSERT INTO cadastre.lot_boundary_segments (lot_id, ring_index, polygon_index, seq, geom_mga, mga_srid, "
           "distance_m, bearing_deg, bearing_dms, adjoins, is_front) "
           "VALUES (%s,%s,%s,%s,ST_GeomFromText(%s,%s),%s,%s,%s,%s,%s,%s)")
    out = []
    for s, d in zip(c.segments, r.segment_details):
        w = f"LINESTRING({s.start_xy[0]} {s.start_xy[1]}, {s.end_xy[0]} {s.end_xy[1]})"
        out.append((sql, (c.lot_id, d.ring_index, d.polygon_index, d.seq_in_ring, w, c.mga_srid, c.mga_srid, s.distance_m,
                          s.bearing_deg, s.bearing_dms, s.adjoins, s.is_front)))
    return out


def zone_insert(z, jurisdiction: str, zone_id: UUID, snapshot_id: UUID | None):
    sql = ("INSERT INTO planning.zones (zone_id, jurisdiction, instrument, zone_code, zone_name, is_residential, "
           "geom_gda2020, snapshot_id) VALUES (%s,%s,%s,%s,%s,%s,ST_Multi(ST_GeomFromText(%s,7844)),%s)")
    return sql, (zone_id, jurisdiction, z.instrument, z.zone_code, z.zone_name, z.is_residential,
                 z.geom_wkt_gda2020, snapshot_id)


def lot_zoning_insert(lot_id: UUID, zone_id: UUID, z):
    sql = ("INSERT INTO planning.lot_zoning (lot_id, zone_id, overlap_area_m2, overlap_fraction, is_dominant) "
           "VALUES (%s,%s,%s,%s,%s)")
    return sql, (lot_id, zone_id, z.overlap_area_m2, z.overlap_fraction, z.is_dominant)


def overlay_insert(lot_id: UUID, o, snapshot_id: UUID | None):
    t = o.overlay_type if o.overlay_type in {"flood", "bushfire", "heritage", "acid_sulfate", "biodiversity", "coastal",
                                             "airport_noise", "landslide", "transport_corridor"} else "other"
    sql = ("INSERT INTO planning.lot_overlays (lot_id, overlay_type, overlay_label, attribute_json, snapshot_id) "
           "VALUES (%s,%s,%s,%s::jsonb,%s)")
    return sql, (lot_id, t, o.overlay_label, json.dumps(o.attributes, default=str), snapshot_id)


def build_all(r: Sa1Result):
    """Ordered list of (sql, params). First snapshot is the cadastre snapshot."""
    if not r.snapshots:
        raise ValueError("no snapshots")
    ids = [uuid4() for _ in r.snapshots]
    stmts = [snapshot_insert(s, i) for s, i in zip(r.snapshots, ids)]
    stmts.append(lot_insert(r, ids[0]))
    stmts += segment_inserts(r)
    zsnap = ids[1] if len(ids) > 1 else None
    for z in r.zones:
        zid = uuid4()
        stmts.append(zone_insert(z, r.lot.jurisdiction, zid, zsnap))
        stmts.append(lot_zoning_insert(r.lot.lot_id, zid, z))
    stmts += [overlay_insert(r.lot.lot_id, o, zsnap) for o in r.overlays]
    return stmts


def persist(conn, r: Sa1Result) -> None:
    """Execute within the caller's transaction (psycopg connection)."""
    with conn.cursor() as cur:
        for sql, params in build_all(r):
            cur.execute(sql, params)
