"""Licence / attribution records per imagery provider (QLD record added 15/10/2026 from the ImageServer metadata).

NSW text below is quoted VERBATIM from the ArcGIS REST service metadata read on 2026-10-12:
  https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer?f=json
No licence (e.g. CC-BY) is asserted because the service metadata does not state one; the metadata link
points to the SDI catalogue record. Verify terms before commercial use.
"""
from __future__ import annotations

from dataclasses import dataclass

VERIFY = "Licence terms not stated in service metadata: verify terms before commercial use."


@dataclass(frozen=True)
class LicenceRecord:
    provider: str
    copyright_text: str
    service_description: str
    metadata_link: str
    attribution: str
    licence_note: str = VERIFY
    verified: bool = True   # True = text read from the live service metadata

    def line(self) -> str:
        return f"{self.attribution}. {self.licence_note}"


NSW_LICENCE = LicenceRecord(
    provider="nsw_imagery",
    copyright_text="© Department of Customer Service 2020",
    service_description=(
        "Progressively from scales larger than 1:150,000 higher resolution imagery overlays lower resolution imagery "
        "and most recent imagery overlays older imagery within each resolution.\n"
        "This service includes external imagery sourced from © AAM 2011,2012; © Jacobs Group Ausimage "
        "2002,2006,2009,2014; © LANDSAT 2014\n"
        "Metadata_link http://sdi.nsw.gov.au/catalog/search/resource/details.page?uuid=%7BA9550CB1-5908-4A47-936F-64AE50405DF7%7D"),
    metadata_link="http://sdi.nsw.gov.au/catalog/search/resource/details.page?uuid=%7BA9550CB1-5908-4A47-936F-64AE50405DF7%7D",
    attribution="Imagery: NSW Spatial Services © Department of Customer Service 2020 (includes third-party imagery: AAM, Jacobs Group Ausimage, LANDSAT)",
)
QLD_LICENCE = LicenceRecord(
    provider="qld_imagery",
    copyright_text="Includes material (c) State of Queensland (Department of Natural Resources and Mines ...), with third-party credits (Planet Labs, Geoplex), all rights reserved, 2026 "
                   "(opening and closing words of the service copyrightText, read 15/10/2026; the middle of the text was not visible)",
    service_description="Latest publicly released State Remotely Sensed Image Library aerial imagery (SISP, openly released once three years old) with satellite fill where aerial coverage is missing.",
    metadata_link="Queensland Spatial Catalogue (QSpatial), per the item metalink",
    attribution="Imagery: Queensland Government, State Remotely Sensed Image Library (aerial imagery with satellite fill); see the service copyright text for full credits",
    licence_note="Licence name not stated in the service metadata (copyright text only): verify terms before commercial use.", verified=True)
FAKE_LICENCE = LicenceRecord(provider="fake", copyright_text="", service_description="", metadata_link="",
                             attribution="Synthetic test imagery", licence_note="Test only.", verified=False)
