"""Display formatting for plan labels.  Geometry stays metric; only TEXT is converted.

The default `DisplaySpec()` reproduces the legacy AU output byte for byte ('12.34 m', '612.0 m²').
SA5 reads `current_display()`; `use_display()` scopes a spec around one export.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Literal

from pydantic import BaseModel, ConfigDict, Field

from .units import F, _FT, convert, format_feet_inches

LABEL = {"m": "m", "ft": "ft", "in": "in", "m2": "m²", "ft2": "ft²", "acre": "ac", "ha": "ha", "%": "%",
         "gal_us": "gal", "gal_uk": "gal (imp)", "L": "L", "m3": "m³", "ft3": "ft³", "yd3": "yd³"}
DXF_INSUNITS = {"in": 1, "ft": 2, "mm": 4, "cm": 5, "m": 6}


class DisplaySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    length_unit: Literal["m", "ft", "in"] = "m"
    area_unit: Literal["m2", "ft2", "acre", "ha"] = "m2"
    volume_unit: str = "L"
    slope_style: Literal["%", "ratio"] = "%"
    decimal_separator: Literal[".", ","] = "."
    thousands_separator: str = ""
    date_format: str = "%Y-%m-%d"
    feet_inches: bool = False                   # 5'-6 1/2" style for lengths
    dxf_units: Literal["m", "ft", "in"] = "m"
    paper: Literal["A3", "ARCH_D", "ANSI_B"] = "A3"
    datum_text: str | None = None               # title block DATUM / GRID text; None = legacy AU text
    standards_note: str = ""
    legal_pack_key: str = ""
    custom: bool = False

    # ---- numbers
    def num(self, v: float, precision: int = 2) -> str:
        s = f"{abs(v):,.{precision}f}"
        s = s.replace(",", "\x00").replace(".", self.decimal_separator).replace("\x00", self.thousands_separator)
        return ("-" if v < 0 and float(f"{abs(v):.{precision}f}") != 0 else "") + s

    # ---- lengths
    def length(self, metres: float, precision: int = 2) -> str:
        if self.length_unit == "m":
            return f"{self.num(metres, precision)} m"
        if self.feet_inches or self.length_unit == "in":
            if self.feet_inches:
                return format_feet_inches(metres)
        return f"{self.num(convert(metres, 'm', self.length_unit), precision)} {LABEL[self.length_unit]}"

    def radius(self, metres: float) -> str:
        return "R" + self.length(metres)

    def area(self, m2: float, precision: int = 1) -> str:
        if self.area_unit == "m2":
            return f"{self.num(m2, precision)} m²"
        p = 3 if self.area_unit == "acre" else precision
        return f"{self.num(convert(m2, 'm2', self.area_unit), p)} {LABEL[self.area_unit]}"

    def area_title(self, m2: float) -> str:
        """Title-block area; legacy AU text is 'sq m'."""
        return f"{self.num(m2, 1)} sq m" if self.area_unit == "m2" else self.area(m2)

    def slope(self, pct: float, precision: int = 1) -> str:
        if self.slope_style == "%":
            return f"{self.num(pct, precision)}%"
        return "level" if pct == 0 else f"1:{self.num(100.0 / abs(pct), precision)}"

    def volume_litres(self, litres: float) -> str:
        u = self.volume_unit
        if u == "L":
            return f"{litres:g} L"
        return f"{self.num(convert(litres, 'L', u), 0 if u.startswith('gal') else 1)} {LABEL.get(u, u)}"

    # ---- scale
    @property
    def length_m_per_unit(self) -> float:
        return {"m": 1.0, "ft": float(_FT), "in": 0.0254}[self.length_unit]

    def scale_label(self, denominator: int) -> str:
        if self.length_unit == "ft" and denominator % 12 == 0:
            return f"1\"={denominator // 12}'"           # engineering scale, e.g. 1"=20' is 1:240
        return f"1:{denominator}"

    def scale_title(self, denominator: int, sheet_name: str) -> str:
        if self.scale_label(denominator).startswith("1\""):
            return f"{self.scale_label(denominator)} @ {sheet_name}"
        return f"1:{denominator} @ {sheet_name}"

    @property
    def scale_unit_label(self) -> str:
        return LABEL[self.length_unit]

    def date(self, iso: str) -> str:
        import datetime as dt
        try:
            return dt.date.fromisoformat(iso).strftime(self.date_format)
        except ValueError:
            return iso

    @classmethod
    def from_profile(cls, p) -> "DisplaySpec":
        u = p.units
        dxf = "ft" if u.length == "ft" else ("in" if u.length == "in" else "m")
        vol = u.volume if u.volume in ("L", "gal_us", "gal_uk", "ft3", "yd3", "m3") else "L"
        return cls(length_unit=u.length, area_unit=u.area, volume_unit=vol, slope_style=u.slope,
                   decimal_separator=p.locale.decimal_separator, thousands_separator=p.locale.thousands_separator,
                   date_format=p.locale.date_format, dxf_units=dxf, paper=p.paper_size,
                   datum_text=f"EPSG:{p.crs.horizontal_epsg}" + (f" (working EPSG:{p.crs.working_epsg})" if p.crs.working_epsg != p.crs.horizontal_epsg else "")
                   + (f", {p.crs.vertical_datum}" if p.crs.vertical_datum else ""),
                   standards_note=p.standards_note(), legal_pack_key=p.legal_pack_key, custom=True)


_CURRENT: ContextVar[DisplaySpec] = ContextVar("display_spec", default=DisplaySpec())


def current_display() -> DisplaySpec:
    return _CURRENT.get()


@contextmanager
def use_display(spec: DisplaySpec | None) -> Iterator[DisplaySpec]:
    if spec is None:                       # no override: keep whatever the caller scoped (or the legacy default)
        yield _CURRENT.get()
        return
    tok = _CURRENT.set(spec)
    try:
        yield _CURRENT.get()
    finally:
        _CURRENT.reset(tok)
