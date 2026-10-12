"""Fetch the pathway source documents into raw/ (git-ignored) and write sources.json (url, sha256, retrieved_at, status).

    python -I knowledge/pathway/fetch_pathway_docs.py            # download (browser User-Agent) + record
    python -I knowledge/pathway/fetch_pathway_docs.py --verify   # offline: re-hash raw/ against sources.json

legislation.nsw.gov.au (Codes SEPP, Housing SEPP, EP&A Regulation, Gunnedah LEP) is behind a Cloudflare challenge
(403 for curl and headless Chromium, incl. 8 s wait); those are recorded as status=blocked and stay UNRESOLVED.
"""
from __future__ import annotations
import hashlib, json, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
S3 = "https://s3-ap-southeast-2.amazonaws.com/shared-drupal-s3fs/master-test/fapub_pdf"
G = "https://www.gunnedah.nsw.gov.au/index.php/list-files/preview?path=GunnedahShireCouncil%252F"
GF = G + "COUNCIL%252FCOUNCIL-INFORMATION%252FAll-Council-Application-Forms%252FPlanning-Application-Forms%252F"
PP = "https://www.planningportal.nsw.gov.au"
SRC = [
 dict(id="inland_std_res", file="inland_standard_res.pdf", title="Inland Code - Summary of Development Standards, Residential zones R1-R4 and RU5, Standard Lot", authority="NSW Department of Planning and Environment", version="October 2018", url=f"{S3}/Inland/Standard+lot+Residential+zones+Inland+Code+20181016.pdf", kind="code_summary"),
 dict(id="inland_rural", file="inland_rural.pdf", title="Inland Code - Summary of Development Standards, Rural zones RU1, RU2, RU3, RU4 and RU6, All Lot Types", authority="NSW Department of Planning and Environment", version="October 2018", url=f"{S3}/Inland/All+lot+types+rural+zones+20181016.pdf", kind="code_summary"),
 dict(id="inland_farm_cdc", file="inland_farm_cdc.pdf", title="Inland Code - Farm Building Standards - Summary of Development Standards", authority="NSW Department of Planning and Environment", version="October 2018", url=f"{S3}/Inland/Farm+buildings+Complying+Inland+20181011.pdf", kind="code_summary"),
 dict(id="exempt_farm", file="inland_farm_exempt.pdf", title="Farm Buildings as Exempt Development - Summary of Development Standards", authority="NSW Department of Planning and Environment", version="October 2018", url=f"{S3}/Inland/Farm+buildings+Exempt+Inland+amendments+20181016.pdf", kind="code_summary"),
 dict(id="housing_std", file="housing_standard.pdf", title="Housing Code - Summary of Development Standards, Standard Lot", authority="NSW Department of Planning and Environment", version="June 2018", url=f"{S3}/Development+Standards/Development+Standards+Summary+Table+-+Standard+Lot.pdf", kind="code_summary"),
 dict(id="inland_faq", file="inland_faq.pdf", title="Inland Code - Frequently asked questions", authority="NSW Department of Planning and Environment", version="2023", url="https://www.planning.nsw.gov.au/sites/default/files/2023-03/inland-code-faq.pdf", kind="faq"),
 dict(id="inland_lga_map", file="inland_map.jpg", title="Inland Code LGA map (69 LGAs; image, read visually: Gunnedah = no. 30, Inland Code applies)", authority="NSW Department of Planning and Environment", version="2023-05", url="https://www.planning.nsw.gov.au/sites/default/files/2023-05/inland-code-lga-map-2400x2263.jpg", kind="map"),
 dict(id="pp_housing_code", file="pp_housing_code.html", title="Housing Code (NSW Planning Portal)", authority="NSW Planning Portal", version="page text, retrieved", url=f"{PP}/development-assessment/codes-sepp/housing-code", kind="portal_page"),
 dict(id="pp_inland_code", file="pp_inland_code.html", title="Inland Code for NSW (NSW Planning Portal)", authority="NSW Planning Portal", version="Last updated 14/09/2022", url=f"{PP}/development-assessment/codes-sepp/inland-code-nsw", kind="portal_page"),
 dict(id="pp_local_development", file="pp_local_development.html", title="Local Development (NSW Planning Portal)", authority="NSW Planning Portal", version="page text, retrieved", url=f"{PP}/local-development", kind="portal_page"),
 dict(id="pp_exempt_development", file="pp_exempt_development.html", title="Exempt Development (NSW Planning Portal)", authority="NSW Planning Portal", version="Last updated 07/02/2025", url=f"{PP}/development-and-assessment/planning-approval-pathways/exempt-development", kind="portal_page"),
 dict(id="pp_granny_flats", file="pp_granny_flats.html", title="Granny Flats (NSW Planning Portal)", authority="NSW Planning Portal", version="Last updated 30/04/2025", url=f"{PP}/development-and-assessment/planning-approval-pathways/complying-development/granny-flats", kind="portal_page"),
 dict(id="g_fact1", file="g_fact1.pdf", title="Gunnedah Shire Council Fact Sheet No. 1 - Development Application Documentation Checklist", authority="Gunnedah Shire Council", version="undated", url=G + "DEVELOPMENT-PLANNING-AND-BUILDING%252FDO-I-NEED-APPROVAL%252FLodging-an-Application%252FFact%2BSheet%2B1%2B-%2BDA%2BDocumentation%2BChecklist.pdf", kind="council_checklist"),
 dict(id="g_da_checklist", file="g_da_checklist.pdf", title="Gunnedah Shire Council Development Application Lodgement Checklist", authority="Gunnedah Shire Council", version="Last updated 06/03/2025", url=GF + "Form%2B-%2BDevelopment%2BApplication%2BLodgement%2BChecklist.pdf", kind="council_checklist"),
 dict(id="g_cdc_checklist", file="g_cdc_checklist.pdf", title="Gunnedah Shire Council Complying Development Certificate Lodgement Checklist", authority="Gunnedah Shire Council", version="Last updated January 2021", url=GF + "Form%2B-%2BComplying%2BDevelopment%2BCertificate%2BLodgement%2BChecklist.pdf", kind="council_checklist"),
 dict(id="g_soee_form", file="g_soee_form.pdf", title="Gunnedah Shire Council Statement of Environmental Effects (single dwelling houses, residential ancillary and outbuilding developments)", authority="Gunnedah Shire Council", version="Last updated 15 August 2023", url=GF + "Form%2B-%2BStatement%2Bof%2BEnvironmental%2BEffects.pdf", kind="council_form"),
]
BLOCKED = [
 dict(id="codes_sepp_2008", title="SEPP (Exempt and Complying Development Codes) 2008", url="https://legislation.nsw.gov.au/view/html/inforce/current/epi-2008-0572", reason="Cloudflare 'Just a moment' 403 for curl and headless Chromium (browser UA, 8 s wait); /EPIs/2018-569.pdf also 403"),
 dict(id="housing_sepp_2021", title="SEPP (Housing) 2021 incl. Schedule 1 secondary dwelling CDC standards", url="https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714", reason="same Cloudflare block"),
 dict(id="epa_reg_2021", title="Environmental Planning and Assessment Regulation 2021 (Schedule 1 / cl 24 DA content, Schedule 3)", url="https://legislation.nsw.gov.au/view/html/inforce/current/sl-2021-0759", reason="same Cloudflare block"),
 dict(id="gunnedah_lep_2012", title="Gunnedah Local Environmental Plan 2012 (land use tables, cl 4.1, 4.3, 5.4)", url="https://legislation.nsw.gov.au/view/html/inforce/current/epi-2012-0304", reason="same Cloudflare block"),
 dict(id="rural_housing_code_summary", title="Rural Housing Code summary tables / Part 3C", url="", reason="no obtainable URL found on planning.nsw.gov.au / planningportal.nsw.gov.au; Gunnedah is an Inland Code LGA so the Inland Code rural table is used instead"),
 dict(id="portal_soee_guide", title="NSW Planning Portal SoEE guide / EP&A Regulation Schedule 1 content list", url="", reason="no official SoEE guide located; Gunnedah Council SoEE form used as the structure source"),
 dict(id="pbp_2019", title="Planning for Bush Fire Protection 2019 (BAL/APZ)", url="https://www.rfs.nsw.gov.au/plan-and-prepare/building-in-a-bush-fire-area/planning-for-bush-fire-protection", reason="see ../manifest.json nsw_pbp_2019"),
]

def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

def main() -> None:
    RAW.mkdir(exist_ok=True)
    if "--verify" in sys.argv:
        m = json.loads((HERE / "sources.json").read_text()); bad = 0
        for s in m["sources"]:
            p = RAW / s["file"]
            ok = p.exists() and sha(p) == s["sha256"]; bad += not ok
            print("OK " if ok else "BAD", s["id"])
        sys.exit(1 if bad else 0)
    out = []
    for s in SRC:
        p = RAW / s["file"]
        try:
            if not p.exists():
                req = urllib.request.Request(s["url"], headers={"User-Agent": UA})
                p.write_bytes(urllib.request.urlopen(req, timeout=60).read())
            out.append({**s, "status": "obtained", "sha256": sha(p), "bytes": p.stat().st_size,
                        "retrieved_at": datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")})
        except Exception as e:  # noqa: BLE001
            out.append({**s, "status": "blocked", "reason": str(e)})
    (HERE / "sources.json").write_text(json.dumps({"schema": 1, "sources": out, "blocked": BLOCKED}, indent=1))
    print(sum(o["status"] == "obtained" for o in out), "obtained")

if __name__ == "__main__":
    main()
