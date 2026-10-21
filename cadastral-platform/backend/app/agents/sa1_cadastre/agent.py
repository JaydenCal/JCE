from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid5, NAMESPACE_URL

from shapely.geometry import Point, shape

from app.agents.base import AgentError
from app.common.contracts import AgentCode, LotContext
from . import clients as C
from .geometry import (area_mismatch, as_multi, compute_segments, mga_srid_for_lon, parse_polygonal, to_mga)
from .models import LotIdentifier, Sa1Request, Sa1Result
from .zoning import ZoningConfig, compute_zones, fetch_overlays, load_zone_features, zone_polygons


@dataclass
class RoadConfig:
    layer: C.LayerConfig | None = None
    geojson_path: str | None = None
    name_field: str = "roadname"
    name_fields: tuple = ()  # if set, non-empty values are joined with spaces (overrides name_field)
    tolerance_m: float = 15.0
    fallback_tolerance_m: float | None = None  # retried only when no front found at tolerance_m (rural: centreline ~18-19 m from boundary, verified 2026-10-12)


@dataclass
class Sa1Config:
    lot_layers: dict = field(default_factory=lambda: {"NSW": C.nsw_lot_layer(), "QLD": C.qld_parcel_layer()})
    zoning: dict = field(default_factory=lambda: {"NSW": ZoningConfig(layer=C.nsw_zoning_layer()), "QLD": ZoningConfig()})
    geocoders: dict = field(default_factory=lambda: {"NSW": C.NSW_GEOCODER, "QLD": None})
    # jurisdiction -> RoadConfig. NSW default: RoadSegment centrelines (verified live 2026-10-12, see clients.NSW_ROADS_LAYER)
    roads: dict = field(default_factory=lambda: {"NSW": RoadConfig(layer=C.nsw_roads_layer(), name_fields=C.NSW_ROAD_NAME_FIELDS, fallback_tolerance_m=25.0)})


class Sa1Cadastre:
    code = AgentCode.SA1_CADASTRE
    version = "1.0.0"
    input_schema = "sa1_request.v1"
    output_schema = "lot_context.v1"
    input_model = Sa1Request

    def __init__(self, config: Sa1Config | None = None, client: C.ArcGISClient | None = None):
        self.cfg = config or Sa1Config()
        self.client = client or C.ArcGISClient()

    def _roads(self, jur, lot_gda, snaps):
        rc = self.cfg.roads.get(jur)
        if not rc:
            return [], 15.0, None
        if rc.geojson_path:
            import json
            feats = json.load(open(rc.geojson_path)).get("features", [])
        else:
            minx, miny, maxx, maxy = lot_gda.buffer(0.0005).bounds
            r = self.client.query(rc.layer, geometry={"xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy,
                                  "spatialReference": {"wkid": 7844}}, geometry_type="esriGeometryEnvelope")
            snaps.append(r.snapshot)
            feats = r.features
        out = []
        for f in feats:
            if f.get("geometry"):
                pr = f.get("properties") or {}
                nm = " ".join(str(pr[k]) for k in rc.name_fields if pr.get(k)) if rc.name_fields else str(pr.get(rc.name_field) or "")
                out.append((nm.title(), shape(f["geometry"])))
        return out, rc.tolerance_m, rc.fallback_tolerance_m

    def run(self, payload: Sa1Request) -> Sa1Result:
        jur = payload.jurisdiction
        layer = self.cfg.lot_layers[jur]
        flags: list[str] = []
        ident = None
        if payload.lot_identifier:
            ident = LotIdentifier.parse(payload.lot_identifier, jur)
            res = self.client.query(layer, where=C.identifier_where(ident, layer))
        else:
            if payload.address:
                gc = self.cfg.geocoders.get(jur)
                if not gc:
                    raise AgentError("SA1_NO_GEOCODER", f"no geocoder configured for {jur}")
                lon, lat = self.client.geocode(gc, payload.address)
            else:
                lon, lat = payload.point
            res = self.client.query(layer, geometry={"x": lon, "y": lat, "spatialReference": {"wkid": 7844}})
        if not res.features:
            raise AgentError("SA1_LOT_NOT_FOUND", "no cadastral parcel matched the query")
        if len(res.features) > 1:
            if ident is None:
                raise AgentError("SA1_AMBIGUOUS", f"{len(res.features)} parcels match point/address; supply lot identifier")
            flags.append(f"multiple_parcels_{len(res.features)}_merged_by_first")
        feat = res.features[0]
        props = feat.get("properties") or {}
        f = layer.fields
        if ident is None:
            ident = self._ident_from_props(jur, props, f)
        snaps = [res.snapshot]
        lot_gda = parse_polygonal(feat.get("geometry"))
        lon = lot_gda.centroid.x
        srid = mga_srid_for_lon(lon)
        mga = as_multi(to_mga(lot_gda, srid))
        roads_gda, tol, tol2 = self._roads(jur, lot_gda, snaps)
        roads = [(n, to_mga(g, srid)) for n, g in roads_gda]
        segs, det, names = compute_segments(mga, roads, tol)
        if roads and tol2 and not any(x.is_front for x in segs):
            segs, det, names = compute_segments(mga, roads, tol2)
            if any(x.is_front for x in segs):
                flags.append(f"road_tolerance_widened_to_{tol2:g}m")
        if not roads:
            flags.append("no_road_data_front_unknown")
        elif not any(s.is_front for s in segs):
            flags.append("no_front_segment_detected")
        calc = round(mga.area, 3)
        reg = props.get(f.get("area"))
        reg = float(reg) if reg not in (None, "") else None
        mism = area_mismatch(calc, reg)
        if mism:
            flags.append("area_mismatch")
        zcfg = self.cfg.zoning.get(jur) or ZoningConfig()
        n_snaps = len(snaps)
        zfeats = load_zone_features(zcfg, self.client, lot_gda, snaps, context_m=zcfg.context_m)
        zone_snap = snaps[n_snaps] if len(snaps) > n_snaps else None
        zones = compute_zones(lot_gda, zfeats, srid, jur, zcfg)
        zpolys = zone_polygons(lot_gda, zfeats, srid, zcfg, zcfg.context_m)
        if len(zones) > 1:
            flags.append("multi_zone")
        if not zones:
            flags.append("no_zoning_data")
        overlays = fetch_overlays(zcfg, self.client, lot_gda, snaps)
        neighbours = self._neighbours(layer, lot_gda, mga, srid, snaps, f, jur)
        lot = LotContext(lot_id=uuid5(NAMESPACE_URL, f"sa1:{jur}:{ident.lotplan}"), jurisdiction=jur,
                         lotplan=ident.lotplan, lga_name=str(props.get(f.get("lga")) or ""), mga_srid=srid,
                         area_m2_calculated=calc, area_m2_registered=reg, boundary_wkt=mga.wkt, segments=segs,
                         road_names=names, zone_code=zones[0].zone_code if zones else None, neighbours=neighbours)
        return Sa1Result(lot=lot, identifier=ident, segment_details=det, zones=zones, overlays=overlays,
                         multi_zone=len(zones) > 1, is_residential=zones[0].is_residential if zones else None,
                         area_mismatch=mism, flags=flags, snapshots=snaps, boundary_wkt_gda2020=as_multi(lot_gda).wkt,
                         attributes={"locality": props.get(f.get("locality")), "zone_window_m": zcfg.context_m if zpolys or zfeats else None}, zone_polygons=zpolys, zone_source=zone_snap)

    def _neighbours(self, layer, lot_gda, mga, srid, snaps, f, jur) -> list:
        """Adjoining parcels (lot layer, 30 m buffer). Best-effort: a failed query yields [] and never fails SA1."""
        try:
            minx, miny, maxx, maxy = lot_gda.buffer(0.0003).bounds
            r = self.client.query(layer, geometry={"xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy,
                                                   "spatialReference": {"wkid": 7844}}, geometry_type="esriGeometryEnvelope")
        except Exception:  # noqa: BLE001
            return []
        return self._lots_from(r.features, mga, srid, f, jur, adjoining_only=True)

    def _lots_from(self, features, mga, srid, f, jur, adjoining_only: bool, unreadable: list | None = None) -> list:
        from app.common.contracts import NeighbourLot
        out, own = [], mga.buffer(0.01)
        for ft in features:
            try:
                g = to_mga(parse_polygonal(ft.get("geometry")), srid)
            except Exception:  # noqa: BLE001
                if unreadable is not None:
                    unreadable.append(ft)              # a parcel the service returned but the platform could not read: the caller must say so
                continue
            if g.is_empty or g.buffer(0.05).intersection(own).area > 0.5 * min(g.area, own.area) or (adjoining_only and not g.buffer(0.5).intersects(mga)):
                continue            # the lot itself / not adjoining
            p = ft.get("properties") or {}
            key = p.get(f.get("lotidstring" if jur == "NSW" else "lotplan"))
            lot_no, plan = p.get(f.get("lot")), p.get(f.get("plan"))
            road = not (key or lot_no)
            if road:
                label = "ROAD RESERVE"
            elif jur == "NSW":
                sec = p.get(f.get("section"))
                label = f"LOT {lot_no}" + (f" SEC {sec}" if sec not in (None, "", "-") else "") + (f" {plan}" if plan else "")
            else:
                label = f"LOT {lot_no} {plan}" if plan else str(key)
            out.append(NeighbourLot(label=label.strip(), wkt=as_multi(g).wkt, is_road=road))
        return out

    def window_lots(self, jur: str, srid: int, lot_mga, window_mga):
        """Every parcel (lots and road reserves, adjoining or not) intersecting ``window_mga`` (MGA metres), for padding the plan viewport.
        Returns (NeighbourLot list, complete, note).  ``complete`` is False when the query failed or hit the record limit; nothing is invented."""
        from app.agents.sa1_cadastre.geometry import from_mga
        layer = self.cfg.lot_layers[jur]
        try:
            minx, miny, maxx, maxy = from_mga(window_mga, srid).bounds
            r = self.client.query(layer, geometry={"xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy, "spatialReference": {"wkid": 7844}},
                                  geometry_type="esriGeometryEnvelope")
        except Exception as ex:  # noqa: BLE001
            return [], False, f"WINDOW QUERY FAILED: {type(ex).__name__}"
        bad: list = []
        lots = self._lots_from(r.features, as_multi(lot_mga), srid, layer.fields, jur, adjoining_only=False, unreadable=bad)
        notes = []
        if getattr(r, "truncated", False):                      # the last page still reported exceededTransferLimit: records are missing
            notes.append("WINDOW QUERY HIT THE SERVICE RECORD LIMIT")
        if bad:                                                 # invalid or empty geometry is never repaired: the gap is stated, not hidden
            notes.append(f"{len(bad)} PARCEL(S) IN THE WINDOW HAD NO READABLE GEOMETRY AND ARE NOT SHOWN")
        return lots, not notes, "; ".join(notes)

    @staticmethod
    def _ident_from_props(jur, props, f) -> LotIdentifier:
        key = props.get(f.get("lotidstring" if jur == "NSW" else "lotplan"))
        if not key:
            raise AgentError("SA1_NO_IDENTIFIER", "parcel has no lot/plan attribute")
        return LotIdentifier.parse(str(key), jur)
