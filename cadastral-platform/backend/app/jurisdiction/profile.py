"""JurisdictionProfile: everything that makes a council/municipality 'custom'.

The profile carries units, CRS, locale, cited standards, vehicle slots, legal pack key and the data
source configuration.  It contains NO jurisdiction rules: those come from uploaded documents or user entry.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .units import UnitContext, dimension_of

UnitSystem = Literal["metric", "imperial_us", "imperial_uk"]


class JModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProfileError(ValueError):
    pass


# ---------------------------------------------------------------------------- units

SYSTEM_DEFAULTS: dict[str, dict[str, str]] = {
    "metric": dict(length="m", area="m2", volume="m3", slope="%", flow="L/s", pressure="kPa"),
    "imperial_us": dict(length="ft", area="ft2", volume="gal_us", slope="%", flow="gpm_us", pressure="psi"),
    "imperial_uk": dict(length="ft", area="ft2", volume="gal_uk", slope="%", flow="gpm_uk", pressure="psi"),
}
ALLOWED = {
    "length": {"m", "ft", "in"}, "area": {"m2", "ft2", "acre", "ha"},
    "volume": {"m3", "yd3", "ft3", "L", "gal_us", "gal_uk"}, "slope": {"%", "ratio"},
    "flow": {"L/s", "cfs", "gpm_us", "gpm_uk"}, "pressure": {"kPa", "psi"},
}


class UnitSettings(JModel):
    system: UnitSystem = "metric"
    length: str | None = None
    area: str | None = None
    volume: str | None = None
    slope: str | None = None            # '%' or 'ratio' (1:n)
    flow: str | None = None
    pressure: str | None = None
    gallon: Literal["us", "imperial"] | None = None   # resolves a bare 'gal'/'gpm' in documents
    foot: Literal["international", "us_survey"] = "international"
    case_insensitive_documents: bool = False

    @model_validator(mode="after")
    def _fill(self):
        d = SYSTEM_DEFAULTS[self.system]
        for k in ALLOWED:
            v = getattr(self, k) or d[k]
            if v not in ALLOWED[k]:
                raise ValueError(f"{k} display unit {v!r} not allowed; choose from {sorted(ALLOWED[k])}")
            if dimension_of(v if v != "ratio" else "1:n") != dimension_of({"length": "m", "area": "m2", "volume": "m3", "slope": "%", "flow": "L/s", "pressure": "kPa"}[k]):
                raise ValueError(f"{k}: wrong dimension")
            setattr(self, k, v)
        if self.gallon is None and self.system == "imperial_us":
            self.gallon = "us"
        if self.gallon is None and self.system == "imperial_uk":
            self.gallon = "imperial"
        return self

    def context(self) -> UnitContext:
        return UnitContext(gallon=self.gallon, case_insensitive=self.case_insensitive_documents, foot=self.foot)

    @property
    def is_imperial(self) -> bool:
        return self.length in ("ft", "in")


# ---------------------------------------------------------------------------- CRS


def _crs(epsg: int):
    from pyproj import CRS
    from pyproj.exceptions import CRSError
    try:
        return CRS.from_epsg(epsg)
    except CRSError as ex:
        raise ProfileError(f"EPSG:{epsg} is not a known coordinate reference system") from ex


def crs_info(epsg: int) -> dict:
    c = _crs(epsg)
    proj = c.is_projected
    factor = None
    unit = None
    if proj:
        ax = c.axis_info[0]
        factor, unit = ax.unit_conversion_factor, ax.unit_name
    return {"epsg": epsg, "name": c.name, "projected": proj, "geographic": c.is_geographic,
            "unit_name": unit, "metres_per_unit": factor}


def utm_epsg_for(lon: float, lat: float) -> int:
    zone = int((lon + 180) // 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


class CrsSettings(JModel):
    horizontal_epsg: int                       # CRS the user's documents/survey use (state plane, UTM, national grid, ...)
    vertical_datum: str = ""                   # free text name, e.g. 'NAVD88', 'AHD', 'local'
    working_epsg: int | None = None            # metric projected CRS for geometry; derived when omitted
    anchor_lonlat: tuple[float, float] | None = None   # used to derive a UTM working CRS when horizontal is not metric-projected
    north_reference: Literal["grid", "true", "magnetic"] = "grid"
    declination_deg: float = 0.0               # east positive; angle from the reference north to grid north is applied (see geometry)
    grid_convergence_deg: float = 0.0          # true north minus grid north bearing difference (east positive), user-entered

    @model_validator(mode="after")
    def _check(self):
        h = _crs(self.horizontal_epsg)
        if h.is_geographic and self.working_epsg is None and self.anchor_lonlat is None:
            raise ValueError(f"EPSG:{self.horizontal_epsg} is geographic (degrees); give working_epsg (a projected metric CRS) "
                             "or anchor_lonlat so a UTM zone can be derived. Metric geometry is never computed in degrees.")
        if self.working_epsg is None:
            if h.is_projected and abs(h.axis_info[0].unit_conversion_factor - 1.0) < 1e-12:
                self.working_epsg = self.horizontal_epsg
            elif self.anchor_lonlat is not None:
                self.working_epsg = utm_epsg_for(*self.anchor_lonlat)
            else:
                raise ValueError(f"EPSG:{self.horizontal_epsg} is projected in {h.axis_info[0].unit_name}, not metres: "
                                 "give working_epsg or anchor_lonlat for the metric working CRS")
        w = _crs(self.working_epsg)
        if not w.is_projected:
            raise ValueError(f"working CRS EPSG:{self.working_epsg} is geographic; a projected metric CRS is required")
        if abs(w.axis_info[0].unit_conversion_factor - 1.0) > 1e-12:
            raise ValueError(f"working CRS EPSG:{self.working_epsg} uses {w.axis_info[0].unit_name}, not metres")
        return self

    @property
    def horizontal_in_metres(self) -> bool:
        info = crs_info(self.horizontal_epsg)
        return bool(info["projected"] and abs(info["metres_per_unit"] - 1.0) < 1e-12)

    def to_working(self, x: float, y: float) -> tuple[float, float]:
        """Transform a horizontal-CRS coordinate (any unit) into the metric working CRS."""
        if self.horizontal_epsg == self.working_epsg:
            return (x, y)
        from pyproj import Transformer
        t = Transformer.from_crs(self.horizontal_epsg, self.working_epsg, always_xy=True)
        return t.transform(x, y)

    def north_offset_deg(self) -> float:
        """Degrees to ADD to a bearing measured from the profile's north reference to get a grid bearing."""
        if self.north_reference == "grid":
            return 0.0
        if self.north_reference == "true":
            return -self.grid_convergence_deg        # grid bearing = true bearing - convergence
        return self.declination_deg - self.grid_convergence_deg   # magnetic -> true (+declination east) -> grid


# ---------------------------------------------------------------------------- locale


class LocaleSettings(JModel):
    decimal_separator: Literal[".", ","] = "."
    thousands_separator: Literal["", ",", ".", " ", "'"] = ""
    date_format: str = "%Y-%m-%d"               # strftime
    language: str = "en"

    @model_validator(mode="after")
    def _distinct(self):
        if self.thousands_separator == self.decimal_separator:
            raise ValueError("decimal and thousands separators must differ")
        return self

    def number(self, v: float, precision: int = 2) -> str:
        s = f"{abs(v):,.{precision}f}"                   # '1,234.50'
        s = s.replace(",", "\x00").replace(".", self.decimal_separator).replace("\x00", self.thousands_separator)
        return ("-" if v < 0 and float(f"{abs(v):.{precision}f}") != 0 else "") + s

    def date(self, d: datetime | None = None) -> str:
        return (d or datetime.now(timezone.utc)).strftime(self.date_format)


# ---------------------------------------------------------------------------- vehicles


class VehicleSlot(JModel):
    """Design vehicle.  Dimensions are metres; None means 'not supplied' and blocks swept-path use."""
    name: str
    library: str = "user"                       # 'AS/NZS 2890.1' | 'user' | free text
    length_m: float | None = None
    width_m: float | None = None
    wheelbase_m: float | None = None
    front_overhang_m: float | None = None
    rear_overhang_m: float | None = None
    min_turn_radius_m: float | None = None
    verified: bool = False
    note: str = ""

    @property
    def complete(self) -> bool:
        return None not in (self.length_m, self.width_m, self.wheelbase_m, self.front_overhang_m,
                            self.rear_overhang_m, self.min_turn_radius_m)

    def to_swept(self):
        from app.agents.sa3_driveway.swept import Vehicle
        if not self.complete:
            raise ProfileError(f"vehicle {self.name!r} has empty dimension slots: enter them from your local standard")
        return Vehicle(self.name, self.length_m, self.width_m, self.wheelbase_m, self.front_overhang_m,
                       self.rear_overhang_m, self.min_turn_radius_m)


def builtin_asnzs_vehicles() -> list[VehicleSlot]:
    """The existing AS/NZS 2890.1 entries (values are the platform's, flagged VERIFY in SA3)."""
    from app.agents.sa3_driveway.swept import VEHICLES
    return [VehicleSlot(name=v.name, library="AS/NZS 2890.1", length_m=v.length, width_m=v.width, wheelbase_m=v.wheelbase,
                        front_overhang_m=v.front_oh, rear_overhang_m=v.rear_oh, min_turn_radius_m=v.min_turn_radius,
                        verified=False, note="platform value, VERIFY against the standard")
            for v in VEHICLES.values()]


# Empty, editable placeholder slots. Dimensions are deliberately NOT filled: no values are asserted for them.
EMPTY_SLOT_NAMES = ("P", "SU-30", "WB-40")


def empty_vehicle_slots(names=EMPTY_SLOT_NAMES, library: str = "user-supplied") -> list[VehicleSlot]:
    return [VehicleSlot(name=n, library=library, note="EMPTY: enter dimensions from your local standard") for n in names]


# ---------------------------------------------------------------------------- sources


class ImageryConfig(JModel):
    kind: Literal["none", "xyz_template", "wms"] = "none"
    url_template: str | None = None             # user URL, e.g. https://tiles.example/{z}/{x}/{y}.png
    attribution: str = ""
    licence_note: str = ""

    @model_validator(mode="after")
    def _need_url(self):
        if self.kind != "none" and not self.url_template:
            raise ValueError("imagery needs url_template when kind is not 'none'")
        return self


CadastreFormat = Literal["geojson", "shapefile_zip", "dxf", "kml", "manual"]


class CadastreSource(JModel):
    kind: Literal["nsw", "qld", "custom"] = "custom"
    accepted_formats: list[CadastreFormat] = Field(default_factory=lambda: ["geojson", "shapefile_zip", "dxf", "kml", "manual"])
    note: str = ""


# ---------------------------------------------------------------------------- profile


class JurisdictionProfile(JModel):
    profile_id: UUID = Field(default_factory=uuid4)
    owner_org_id: UUID | None = None
    owner_user_id: UUID | None = None
    name: str
    country: str = ""                           # free text or ISO code
    region: str = ""                            # state / province
    municipality: str = ""                      # council / municipality / county
    languages: list[str] = Field(default_factory=lambda: ["en"])
    units: UnitSettings = Field(default_factory=UnitSettings)
    crs: CrsSettings
    locale: LocaleSettings = Field(default_factory=LocaleSettings)
    standards: list[str] = Field(default_factory=list)   # free text names cited in notes, e.g. 'AASHTO', 'local standard'
    vehicles: list[VehicleSlot] = Field(default_factory=list)
    legal_pack_key: str = "generic_international"
    imagery: ImageryConfig = Field(default_factory=ImageryConfig)
    cadastre_source: CadastreSource = Field(default_factory=CadastreSource)
    paper_size: Literal["A3", "ARCH_D", "ANSI_B"] = "A3"

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("profile name required")
        return v.strip()

    def unit_context(self) -> UnitContext:
        return self.units.context()

    @property
    def working_epsg(self) -> int:
        return self.crs.working_epsg  # type: ignore[return-value]

    @property
    def council_label(self) -> str:
        return self.municipality or self.name

    def vehicle(self, name: str) -> VehicleSlot:
        for v in self.vehicles:
            if v.name == name:
                return v
        raise ProfileError(f"vehicle {name!r} not in profile {self.name!r}")

    def standards_note(self) -> str:
        return "Standards cited: " + "; ".join(self.standards) if self.standards else ""

    def to_db_row(self) -> dict:
        return {"profile_id": str(self.profile_id), "owner_org_id": str(self.owner_org_id) if self.owner_org_id else None,
                "owner_user_id": str(self.owner_user_id) if self.owner_user_id else None,
                "name": self.name, "country": self.country, "region": self.region, "municipality": self.municipality,
                "languages": self.languages, "config": self.model_dump(mode="json")}


def builtin_profile(jurisdiction: str = "NSW") -> JurisdictionProfile:
    """The legacy built-in behaviour expressed as a profile (metric, MGA, AS/NZS vehicles)."""
    srid = 7856 if jurisdiction == "NSW" else 7856
    return JurisdictionProfile(
        name=f"Built-in {jurisdiction}", country="AU", region=jurisdiction, municipality="",
        crs=CrsSettings(horizontal_epsg=srid, vertical_datum="AHD"),
        standards=["AS/NZS 2890.1"], vehicles=builtin_asnzs_vehicles() + empty_vehicle_slots(),
        legal_pack_key="au_default", cadastre_source=CadastreSource(kind=jurisdiction.lower()))  # type: ignore[arg-type]


def make_profile(name: str, *, horizontal_epsg: int, system: UnitSystem = "metric", **kw) -> JurisdictionProfile:
    """Convenience: custom profile with empty vehicle slots and the AS/NZS reference entries."""
    crs_kw = {k: kw.pop(k) for k in ("vertical_datum", "working_epsg", "anchor_lonlat", "north_reference",
                                      "declination_deg", "grid_convergence_deg") if k in kw}
    kw.setdefault("vehicles", builtin_asnzs_vehicles() + empty_vehicle_slots())
    units = kw.pop("units", None) or UnitSettings(system=system)
    return JurisdictionProfile(name=name, units=units, crs=CrsSettings(horizontal_epsg=horizontal_epsg, **crs_kw), **kw)


__all__ = ["JurisdictionProfile", "UnitSettings", "CrsSettings", "LocaleSettings", "VehicleSlot", "ImageryConfig",
           "CadastreSource", "ProfileError", "builtin_profile", "make_profile", "crs_info", "utm_epsg_for",
           "empty_vehicle_slots", "builtin_asnzs_vehicles"]
