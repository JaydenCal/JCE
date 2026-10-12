from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid5, NAMESPACE_URL

from shapely.geometry import Point, shape

from app.agents.base import AgentError
from app.common.contracts import AgentCode, LotContext
from . import clients as C
from .geometry import (area_mismatch, as_multi, compute_segments, mga_srid_for_lon, parse_polygonal, to_mga)
from .models import LotIdentifier, Sa1Request, Sa1Result
from .zoning import ZoningConfig, compute_zones, fetch_overlays, load_zone_features


@dataclass
class RoadConfig:
    layer: C.LayerConfig | None = None
    geojson_path: str | None = None
    name_field: str = "roadname"
    name_fields: tuple = ()  # if set, non-empty values are joined with spaces (overrides name_field)
    tolerance_m: float = 15.0


@dataclass
class Sa1Config:
    lot_layers: dict = field(default_factory=lambda: {"NSW": C.nsw_lot_layer(), "QLD": C.qld_parcel_layer()})
    zoning: dict = field(default_factory=lambda: {"NSW": ZoningConfig(layer=C.nsw_zoning_layer()), "QLD": ZoningConfig()})
    geocoders: dict = field(default_factory=lambda: {"NSW": C.NSW_GEOCODER, "QLD": None})
    # jurisdiction -> RoadConfig. NSW default: RoadSegment centrelines (verified live 2026-10-12, see clients.NSW_ROADS_LAYER)
    roads: dict = field(default_factory=lambda: {"NSW": RoadConfig(layer=C.nsw_roads_layer(), name_fields=C.NSW_ROAD_NAME_FIELDS)})


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
            return [], 15.0
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
        return out, rc.tolerance_m

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
        roads_gda, tol = self._roads(jur, lot_gda, snaps)
        roads = [(n, to_mga(g, srid)) for n, g in roads_gda]
        segs, det, names = compute_segments(mga, roads, tol)
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
        zfeats = load_zone_features(zcfg, self.client, lot_gda, snaps)
        zones = compute_zones(lot_gda, zfeats, srid, jur, zcfg)
        if len(zones) > 1:
            flags.append("multi_zone")
        if not zones:
            flags.append("no_zoning_data")
        overlays = fetch_overlays(zcfg, self.client, lot_gda, snaps)
        lot = LotContext(lot_id=uuid5(NAMESPACE_URL, f"sa1:{jur}:{ident.lotplan}"), jurisdiction=jur,
                         lotplan=ident.lotplan, lga_name=str(props.get(f.get("lga")) or ""), mga_srid=srid,
                         area_m2_calculated=calc, area_m2_registered=reg, boundary_wkt=mga.wkt, segments=segs,
                         road_names=names, zone_code=zones[0].zone_code if zones else None)
        return Sa1Result(lot=lot, identifier=ident, segment_details=det, zones=zones, overlays=overlays,
                         multi_zone=len(zones) > 1, is_residential=zones[0].is_residential if zones else None,
                         area_mismatch=mism, flags=flags, snapshots=snaps, boundary_wkt_gda2020=as_multi(lot_gda).wkt,
                         attributes={"locality": props.get(f.get("locality"))})

    @staticmethod
    def _ident_from_props(jur, props, f) -> LotIdentifier:
        key = props.get(f.get("lotidstring" if jur == "NSW" else "lotplan"))
        if not key:
            raise AgentError("SA1_NO_IDENTIFIER", "parcel has no lot/plan attribute")
        return LotIdentifier.parse(str(key), jur)
