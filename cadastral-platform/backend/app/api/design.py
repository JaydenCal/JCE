"""Design module routes: catalogue, product import, placed items, shopping list. All Terms-gated."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import shapely
from fastapi import APIRouter, Depends, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import PlainTextResponse
from psycopg import Connection

from app.api.deps import ApiError, get_conn, require_project, require_terms
from app.design import shopping_list as sl
from app.design.models import ImportRequest, PlacedItemIn, PlacedItemPatch, PlacementResult
from app.design.placement import PlacementContext, validate_placement
from app.design.product_import import ImportError_, ProductImporter

router = APIRouter()

_CAT_COLS = ("catalogue_item_id, retailer, source_url, sku, title, brand, price_aud, price_captured_at, width_m, "
             "depth_m, height_m, category, image_uri, model_uri, model_kind::text AS model_kind, licence_note")


def _importer(request: Request) -> ProductImporter:
    imp = getattr(request.app.state, "design_importer", None)
    if imp is None:
        imp = request.app.state.design_importer = ProductImporter()
    return imp


def load_context(conn: Connection, project_id: UUID, level_id: UUID | None) -> tuple[int, PlacementContext]:
    """Default PlacementContext from the DB. Override with app.state.design_context(conn, project_id, level_id)."""
    lot = conn.execute("SELECT l.mga_srid, ST_AsBinary(l.geom_mga) AS g FROM core.projects p "
                       "JOIN cadastre.lots l ON l.lot_id = p.primary_lot_id WHERE p.project_id=%s",
                       (project_id,)).fetchone()
    if lot is None:
        raise ApiError(409, "NO_LOT_CONTEXT", "project has no primary lot; run the cadastre step first")
    srid = lot["mga_srid"]
    env = conn.execute("SELECT ST_AsBinary(ST_Union(envelope_geom)) AS g FROM planning.building_envelopes "
                       "WHERE project_id=%s AND mga_srid=%s", (project_id, srid)).fetchone()["g"]
    bufs = conn.execute("SELECT b.buffer_id::text AS id, ST_AsBinary(b.geom_mga) AS g FROM utilities.exclusion_buffers b "
                        "JOIN utilities.service_assets a USING (asset_id) WHERE a.project_id=%s AND b.mga_srid=%s",
                        (project_id, srid)).fetchall()
    walls = conn.execute("SELECT wall_id::text AS id, ST_AsBinary(centreline_mga) AS g, thickness_m FROM design.walls "
                         "WHERE project_id=%s AND mga_srid=%s AND (%s::uuid IS NULL OR level_id=%s)",
                         (project_id, srid, level_id, level_id)).fetchall()
    others = conn.execute("SELECT i.placed_item_id::text AS id, i.x, i.y, i.z, i.yaw_deg, i.scale, c.width_m, c.depth_m, "
                          "c.height_m FROM design.placed_items i JOIN design.catalogue_items c USING (catalogue_item_id) "
                          "WHERE i.project_id=%s AND c.width_m IS NOT NULL AND c.depth_m IS NOT NULL "
                          "AND c.height_m IS NOT NULL", (project_id,)).fetchall()
    from app.design.placement import footprint
    floor = None
    if level_id:
        r = conn.execute("SELECT floor_rl_m FROM design.levels WHERE level_id=%s", (level_id,)).fetchone()
        floor = float(r["floor_rl_m"]) if r else None
    ctx = PlacementContext(
        floor_rl=floor, boundary=shapely.from_wkb(bytes(lot["g"])),
        envelope=shapely.from_wkb(bytes(env)) if env else None,
        dbyd_buffers=[(b["id"], shapely.from_wkb(bytes(b["g"]))) for b in bufs],
        walls=[(w["id"], shapely.from_wkb(bytes(w["g"])), float(w["thickness_m"])) for w in walls],
        others=[(o["id"], footprint(o["x"], o["y"], float(o["width_m"]), float(o["depth_m"]), o["yaw_deg"], o["scale"]),
                 o["z"], o["z"] + float(o["height_m"]) * o["scale"]) for o in others])
    return srid, ctx


def _context(request: Request, conn: Connection, project_id: UUID, level_id: UUID | None):
    fn = getattr(request.app.state, "design_context", None) or load_context
    return fn(conn, project_id, level_id)


def _catalogue_row(conn: Connection, cid: UUID) -> dict:
    row = conn.execute(f"SELECT {_CAT_COLS} FROM design.catalogue_items WHERE catalogue_item_id=%s", (cid,)).fetchone()
    if row is None:
        raise ApiError(404, "CATALOGUE_ITEM_NOT_FOUND", "catalogue item not found")
    return row


def _store_checks(conn: Connection, project_id: UUID, item_id: UUID, res: PlacementResult) -> None:
    conn.execute("DELETE FROM design.item_checks WHERE placed_item_id=%s", (item_id,))
    for i in res.issues:
        conn.execute("INSERT INTO design.item_checks (project_id, placed_item_id, check_kind, passed, severity, message, "
                     "ref_table, ref_id) VALUES (%s,%s,%s,false,%s::design.check_severity,%s,NULL,NULL)",
                     (project_id, item_id, i.kind, i.severity, i.message))


def _placed_out(conn: Connection, item_id: UUID) -> dict:
    row = conn.execute("SELECT * FROM design.placed_items WHERE placed_item_id=%s", (item_id,)).fetchone()
    row["checks"] = conn.execute("SELECT check_kind, severity::text AS severity, message FROM design.item_checks "
                                 "WHERE placed_item_id=%s ORDER BY checked_at, check_kind", (item_id,)).fetchall()
    return row


# ---------------------------------------------------------------- catalogue

@router.get("/catalogue")
def list_catalogue(q: str | None = None, retailer: str | None = None, category: str | None = None,
                   max_price: float | None = Query(default=None, ge=0), limit: int = Query(default=50, ge=1, le=200),
                   offset: int = Query(default=0, ge=0), _: UUID = Depends(require_terms),
                   conn: Connection = Depends(get_conn)):
    rows = conn.execute(
        f"SELECT {_CAT_COLS} FROM design.catalogue_items WHERE (%(q)s::text IS NULL OR "
        "to_tsvector('simple', title) @@ plainto_tsquery('simple', %(q)s) OR title ILIKE '%%' || %(q)s || '%%' "
        "OR brand ILIKE '%%' || %(q)s || '%%') AND (%(r)s::text IS NULL OR retailer = %(r)s) "
        "AND (%(c)s::text IS NULL OR category = %(c)s) AND (%(p)s::numeric IS NULL OR price_aud <= %(p)s) "
        "ORDER BY created_at DESC LIMIT %(l)s OFFSET %(o)s",
        {"q": q, "r": retailer, "c": category, "p": max_price, "l": limit, "o": offset}).fetchall()
    return jsonable_encoder({"items": rows, "limit": limit, "offset": offset})


@router.post("/catalogue/import")
def import_product(body: ImportRequest, request: Request, user_id: UUID = Depends(require_terms),
                   conn: Connection = Depends(get_conn)):
    try:
        res = _importer(request).import_url(body.url, body.width_m, body.depth_m, body.height_m)
    except ImportError_ as e:
        raise ApiError(e.status, e.code, e.message) from None
    if res.status == "dimensions_required":
        return jsonable_encoder({"status": "dimensions_required", "missing": res.missing, "draft": res.item,
                                 "notes": res.notes})
    it = res.item
    row = conn.execute(
        "INSERT INTO design.catalogue_items (retailer, source_url, sku, title, brand, price_aud, price_captured_at, "
        "width_m, depth_m, height_m, category, image_uri, model_uri, model_kind, licence_note, captured_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::design.model_kind,%s,%s) "
        "ON CONFLICT (retailer, source_url) DO UPDATE SET price_aud=EXCLUDED.price_aud, "
        "price_captured_at=EXCLUDED.price_captured_at, title=EXCLUDED.title "
        "WHERE design.catalogue_items.captured_by = EXCLUDED.captured_by "
        f"RETURNING {_CAT_COLS}",
        (it.retailer, it.source_url, it.sku, it.title, it.brand, it.price_aud, it.price_captured_at, it.width_m,
         it.depth_m, it.height_m, it.category, it.image_uri, it.model_uri, it.model_kind, it.licence_note,
         user_id)).fetchone()
    if row is None:       # already captured by someone else: return the existing entry
        row = conn.execute(f"SELECT {_CAT_COLS} FROM design.catalogue_items WHERE retailer=%s AND source_url=%s",
                           (it.retailer, it.source_url)).fetchone()
    return jsonable_encoder({"status": "ok", "item": row, "notes": res.notes})


# ---------------------------------------------------------------- placed items

@router.get("/projects/{project_id}/items")
def list_items(project_id: UUID, _: UUID = Depends(require_terms), conn: Connection = Depends(get_conn)):
    require_project(project_id, conn)
    rows = conn.execute("SELECT i.*, c.title, c.retailer, c.width_m, c.depth_m, c.height_m, c.model_uri, "
                        "c.model_kind::text AS model_kind, c.image_uri FROM design.placed_items i "
                        "JOIN design.catalogue_items c USING (catalogue_item_id) WHERE i.project_id=%s "
                        "ORDER BY i.created_at", (project_id,)).fetchall()
    checks = conn.execute("SELECT placed_item_id, check_kind, severity::text AS severity, message "
                          "FROM design.item_checks WHERE project_id=%s", (project_id,)).fetchall()
    for r in rows:
        r["checks"] = [{k: c[k] for k in ("check_kind", "severity", "message")} for c in checks
                       if c["placed_item_id"] == r["placed_item_id"]]
    return jsonable_encoder({"items": rows})


@router.post("/projects/{project_id}/items", status_code=201)
def place_item(project_id: UUID, body: PlacedItemIn, request: Request, user_id: UUID = Depends(require_terms),
               conn: Connection = Depends(get_conn)):
    require_project(project_id, conn)
    cat = _catalogue_row(conn, body.catalogue_item_id)
    srid, ctx = _context(request, conn, project_id, body.level_id)
    scale = 1.0 if body.scale_locked else body.scale
    res = validate_placement(
        tuple(float(cat[k]) if cat[k] is not None else None for k in ("width_m", "depth_m", "height_m")),
        body.x, body.y, body.z, body.yaw_deg, scale, body.anchor, ctx)
    if res.blocked:
        raise ApiError(422, "PLACEMENT_BLOCKED", "item cannot be placed here",
                       issues=jsonable_encoder(res.issues))
    row = conn.execute(
        "INSERT INTO design.placed_items (project_id, catalogue_item_id, level_id, room_id, mga_srid, x, y, z, yaw_deg, "
        "pitch_deg, roll_deg, scale, scale_locked, anchor, locked, created_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::design.anchor_surface,%s,%s) RETURNING placed_item_id",
        (project_id, body.catalogue_item_id, body.level_id, body.room_id, srid, res.x, res.y, res.z, res.yaw_deg,
         body.pitch_deg, body.roll_deg, scale, body.scale_locked, body.anchor, body.locked, user_id)).fetchone()
    _store_checks(conn, project_id, row["placed_item_id"], res)
    return jsonable_encoder(_placed_out(conn, row["placed_item_id"]))


@router.patch("/projects/{project_id}/items/{item_id}")
def patch_item(project_id: UUID, item_id: UUID, body: PlacedItemPatch, request: Request,
               _: UUID = Depends(require_terms), conn: Connection = Depends(get_conn)):
    require_project(project_id, conn)
    cur = conn.execute("SELECT * FROM design.placed_items WHERE placed_item_id=%s AND project_id=%s FOR UPDATE",
                       (item_id, project_id)).fetchone()
    if cur is None:
        raise ApiError(404, "ITEM_NOT_FOUND", "placed item not found")
    change = body.model_dump(exclude_unset=True)
    if cur["locked"] and set(change) != {"locked"}:
        raise ApiError(409, "ITEM_LOCKED", "unlock the item before changing it")
    new = {**cur, **change}
    if new["scale_locked"]:
        new["scale"] = 1.0
    cat = _catalogue_row(conn, cur["catalogue_item_id"])
    _, ctx = _context(request, conn, project_id, new["level_id"])
    res = validate_placement(tuple(float(cat[k]) if cat[k] is not None else None
                                   for k in ("width_m", "depth_m", "height_m")),
                             new["x"], new["y"], new["z"], new["yaw_deg"], new["scale"],
                             new["anchor"], ctx, self_id=str(item_id))
    if res.blocked:
        raise ApiError(422, "PLACEMENT_BLOCKED", "item cannot be placed here", issues=jsonable_encoder(res.issues))
    conn.execute("UPDATE design.placed_items SET level_id=%s, room_id=%s, x=%s, y=%s, z=%s, yaw_deg=%s, pitch_deg=%s, "
                 "roll_deg=%s, scale=%s, scale_locked=%s, anchor=%s::design.anchor_surface, locked=%s "
                 "WHERE placed_item_id=%s",
                 (new["level_id"], new["room_id"], res.x, res.y, res.z, res.yaw_deg, new["pitch_deg"], new["roll_deg"],
                  new["scale"], new["scale_locked"], new["anchor"], new["locked"], item_id))
    _store_checks(conn, project_id, item_id, res)
    return jsonable_encoder(_placed_out(conn, item_id))


@router.delete("/projects/{project_id}/items/{item_id}", status_code=204)
def delete_item(project_id: UUID, item_id: UUID, _: UUID = Depends(require_terms),
                conn: Connection = Depends(get_conn)):
    require_project(project_id, conn)
    r = conn.execute("DELETE FROM design.placed_items WHERE placed_item_id=%s AND project_id=%s "
                     "RETURNING placed_item_id", (item_id, project_id)).fetchone()
    if r is None:
        raise ApiError(404, "ITEM_NOT_FOUND", "placed item not found")


@router.get("/projects/{project_id}/shopping-list")
def shopping_list(project_id: UUID, format: str = Query(default="json", pattern="^(json|csv)$"),
                  _: UUID = Depends(require_terms), conn: Connection = Depends(get_conn)):
    require_project(project_id, conn)
    rows = conn.execute("SELECT c.catalogue_item_id, c.retailer, c.brand, c.title, c.sku, c.source_url, c.price_aud, "
                        "c.price_captured_at FROM design.placed_items i JOIN design.catalogue_items c "
                        "USING (catalogue_item_id) WHERE i.project_id=%s ORDER BY i.created_at", (project_id,)).fetchall()
    lines, now = sl.build_lines(rows), datetime.now(timezone.utc)
    if format == "csv":
        return PlainTextResponse(sl.to_csv(lines, now), media_type="text/csv",
                                 headers={"Content-Disposition": 'attachment; filename="shopping-list.csv"'})
    return PlainTextResponse(sl.to_json(lines, now), media_type="application/json")
