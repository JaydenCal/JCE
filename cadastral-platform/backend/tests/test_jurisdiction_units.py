"""units.py: exact conversion, ambiguity handling, slopes, feet-inches."""
from __future__ import annotations

import math

import pytest

from app.jurisdiction.units import (AmbiguousUnit, Quantity, UnitContext, UnitMismatch, UnknownUnit, convert, format_feet_inches,
                                    format_slope, parse_feet_inches, parse_quantity, parse_slope, to_si)

US = UnitContext(gallon="us")
UK = UnitContext(gallon="imperial")


def test_exact_factors():
    assert convert(1, "ft", "m") == 0.3048
    assert convert(1, "in", "m") == 0.0254
    assert convert(1, "yd", "ft") == 3.0
    assert convert(1, "acre", "m2") == pytest.approx(4046.8564224, rel=0, abs=1e-9)
    assert convert(1, "acre", "ft2") == 43560.0
    assert convert(1, "ha", "acre") == pytest.approx(2.4710538146717, rel=1e-12)
    assert convert(1, "gal_us", "L") == 3.785411784
    assert convert(1, "gal_uk", "L") == 4.54609
    assert convert(1, "ft3", "L") == pytest.approx(28.316846592, abs=1e-9)
    assert convert(1, "psi", "kPa") == pytest.approx(6.894757293168, rel=1e-12)
    assert convert(1, "cfs", "L/s") == pytest.approx(28.316846592, abs=1e-9)
    assert convert(60, "gpm_us", "L/s") == pytest.approx(3.785411784, abs=1e-9)


@pytest.mark.parametrize("unit,other", [("ft", "m"), ("in", "m"), ("acre", "m2"), ("ft2", "m2"), ("gal_us", "L"), ("gal_uk", "L"),
                                        ("yd3", "m3"), ("psi", "kPa"), ("cfs", "L/s"), ("ha", "acre"), ("ft_us", "m")])
@pytest.mark.parametrize("v", [0.0, 1.0, 0.1, 12.34, 1234567.891])
def test_round_trip(unit, other, v):
    assert convert(convert(v, unit, other), other, unit) == pytest.approx(v, rel=1e-12, abs=1e-12)


def test_gallon_never_guessed():
    with pytest.raises(AmbiguousUnit):
        convert(1, "gal", "L")
    with pytest.raises(AmbiguousUnit):
        convert(1, "gpm", "L/s")
    assert convert(1, "gal", "L", US) == 3.785411784
    assert convert(1, "gal", "L", UK) == 4.54609
    assert convert(1, "gpm", "L/s", UK) != convert(1, "gpm", "L/s", US)


def test_case_ambiguity_needs_profile_or_confirmation():
    with pytest.raises(AmbiguousUnit):
        convert(10, "FT", "m")
    with pytest.raises(UnknownUnit):
        convert(10, "Ft", "m")
    assert convert(10, "FT", "m", UnitContext(case_insensitive=True)) == pytest.approx(3.048)
    with pytest.raises(AmbiguousUnit):
        convert(1, "M", "m")


def test_survey_foot_is_explicit():
    assert convert(1, "ft", "m") == 0.3048
    assert convert(1, "ft_us", "m") == pytest.approx(1200 / 3937, abs=1e-15)
    assert convert(1, "ft", "m", UnitContext(foot="us_survey")) == pytest.approx(1200 / 3937, abs=1e-15)
    assert abs(convert(1, "ft_us", "m") - 0.3048) == pytest.approx(6.096e-7, rel=1e-3)


def test_dimension_mismatch():
    with pytest.raises(UnitMismatch):
        convert(1, "m", "m2")
    with pytest.raises(UnitMismatch):
        convert(1, "L", "kPa")
    with pytest.raises(UnitMismatch):
        Quantity(1, "m") + Quantity(1, "m2")
    with pytest.raises(UnknownUnit):
        convert(1, "furlongs", "m")


def test_slopes_ratio_vs_percent():
    assert parse_slope("1:12") == pytest.approx(1 / 12)
    assert parse_slope("1:12") * 100 == pytest.approx(8.3333333, rel=1e-6)
    assert parse_slope("8.33%") == pytest.approx(0.0833)
    assert parse_slope("1 in 20") == pytest.approx(0.05)
    assert parse_slope("1V:12H") == pytest.approx(1 / 12)
    assert convert(12, "1:n", "%") == pytest.approx(8.3333333, rel=1e-6)
    assert convert(8.333333333, "%", "1:n") == pytest.approx(12.0, rel=1e-6)
    assert convert(100, "%", "deg") == pytest.approx(45.0)
    assert format_slope(1 / 12, "ratio", 0) == "1:12"
    assert format_slope(0.0833, "%") == "8.3%"
    # 1:12 and 8.33% are NOT identical: 8.33% is 1:12.005
    assert 1 / parse_slope("8.33%") == pytest.approx(12.0048, rel=1e-4)
    with pytest.raises(UnitMismatch):
        convert(5, "%", "m")


def test_feet_inches():
    assert parse_feet_inches("5'-6\"") == pytest.approx(5.5 * 0.3048)
    assert parse_feet_inches("5' 6 1/2\"") == pytest.approx((5 * 12 + 6.5) * 0.0254)
    assert parse_feet_inches("18\"") == pytest.approx(0.4572)
    assert parse_feet_inches("5ft 6in") == pytest.approx(1.6764)
    assert parse_feet_inches("10'") == pytest.approx(3.048)
    assert format_feet_inches(1.6764) == "5'-6\""
    assert format_feet_inches((5 * 12 + 6.5) * 0.0254) == "5'-6 1/2\""
    with pytest.raises(UnknownUnit):
        parse_feet_inches("abc")


def test_parse_quantity_and_quantity_math():
    q = parse_quantity("12 ft")
    assert q.dim == "length" and q.si == pytest.approx(3.6576)
    assert parse_quantity("1:12").si == pytest.approx(1 / 12)
    assert parse_quantity("5'-0\"").to("m").value == pytest.approx(1.524)
    area = parse_quantity("10 ft") * parse_quantity("20 ft")
    assert area.to("ft2").value == pytest.approx(200.0)
    assert (parse_quantity("1 m") + parse_quantity("1 ft")).value == pytest.approx(1.3048)
    assert parse_quantity("3 ft") < parse_quantity("1 m")
    with pytest.raises(AmbiguousUnit):
        parse_quantity("5 gal").si


def test_exactness_no_float_drift():
    # 1000 ft -> m -> ft must be exactly 1000
    assert convert(convert(1000.0, "ft", "m"), "m", "ft") == 1000.0
    assert to_si(1, "acre") == pytest.approx(4046.8564224, abs=1e-9)
    assert math.isclose(convert(3, "mi", "ft"), 15840.0)
