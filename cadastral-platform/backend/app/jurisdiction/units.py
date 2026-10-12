"""Exact unit conversion with canonical SI storage (pint-free).

Every quantity has a dimension and an exact rational factor to its SI base unit
(m, m2, m3, m3/s, Pa, slope as rise/run).  Conversion is `Fraction` arithmetic, so
round-trips are exact up to the final float rounding.

Nothing is guessed: ambiguous tokens ('gal', 'gpm', 'FT' with odd case, ...) raise
`AmbiguousUnit` unless a `UnitContext` (normally from the JurisdictionProfile)
or an explicit user confirmation resolves them.  Dimension mismatches raise `UnitMismatch`.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from fractions import Fraction as F
from typing import Callable

# ---------------------------------------------------------------------------- errors


class UnitError(ValueError):
    pass


class UnitMismatch(UnitError):
    """Dimensions differ (e.g. converting m to m2) or a document unit disagrees with the profile."""


class UnknownUnit(UnitError):
    pass


class AmbiguousUnit(UnitError):
    """The token has more than one meaning; the profile or the user must say which."""

    def __init__(self, token: str, options: list[str], hint: str = "") -> None:
        super().__init__(f"unit {token!r} is ambiguous ({', '.join(options)}). {hint}".strip())
        self.token, self.options = token, options


# ---------------------------------------------------------------------------- unit table


@dataclass(frozen=True)
class Unit:
    name: str
    dim: str
    factor: F                                   # to SI base of the dimension (linear units)
    to_si: Callable[[float], float] | None = None      # nonlinear units (slope ratio)
    from_si: Callable[[float], float] | None = None


_FT = F(3048, 10000)
_IN = F(254, 10000)
_YD = 3 * _FT
_MI = 5280 * _FT
_FT_US = F(1200, 3937)                            # US survey foot
_ACRE = 4840 * _YD * _YD
_FT3 = _FT ** 3
_GAL_US = F(3785411784, 10 ** 12)                 # m3 (231 in3 exactly)
_GAL_UK = F(454609, 10 ** 8)                      # m3 (4.54609 L)
_LBF = F(44482216152605, 10 ** 13)                # N
_PSI = _LBF / (_IN ** 2)                          # Pa

U: dict[str, Unit] = {}


def _add(dim: str, factor: F, *names: str, **kw) -> None:
    for n in names:
        U[n] = Unit(names[0], dim, factor, **kw)


# length (SI m)
_add("length", F(1), "m", "metre", "metres", "meter", "meters")
_add("length", F(1, 1000), "mm", "millimetre", "millimetres")
_add("length", F(1, 100), "cm", "centimetre", "centimetres")
_add("length", F(1000), "km", "kilometre", "kilometres")
_add("length", _FT, "ft", "foot", "feet", "'")
_add("length", _IN, "in", "inch", "inches", '"')
_add("length", _YD, "yd", "yard", "yards")
_add("length", _MI, "mi", "mile", "miles")
_add("length", _FT_US, "ft_us", "ftUS", "us_survey_foot")
# area (SI m2)
_add("area", F(1), "m2", "m²", "sqm", "sq m", "square metre", "square metres")
_add("area", F(10000), "ha", "hectare", "hectares")
_add("area", _FT ** 2, "ft2", "ft²", "sqft", "sq ft", "square foot", "square feet")
_add("area", _IN ** 2, "in2", "in²")
_add("area", _YD ** 2, "yd2", "yd²")
_add("area", _ACRE, "acre", "acres", "ac")
_add("area", _FT_US ** 2, "ft2_us")
# volume (SI m3)
_add("volume", F(1), "m3", "m³", "cubic metre", "cubic metres")
_add("volume", F(1, 1000), "L", "l", "litre", "litres", "liter", "liters")
_add("volume", F(1), "kL", "kl", "kilolitre", "kilolitres")  # replaced below (kL = 1 m3)
_add("volume", _FT3, "ft3", "ft³", "cf", "cubic foot", "cubic feet")
_add("volume", _YD ** 3, "yd3", "yd³", "cy", "cubic yard", "cubic yards")
_add("volume", _GAL_US, "gal_us", "US gal", "us gallon", "us gallons")
_add("volume", _GAL_UK, "gal_uk", "imp gal", "imperial gallon", "imperial gallons")
# flow (SI m3/s)
_add("flow", F(1, 1000), "L/s", "l/s", "lps")
_add("flow", F(1), "m3/s", "m³/s", "cumec")
_add("flow", _FT3, "cfs", "ft3/s", "ft³/s")
_add("flow", _GAL_US / 60, "gpm_us")
_add("flow", _GAL_UK / 60, "gpm_uk")
_add("flow", F(1, 1000) / 60, "L/min", "lpm")
# pressure (SI Pa)
_add("pressure", F(1), "Pa")
_add("pressure", F(1000), "kPa", "kpa")
_add("pressure", F(1000000), "MPa", "mpa")
_add("pressure", F(100000), "bar")
_add("pressure", _PSI, "psi")
# slope (SI: rise/run, dimensionless fraction)
_add("slope", F(1, 100), "%", "percent", "pct")
_add("slope", F(1), "m/m", "ft/ft", "rise/run")
_add("slope", F(1, 1000), "permille", "‰")
U["deg"] = Unit("deg", "slope", F(0), to_si=lambda v: math.tan(math.radians(v)),
                from_si=lambda s: math.degrees(math.atan(s)))
# ratio "1 in n" (value n); and "n:1" horizontal:vertical (value n) - both store n, meaning rise/run = 1/n
for _nm in ("1:n", "1_in_n"):
    U[_nm] = Unit("1:n", "slope", F(0), to_si=lambda n: 1.0 / n, from_si=lambda s: 1.0 / s)
# dimensionless / counts
_add("count", F(1), "count", "no", "nr", "each")
_add("fraction", F(1), "ratio", "ratio_frac")
# fix kL: 1 kL = 1 m3
U["kL"] = U["kl"] = U["kilolitre"] = U["kilolitres"] = Unit("kL", "volume", F(1))

SI_UNIT = {"length": "m", "area": "m2", "volume": "m3", "flow": "m3/s", "pressure": "Pa", "slope": "m/m",
           "count": "count", "fraction": "ratio"}

# Tokens that need the profile / the user.  token -> options
AMBIGUOUS: dict[str, list[str]] = {
    "gal": ["gal_us (3.785 L)", "gal_uk (4.546 L)"],
    "gallon": ["gal_us", "gal_uk"], "gallons": ["gal_us", "gal_uk"],
    "gpm": ["gpm_us", "gpm_uk"], "gph": ["US", "UK"],
    "ton": ["short ton", "long ton", "tonne"], "tons": ["short ton", "long ton", "tonne"],
    "M": ["metre", "mega/molar"], "FT": ["foot", "(upper-case 'FT' is often a typo or a code)"],
    "ft-in": ["feet and inches (use parse_feet_inches)"],
}


@dataclass(frozen=True)
class UnitContext:
    """Resolves ambiguous tokens.  Normally built from a JurisdictionProfile.unit_context()."""
    gallon: str | None = None           # 'us' | 'imperial'
    case_insensitive: bool = False      # accept 'FT', 'Ft', 'KPA' (profile or user said the document is sloppy)
    foot: str = "international"         # 'international' | 'us_survey' (what a bare 'ft' means)

    def __post_init__(self) -> None:
        if self.gallon not in (None, "us", "imperial"):
            raise ValueError("gallon must be 'us' or 'imperial'")
        if self.foot not in ("international", "us_survey"):
            raise ValueError("foot must be 'international' or 'us_survey'")


NO_CONTEXT = UnitContext()


def parse_unit(token: str, ctx: UnitContext | None = None) -> Unit:
    ctx = ctx or NO_CONTEXT
    t = (token or "").strip()
    if not t:
        raise UnknownUnit("empty unit")
    if t in ("ft", "foot", "feet", "'") and ctx.foot == "us_survey":
        return U["ft_us"]
    if t in U:
        return U[t]
    low = t.lower()
    if low in ("gal", "gallon", "gallons"):
        if ctx.gallon is None:
            raise AmbiguousUnit(t, AMBIGUOUS["gal"], "Set units.gallon in the profile ('us' or 'imperial') or confirm with the user.")
        return U["gal_us" if ctx.gallon == "us" else "gal_uk"]
    if low == "gpm":
        if ctx.gallon is None:
            raise AmbiguousUnit(t, AMBIGUOUS["gpm"], "Set units.gallon in the profile or confirm with the user.")
        return U["gpm_us" if ctx.gallon == "us" else "gpm_uk"]
    if t in AMBIGUOUS and not (ctx.case_insensitive and low in U):
        raise AmbiguousUnit(t, AMBIGUOUS[t], "Ask the user or set it in the jurisdiction profile.")
    if ctx.case_insensitive:
        for k, u in U.items():
            if k.lower() == low:
                return u
        if low in ("ft", "foot", "feet"):
            return U["ft_us"] if ctx.foot == "us_survey" else U["ft"]
    raise UnknownUnit(f"unknown unit {t!r}" + (" (case differs from the known spelling; confirm it)" if any(k.lower() == low for k in U) else ""))


def dimension_of(token: str, ctx: UnitContext | None = None) -> str:
    return parse_unit(token, ctx).dim


def to_si(value: float, unit: str, ctx: UnitContext | None = None) -> float:
    u = parse_unit(unit, ctx)
    if u.to_si is not None:
        return u.to_si(value)
    return float(F(value) * u.factor)


def from_si(value: float, unit: str, ctx: UnitContext | None = None) -> float:
    u = parse_unit(unit, ctx)
    if u.from_si is not None:
        return u.from_si(value)
    return float(F(value) / u.factor)


def convert(value: float, from_unit: str, to_unit: str, ctx: UnitContext | None = None) -> float:
    a, b = parse_unit(from_unit, ctx), parse_unit(to_unit, ctx)
    if a.dim != b.dim:
        raise UnitMismatch(f"cannot convert {a.name} ({a.dim}) to {b.name} ({b.dim})")
    if a.to_si is None and b.to_si is None:
        return float(F(value) * a.factor / b.factor)
    si = a.to_si(value) if a.to_si else float(F(value) * a.factor)
    return b.from_si(si) if b.from_si else float(F(si) / b.factor)


# ---------------------------------------------------------------------------- slope & feet-inches helpers

_SLOPE_RATIO = re.compile(r"^\s*(?:(\d+(?:\.\d+)?)\s*(?:v|vert)?\s*(?::|in|/)\s*(\d+(?:\.\d+)?)\s*(?:h|horiz)?)\s*$", re.I)


def parse_slope(text: str) -> float:
    """'8.33%' | '1:12' | '1 in 12' | '1V:12H' | '0.0833' -> rise/run fraction.  '12:1' is read as rise:run = 12:1."""
    t = text.strip()
    if t.endswith("%"):
        return float(t[:-1]) / 100.0
    m = _SLOPE_RATIO.match(t.replace("v", "V").replace("h", "H").replace("V", "v").replace("H", "h"))
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        if b == 0:
            raise UnitError("slope ratio with zero run")
        return a / b
    try:
        return float(t)
    except ValueError as ex:
        raise UnknownUnit(f"cannot read slope {text!r}") from ex


def format_slope(frac: float, style: str = "%", precision: int = 1) -> str:
    if style == "%":
        return f"{frac * 100:.{precision}f}%"
    if style in ("ratio", "1:n"):
        return "level" if frac == 0 else f"1:{1.0 / abs(frac):.{precision}f}"
    raise UnitError(f"unknown slope style {style!r}")


_FTIN = re.compile(r"""^\s*(?:(?P<ft>-?\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*-?\s*)?(?:(?P<in>\d+(?:\.\d+)?)(?:\s+(?P<num>\d+)\s*/\s*(?P<den>\d+))?\s*(?:"|in|inch|inches)?)?\s*$""")


def parse_feet_inches(text: str) -> float:
    """Feet-and-inches text -> metres.  Examples: 5'-6", 5' 6 1/2", 5ft 6in, 18", 5'."""
    t = text.strip()
    m = _FTIN.match(t)
    if not m or not (m.group("ft") or m.group("in")):
        raise UnknownUnit(f"cannot read feet-inches {text!r}")
    ft = F(m.group("ft") or 0)
    inch = F(m.group("in") or 0)
    if m.group("num"):
        inch += F(int(m.group("num")), int(m.group("den")))
    neg = ft < 0
    total_in = abs(ft) * 12 + inch
    return float((-total_in if neg else total_in) * _IN)


def format_feet_inches(metres: float, denominator: int = 16) -> str:
    """Metres -> 5'-6 1/2" (nearest 1/denominator inch)."""
    total = F(metres) / _IN
    sign = "-" if total < 0 else ""
    total = abs(total)
    q = round(total * denominator)
    inches_total, frac = divmod(q, denominator)
    ft, inch = divmod(int(inches_total), 12)
    s = f"{ft}'-{inch}"
    if frac:
        g = math.gcd(frac, denominator)
        s += f" {frac // g}/{denominator // g}"
    return f'{sign}{s}"'


# ---------------------------------------------------------------------------- Quantity


@dataclass(frozen=True)
class Quantity:
    value: float
    unit: str
    ctx: UnitContext | None = None

    @property
    def dim(self) -> str:
        return dimension_of(self.unit, self.ctx)

    @property
    def si(self) -> float:
        return to_si(self.value, self.unit, self.ctx)

    def to(self, unit: str) -> "Quantity":
        return Quantity(convert(self.value, self.unit, unit, self.ctx), unit, self.ctx)

    def _same(self, o: "Quantity") -> float:
        if self.dim != o.dim:
            raise UnitMismatch(f"{self.unit} ({self.dim}) vs {o.unit} ({o.dim})")
        return o.to(self.unit).value

    def __add__(self, o: "Quantity") -> "Quantity":
        return Quantity(self.value + self._same(o), self.unit, self.ctx)

    def __sub__(self, o: "Quantity") -> "Quantity":
        return Quantity(self.value - self._same(o), self.unit, self.ctx)

    def __mul__(self, k):
        if isinstance(k, Quantity):
            if self.dim == "length" and k.dim == "length":
                return Quantity(self.si * k.si, "m2")
            if self.dim == "area" and k.dim == "length" or self.dim == "length" and k.dim == "area":
                return Quantity(self.si * k.si, "m3")
            raise UnitMismatch(f"no product defined for {self.dim} x {k.dim}")
        return Quantity(self.value * k, self.unit, self.ctx)

    __rmul__ = __mul__

    def __lt__(self, o: "Quantity") -> bool:
        return self.value < self._same(o)

    def __le__(self, o: "Quantity") -> bool:
        return self.value <= self._same(o)

    def approx(self, o: "Quantity", rel: float = 1e-9) -> bool:
        return math.isclose(self.si, o.si, rel_tol=rel, abs_tol=1e-12)


def parse_quantity(text: str, ctx: UnitContext | None = None) -> Quantity:
    """'3.5 m', '12 ft', '8.33 %', '1:12' (slope), '5\\'-6\"' (feet-inches)."""
    t = text.strip()
    if "'" in t or '"' in t:
        return Quantity(parse_feet_inches(t), "m", ctx)
    if re.match(r"^\d+(\.\d+)?\s*(v\s*)?(:|\s+in\s+)\s*\d", t, re.I):
        return Quantity(parse_slope(t), "m/m", ctx)
    m = re.match(r"^\s*(-?\d[\d,]*(?:\.\d+)?)\s*(.+?)\s*$", t)
    if not m:
        raise UnknownUnit(f"cannot read quantity {text!r}")
    return Quantity(float(m.group(1).replace(",", "")), m.group(2), ctx)


def ensure_dimension(unit: str, expected: str, ctx: UnitContext | None = None) -> None:
    d = dimension_of(unit, ctx)
    if d != expected:
        raise UnitMismatch(f"unit {unit!r} is {d}, expected {expected}")


def detect_unit_tokens(text: str) -> set[str]:
    """Unit-looking tokens appearing in document text (for confirming against the profile)."""
    found = set()
    for m in re.finditer(r"(?<![A-Za-z])(\d[\d,.]*)\s*(mm|m2|m²|m|ft|FT|feet|in|gal|gpm|psi|kPa|acres?|ha|L|cfs|yd)\b", text):
        found.add(m.group(2))
    return found
