"""JurisdictionProfile, CRS validation, locale, vehicle slots, DB migration shape."""
from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.jurisdiction.profile import (CrsSettings, ImageryConfig, JurisdictionProfile, LocaleSettings, ProfileError, UnitSettings,
                                      VehicleSlot, builtin_profile, crs_info, make_profile, utm_epsg_for)


def test_geographic_crs_rejected_for_metric_work():
    with pytest.raises(ValidationError, match="geographic"):
        CrsSettings(horizontal_epsg=4326)
    with pytest.raises(ValidationError, match="geographic"):
        CrsSettings(horizontal_epsg=32614, working_epsg=4326)


def test_unknown_epsg_rejected():
    with pytest.raises(ValidationError, match="not a known"):
        CrsSettings(horizontal_epsg=999999)


def test_utm_is_its_own_working_crs():
    c = CrsSettings(horizontal_epsg=32633, vertical_datum="EVRF2019")
    assert c.working_epsg == 32633 and c.horizontal_in_metres


def test_geographic_with_anchor_derives_utm():
    c = CrsSettings(horizontal_epsg=4326, anchor_lonlat=(-97.7, 30.3))
    assert c.working_epsg == utm_epsg_for(-97.7, 30.3) == 32614
    assert CrsSettings(horizontal_epsg=4326, anchor_lonlat=(151.2, -33.9)).working_epsg == 32756


def test_state_plane_feet_needs_metric_working_crs():
    assert crs_info(2277)["metres_per_unit"] == pytest.approx(0.3048006096)     # Texas Central (US survey ft)
    with pytest.raises(ValidationError, match="not metres"):
        CrsSettings(horizontal_epsg=2277)
    c = CrsSettings(horizontal_epsg=2277, working_epsg=32614)
    x, y = c.to_working(3100000.0, 10070000.0)
    assert 600000 < x < 800000 and 3000000 < y < 3500000
    with pytest.raises(ValidationError, match="feet|metres"):
        CrsSettings(horizontal_epsg=32614, working_epsg=2277)


def test_unit_systems_and_display_units():
    u = UnitSettings(system="imperial_us")
    assert (u.length, u.area, u.flow, u.pressure, u.gallon) == ("ft", "ft2", "gpm_us", "psi", "us")
    assert UnitSettings(system="imperial_uk").gallon == "imperial"
    assert UnitSettings(system="metric").context().gallon is None
    assert UnitSettings(system="imperial_us", area="acre", slope="ratio").area == "acre"
    with pytest.raises(ValidationError):
        UnitSettings(system="metric", length="furlong")
    with pytest.raises(ValidationError):
        UnitSettings(system="metric", pressure="m")


def test_locale_decimal_comma_and_dates():
    loc = LocaleSettings(decimal_separator=",", thousands_separator=".", date_format="%d.%m.%Y")
    assert loc.number(1234.5) == "1.234,50"
    assert loc.number(-0.004) == "0,00"
    assert LocaleSettings().number(1234.5) == "1234.50"
    with pytest.raises(ValidationError):
        LocaleSettings(decimal_separator=",", thousands_separator=",")


def test_vehicle_slots_are_empty_but_editable_and_no_aashto_values_asserted():
    p = make_profile("Test County", horizontal_epsg=32614, system="imperial_us", standards=["AASHTO", "local standard"])
    names = {v.name: v for v in p.vehicles}
    assert names["B85"].library == "AS/NZS 2890.1" and names["B85"].complete and not names["B85"].verified
    for n in ("P", "SU-30", "WB-40"):
        assert not names[n].complete and names[n].length_m is None
        with pytest.raises(ProfileError, match="empty"):
            names[n].to_swept()
    p.vehicle("SU-30").length_m = 9.0       # editable
    assert p.vehicle("SU-30").length_m == 9.0
    assert names["B85"].to_swept().name == "B85"
    assert p.standards_note() == "Standards cited: AASHTO; local standard"


def test_imagery_requires_url_when_enabled():
    assert ImageryConfig().kind == "none"
    with pytest.raises(ValidationError):
        ImageryConfig(kind="xyz_template")
    assert ImageryConfig(kind="xyz_template", url_template="https://t.example/{z}/{x}/{y}.png").kind == "xyz_template"


def test_roundtrip_json_and_db_row():
    p = make_profile("Test", horizontal_epsg=32633, country="DE", municipality="Teststadt", languages=["de"])
    q = JurisdictionProfile.model_validate_json(p.model_dump_json())
    assert q == p
    row = p.to_db_row()
    assert row["municipality"] == "Teststadt" and row["config"]["crs"]["working_epsg"] == 32633
    assert builtin_profile("NSW").cadastre_source.kind == "nsw" and p.cadastre_source.kind == "custom"
    assert p.legal_pack_key == "generic_international"


def test_north_offsets():
    c = CrsSettings(horizontal_epsg=32614, north_reference="magnetic", declination_deg=3.0, grid_convergence_deg=-0.5)
    assert c.north_offset_deg() == pytest.approx(3.5)
    assert CrsSettings(horizontal_epsg=32614).north_offset_deg() == 0.0
    assert CrsSettings(horizontal_epsg=32614, north_reference="true", grid_convergence_deg=1.0).north_offset_deg() == -1.0


def test_migration_file_shape():
    sql = (Path(__file__).resolve().parents[2] / "db" / "006_jurisdictions.sql").read_text()
    assert "CREATE TABLE core.jurisdiction_profiles" in sql
    assert "ENABLE ROW LEVEL SECURITY" in sql and "CREATE POLICY p_jprofile_select" in sql
    assert "quote_en_machine_translated" in sql and sql.count("BEGIN;") == 1 and sql.count("COMMIT;") == 1
