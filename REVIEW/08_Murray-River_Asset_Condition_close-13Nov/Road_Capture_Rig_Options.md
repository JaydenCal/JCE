# Road capture rig options: JCE self-capture for MRC-2645

Prepared 12/10/2026 for Jayden Callen, JCE Infrastructure. Desk research only. Nothing has been bought, hired, quoted or signed up for.

**Job:** about 3,000 km of road (1,110 km sealed, 1,890 km unsealed), geo-referenced stills every 10 m, kerb to kerb or table drain to table drain plus roadside both sides, GPS and date/time embedded in each image (DRFA evidence), capture 08/02/2027 to 30/04/2027, desktop rating afterwards. Rolling zones follow: Barham 809 km (2028), Mathoura 864 km (2029), Moama 474 km (2030), Moulamein 842 km (2031).

**Price conventions:** "AU$ listed" means a price shown on an Australian retailer or store page (snapshot, check before buying). "Est." means my estimate, not a quote. USD prices are converted at A$1 = US$0.65 (assumption). Where no price is published, the table says "quote only".

**Volume:** 3,000 km at 10 m spacing is about 300,000 capture points. At 15 to 25 MB per 360 still, allow 5 to 8 TB for Year 1 (est.), held twice (working copy plus offsite backup).

---

## 1. Decision table

| Option | Cost to buy | Cost to lease / hire | Accuracy and DRFA compliance | Pros | Cons |
|---|---|---|---|---|---|
| **A. Budget: consumer 360 + RTK logger** (Insta360 X5 or GoPro MAX2, Emlid Reach M2 or RS3 on AUSCORS / CORSnet-NSW NTRIP, roof-rack clamp with steel tether) | X5 AU$930 listed (seen discounted to about AU$790); X4 about AU$520 to AU$750 listed; GoPro MAX2 AU$849 listed; Reach M2 module AU$1,199 to AU$1,249 listed; Reach RS3 AU$4,799 listed (Emlid AU store, backorder). Rig with spare camera, mount and 2 x 8 TB storage: **about A$6k to A$10k (est.)** | Not applicable (cheap enough to buy). Chattel mortgage on A$7k over 4 years at 9.5% is about A$176/month (est.) | Consumer cameras do not trigger by distance, and interval photos are too slow (GoPro MAX timelapse floor reported at 2 s, about 33 m at 60 km/h). Practical method: record 8K 360 video, log RTK track, extract a frame every 10 m and **write GPS and time into EXIF afterwards** (exiftool or mapillary_tools). Mapillary reports Insta360 interval mode only tags the first photo, and X5 video had no GPS until a track was injected. Position about 0.5 to 1 m after time sync (est.). Frames are compressed video, weaker for fine cracking. **Does not meet "GPS embedded natively" as written in JCE's Fee Proposal (section 6, roads).** | Very cheap; uses Jayden's RTK and NTRIP skills; ideal for a trial now and as a backup camera | Post-processed geotags (audit risk); suction mounts rated to 80 to 100 km/h only, so use a roof rack; heat, dust and battery management on 3,000 km of gravel; more processing time |
| **B1. Mid: dedicated 360 mapping camera + RTK** (Mosaic 51 or Mosaic X with Emlid RS3; Labpano Pilot Era) | Mosaic 51 / X: **quote only** (not published). Mosaic plus RS3 plus mount and storage: **A$40k to A$80k (est., confirm by quote)**. Labpano Pilot Era: USD 2,799 in 2020 (about A$4.3k), built-in consumer GPS | No Australian hire rate found. Ask UPG/SITECH, C.R. Kennedy and Position Partners. 4-year chattel mortgage on A$60k at 9.5% is about A$1,507/month, A$72k total (est.) | Mosaic 51: six 12 MP sensors, 72 MP equirectangular stills, IP64/IP67; vendor shows Emlid RS2/RS3 integration giving centimetre-level positions, written per image at capture. Meets "native" GPS in each still (confirm EXIF fields in a sample set). Pilot Era: native GPS but consumer accuracy (metres) | True stills at distance intervals; native geotags; one-person operation; reusable for future councils; Mosaic Xplor backpack option for footpaths | Price unknown until quoted; overseas vendor support; processing software terms to confirm |
| **B2. Mid: survey-brand mobile imaging** (Trimble MX7; Imajing ImajBox 360) | Trimble MX7: US dealer "regular price" USD 59,995 (about **A$92k**), used calibrated unit USD 14,995 (about A$23k) on the same dealer site. ImajBox: **quote only** | No Australian MX7 hire listing found; UPG/SITECH rent Trimble X7 scanners and GNSS, so ask | Integrated GNSS/IMU, georeferenced 360 stills, processed in Trimble Business Center (Mobile Mapping subscription, price on quote). ImajBox is road-asset focused, with Imajview software. Native geotags | Survey-grade positioning, Australian Trimble dealer support; ImajBox purpose-built for roads | MX7 is ageing (check HW 3.0 and support life); TBC subscription cost; used units import, calibration and warranty risk |
| **C. Professional mobile mapping (lidar)** (Trimble MX50/MX90, Leica Pegasus TRK) | **Quote only**; no price published. Generally several hundred thousand dollars (est.) | No Australian hire rate found | Survey-grade point cloud plus imagery | Highest quality | Far beyond this job; overkill for visual condition rating. Listed for scale only |
| **D. Contract capture only** (partner drives and supplies geotagged stills; JCE rates and does GIS) | n/a | Price per km not published. Ask in the RFQ. Year 1 partner price for capture **and** rating is PS1 A$255,035 incl. 10% mark-up | Partner's system, usually native GNSS stills (for example DCPM 4WDs with roof 360 cameras at Snowy Monaro; RACAS stills every 10 m) | Keeps experience credit in the tender; partner carries weather and equipment risk; no capex | Margin stays with partner; JCE carries rating workload |
| **E. Full partner (current tender model)** | n/a | A$255,035 Year 1 (PS1); rolling years pro rata about A$40k to A$75k a year (est.) | Partner's system | Lowest delivery risk; strongest response to the 20% experience criterion | Highest cost; no asset built for future councils |

---

## 2. Capture days: one rig or two

**Productive capture days (both sides in one pass with a 360 system):**

| Road type | Length | Rate per day | Days |
|---|---|---|---|
| Sealed (incl. 133 km urban) | 1,110 km | 150 to 200 km | 5.6 to 7.4 |
| Unsealed | 1,890 km | 100 to 150 km | 12.6 to 18.9 |
| **Base total** | 3,000 km | | **18 to 26** |
| Dead running, dead-end returns, 500 m past zone boundaries (+20%) | | | +4 to 5 |
| Re-runs for blur, glare, dust or GNSS outages (+5%) | | | +1 to 1.5 |
| Moama pilot (already in program) | | | 3 |
| **Total field days** | | | **about 26 to 36** |

**Days available:** 08/02/2027 to 30/04/2027 is 58 working days (Good Friday 26/03 and Easter Monday 29/03 removed). Allowing 15% to 25% loss for wet weather (unsealed roads need a day or more to dry after rain), days over 40 deg C and smoke leaves **about 44 to 49 usable days**.

**Result:** one rig needs 26 to 36 days against 44 to 49 usable, a float of about 8 to 23 days. The rolling zones (474 to 864 km) need only 6 to 11 days each. **One rig plus a backup camera is enough.** A second rig only makes sense if capture is more than a week behind by mid-March, which matches the trigger already in the Fee Proposal. The backup is a consumer 360 (Option A kit), so a camera failure costs hours, not weeks.

**Constraints this exposes:**
- **Driver budget.** 26 to 36 field days at about A$450 to A$550 a day (casual incl. on-costs, 9 to 10 hour days, est.) is A$12k to A$20k, above the A$10k allowed. A$10k buys about 18 to 22 days.
- **Jayden's clash.** Drone campaigns run 15/02 to 25/02 and 08/03 to 18/03/2027. The rig must run with the casual driver alone in those weeks, so it needs automatic distance-triggered capture with no screen work while driving (WHS POL-004). That favours Option B over Option A.
- **Rating workload.** If JCE also rates the roads, allow roughly 400 to 600 hours (est.: first-pass by the casual technician, QA by Jayden) on top of the 902 hours already planned for Jayden and 298 for the technician.

---

## 3. Leasing, hire and finance

- **Hire:** no Australian published weekly or monthly rate was found for vehicle 360 imaging or mobile mapping kits. UPG/SITECH run Australian rental warehouses (Trimble X7 scanners, GNSS, total stations, long or short term). C.R. Kennedy (Leica distributor) has a hire fleet covering GNSS and drones and says it can source mobile mapping tools. Position Partners (Topcon) rents GNSS and survey gear. Ask each for a 3-month rate on a vehicle 360 kit (MX7, Mosaic or Leica equivalent). Kennards Hire is not relevant.
- **Rule of thumb (est.):** if a A$60k kit hired at about 8% to 10% of value a month, 3 months a year for 4 seasons would cost A$58k to A$72k, about the same as buying, and you would own nothing. Hire only suits a one-off council.
- **Finance:** chattel mortgage (own from day one, claim GST and depreciation) is the usual SME choice; prime asset-backed rates were quoted at about 7.95% to 10.95% (May 2026, broker source). One broker source says the A$20,000 instant asset write-off is permanent from 1/07/2026 for businesses under A$10m turnover; **not verified, check with your accountant or the ATO.** Option A sits under that threshold; Option B does not.
- **Contract capture only:** add a "capture-only" price line (per km sealed and unsealed, images, GNSS track and image index, no rating) to the road imaging RFQ before it goes out. That gives a real number for Option D instead of an estimate.

---

## 4. Software for image management and rating

| Software | Use here | Pricing model |
|---|---|---|
| QGIS + exiftool + mapillary_tools (frame extraction, geotag write, GPX sync) | Image index layer, segment linking, EXIF write for Option A | Free, open source |
| Mapillary | Public street-level viewer, auto-blurs faces and plates | Free for any use, but imagery is published openly. **Do not upload Council imagery without Council's written consent** |
| Mosaic processing software | Stitching and EXIF for Mosaic cameras | Ask in quote (bundled or subscription) |
| Trimble Business Center, Mobile Mapping plan | Processing MX7 data | Subscription, specialty plan; price on quote |
| Imajview (Imajing) | Viewing, measuring, slopes and cross-falls from ImajBox imagery | Bundled with ImajBox; quote |
| Vaisala RoadAI | AI pavement rating from video | Licence a year: UK G-Cloud lists GBP 8,500 to GBP 250,000; no Australian price found |
| Asset Vision | Council inspection and asset platform (used by TfNSW, Uralla) | Subscription; price not published |
| Pix4Dmatic | Drone photogrammetry (JCE drone work, not 360 stills) | From USD 125 a month |
| Assetic, Vaarst | Not researched in detail: no Vaarst information found; use Council's own AMS template for the final data | n/a |

Also needed: a face and number-plate blurring step before images go to Council (Mapillary does this automatically, but for private delivery use an offline tool), and a 360 viewer linked to the QGIS image index.

---

## 5. DRFA compliance notes

- QRA's DRFA photo evidence guidance asks for geotagged photos with correct location metadata showing pre-disaster condition, and accepts local government pre-disaster evidence up to **4 years** old. Annual zone capture keeps every road inside that window.
- Victoria's Essential Public Assets photo report template lists latitude, longitude and date taken from embedded metadata for each photo.
- No NSW rule was found that requires the camera itself to write the GPS at capture, but **JCE's own Fee Proposal promises "GPS embedded natively in each image"**. Either buy a native-geotag system (B1/B2), or reword that line before the tender closes on 13/11/2026.
- Sync the camera clock to GNSS time. Write EXIF DateTimeOriginal in local time with OffsetTimeOriginal, and GPSDateStamp/GPSTimeStamp in UTC. Daylight saving ends on 4/04/2027, during capture.
- Keep originals unedited, with a checksum log and the raw GNSS logs, for audit.

---

## 6. Insurance checklist (ask your broker, Webber)

1. **Business motor:** declare the roof rack, camera rig, beacon and cabling as accessories or modifications; confirm the sum insured covers them, or whether there is a cap for non-standard accessories.
2. Confirm cover for a **casual driver** (named or any driver, age and inexperience excesses) and for business use on **unsealed and gravel roads** (check off-road exclusions).
3. Confirm the rig is covered **while mounted and in use**, not only when stored.
4. **Portable equipment / general property** (business pack) for the camera, GNSS, laptop and drives: unspecified items are often capped (Allianz: A$2,500 per item), so **list high-value items as specified items**. Ask about theft from an unattended vehicle (forced-entry conditions), Australia-wide territory, accidental damage and new for old.
5. **Electronic equipment breakdown** and **data reinstatement** (cost to re-drive roads if drives fail or are lost).
6. **Hired-in equipment** cover, or a damage waiver, if you hire a kit; the hire firm will ask.
7. **Financier's interest** noted on the policy if the kit is financed.
8. **Public liability:** confirm a rig detaching and striking a third party is covered (motor or PL), and close the A$10m to A$20m PL gap already noted for this tender.
9. **Workers compensation** for the casual driver (WorkCover number for Schedule 2).
10. Check the mount's roof-load rating and NSW vehicle standards for projections and warning beacons; ask whether the insurer requires a compliant mount and a steel safety tether.

---

## 7. Four-year cost of ownership vs the partner (2027 to 2030)

Partner baseline: PS1 A$255,035 (Year 1, incl. 10% mark-up). Rolling years pro rata by km: 2028 about A$69k, 2029 about A$73k, 2030 about A$40k (est., no escalation). **Four seasons about A$437k** (2031 adds about A$72k).

Self-delivery (JCE captures and rates), est.:

| Cost | Option A (budget) | Option B1 (Mosaic + RS3) |
|---|---|---|
| Equipment (once) | A$8k | A$60k (pending quote) |
| Year 1 capture: driver A$16k, Jayden set-up and QA about 8 days, vehicle about 7,500 km at A$0.96, accommodation and meals, storage | about A$45k | about A$45k |
| Year 1 rating (about 450 h technician + 100 h Jayden at fee proposal rates) | about A$50k | about A$50k |
| Software and insurance uplift | about A$4k | about A$7k |
| **Year 1 total** | **about A$107k** | **about A$162k** |
| 2028 to 2030 (809 + 864 + 474 km, pro rata) | about A$82k | about A$90k |
| **Four-year total** | **about A$189k** | **about A$252k** |
| Saving vs partner (about A$437k) | about A$248k | about A$185k |

Option A saves more on paper but carries the "native GPS" and video-frame quality risk. Option B1 still saves about A$185k and leaves JCE with a native-geotag system for other councils.

---

## 8. Recommendation

1. **Do not buy professional lidar (Option C), and do not hire.** Hire costs about the same as buying over 4 seasons and no Australian provider publishes a rate for this class of kit.
2. **Buy one rig plus a backup camera**, provided a quote comes in at or below about A$70k: a Mosaic 51 or Mosaic X with an Emlid RS3 (or a calibrated used Trimble MX7 with Australian support), plus an Insta360 X5 or GoPro MAX2 as backup. One rig covers 2027 with 8 to 23 days of float and each rolling zone in under two weeks.
3. **Run a cheap trial now** with an X5 and Jayden's existing RTK and NTRIP set-up (Option A) on 20 to 50 km of local sealed and gravel roads: test image quality at 60 to 80 km/h, frame extraction at 10 m, EXIF fields and dust. It costs about A$1k and becomes the backup.
4. **For the tender closing 13/11/2026:** keep the partner model (PS1) as lodged, because the 20% experience criterion depends on partner credentials and JCE has not yet delivered a network audit as lead. Ask the road imaging firms for a **capture-only price** as well. After award, move to self-capture from the 2028 zone (809 km, low risk), or earlier if the capture-only quotes plus the trial show it is safe and Council agrees.
5. **For future councils (2028 to 2031 and beyond):** owning a native-geotag rig lets JCE offer capture plus rating at a lower price than partner-led bids, with each further council adding margin at low marginal cost.

---

## 9. What Jayden does next

1. Before the RFQs go out: add a capture-only price line (per km sealed and unsealed, images, GNSS track, image index) to JCE-RFQ-VP527277-01.
2. Ask Mosaic (or its Australian reseller) for a quote on the Mosaic 51 and Mosaic X with an Emlid RS3 kit, vehicle mount, software and warranty, and ask for a sample image set to check EXIF fields.
3. Ask UPG/SITECH, C.R. Kennedy and Position Partners for 3-month hire rates and used-unit prices on a vehicle 360 imaging kit (MX7 or similar), and ask Imajing for an ImajBox 360 quote.
4. Buy an Insta360 X5 (or GoPro MAX2) and a rated roof-rack clamp with a tether, and run the 20 to 50 km trial in November or December 2026.
5. Register for AUSCORS NTRIP (free, Geoscience Australia) or confirm CORSnet-NSW access across the LGA, and check mobile coverage on the unsealed network for corrections.
6. Ask Webber to quote the items in section 6 for the rig, a casual driver and gravel-road use.
7. Ask your accountant about chattel mortgage versus cash, and whether the instant asset write-off applies.
8. Decide whether to reword "GPS embedded natively in each image" in the Fee Proposal before 13/11/2026, or keep it and buy a native-geotag system.
9. Increase the casual driver allowance to about A$15k to A$20k, or plan for Jayden to drive some capture days.
10. Get written Council consent before any imagery goes to a public platform such as Mapillary.

---

## Sources

- Australian Photography, Insta360 X5 review (AU price): https://www.australianphotography.com/gear/review-insta360-x5
- Click Frenzy, Insta360 X5 deal: https://www.clickfrenzy.com.au/deal/insta360-x5-360-8k-camera-1787505231324
- Insta360 AU store: https://store.insta360.com/au/products
- Buywisely, Insta360 X4: https://buywisely.com.au/au/product/insta360-x4-standard-bundle-oror-no-microsd-card
- Videocraft, GoPro MAX2: https://www.videocraft.com.au/zh/products/gopro-max2-360-action-camera
- Emlid AU store, Reach RS3: https://au.store.emlid.com/au/?p=20740
- Emlid AU store, Reach M2: https://au.store.emlid.com/au/product/reachm2/
- D1 Store, Emlid Reach RS3: https://www.d1store.com.au/mobile/products/emlid-reach-rs3
- Mapillary help, recommended cameras and settings: https://help.mapillary.com/hc/en-us/articles/360012674619
- Mapillary help, Insta360 guidance: https://help.mapillary.com/hc/en-us/articles/11951588568604
- Mapillary forum, Insta360 X5: https://forum.mapillary.com/t/insta-360-x5-camera/9516
- Mapillary forum, GoPro MAX timelapse interval: https://forum.mapillary.com/t/gopro-max-time-lapse-interval-and-location-exif/5309
- Mapillary forum, mounting a 360 camera on a car: https://forum.mapillary.com/t/how-to-mounting-a-360-camera-on-a-car/8238?page=2
- Mapillary FAQ (free use): https://help.mapillary.com/hc/en-us/articles/8348198426396-Mapillary-FAQ
- Proshop, Insta360 triple suction mount limits: https://www.proshop.nl/Accessoires-voor-actiecameras/Insta360-Triple-Suction-Cup-Car-Mount/3238138
- Geo Week News, Mosaic 51 with GNSS: https://www.geoweeknews.com/articles/mosaic-51-brings-together-360-camera-and-gnss-for-accurate-high-resolution-imaging/
- Geo-matching, Mosaic 51: https://geo-matching.com/products/mosaic-51-12k-360-camera-for-mobile-mapping-and-street-view-ladybug-5-successor
- Geo-matching, Mosaic X: https://geo-matching.com/products/mosaic-x-mobile-mapper-for-large-scale-photogrammetry-w-o-lidar
- Geo-matching, Emlid RS3 with Mosaic: https://geo-matching.com/videos/how-to-integrate-emlid-rs3-with-mosaic-360-camera-for-high-accuracy-mobile-mapping
- WGAN forum, Labpano Pilot Era: https://www.wegetaroundnetwork.com/topic/12100/video-labpano-pilot-one-versus-pilot-era/
- Geo-matching, Imajbox 360: https://geo-matching.com/products/imajbox-360
- Duncan-Parnell, used Trimble MX7: https://duncan-parnell.com/trimble-mx7-mobile-imaging-system-used
- Geo Week News, Trimble MX50: https://www.geoweeknews.com/articles/trimble-adds-new-mid-range-mx50-to-mobile-mapping-portfolio/
- Leica, choosing a Pegasus TRK: https://leica-geosystems.com/products/mobile-mapping-systems/hardware/Leica-Pegasus-TRK-neo/how-to-choose-leica-pegasus-trk
- SITECH / UPG rental: https://sitechsolutions.com.au/?p=2631
- C.R. Kennedy Geospatial: https://survey.crkennedy.com.au/
- Position Partners (rental, background): https://www.mining-technology.com/contractors/resource/position-partners/pressreleases/queensland-footprint/
- Trimble Business Center subscription plans: https://geospatial.trimble.com/en/products/software/trimble-business-center/subscription-plans
- Vaisala RoadAI on UK G-Cloud: https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud/services/581776053828682
- Uralla Council and Asset Vision: https://insidelocalgovernment.com.au/uralla-council-rolls-out-digital-pathway-for-local-roads/
- Pix4D pricing: https://www.pix4d.com/pricing
- Snowy Monaro Council road network assessment (DCPM): https://www.snowymonaro.nsw.gov.au/News-and-Media/News-articles/Council’s-five-yearly-road-network-assessment-begins-next-week
- South Burnett, RACAS stills every 10 m: https://southburnett.com.au/news2/2017/10/camera-keeps-an-eye-on-roads/
- QRA DRFA photo evidence: https://www.qra.qld.gov.au/drfa-tool-box/photo-evidence
- Victoria EPA reconstruction photo report template: https://www.vic.gov.au/sites/default/files/2024-05/Photo-Report-Template-Essential-Public-Assets-Reconstruction-works-Estimate.docx
- NSW audit process and the DRFA fact sheet: https://www.nsw.gov.au/sites/default/files/2025-12/audit-process-and-the-drfa-fact-sheet.pdf
- Geoscience Australia GNSS data (AUSCORS streams): https://www.ga.gov.au/scientific-topics/positioning-navigation/geodesy/gnss-networks/data-and-site-logs
- Allianz General Property cover: https://www.allianz.com.au/business-insurance/business-pack/general-property.html
- Savvy, business equipment insurance: https://savvy.com.au/savvy-staging-2/business-insurance/business-equipment-insurance
- RACV business insurance for tradies: https://www.racv.com.au/business-solutions/insurance/business-insurance-for-tradies.html
- Your Finance Guide, equipment finance 2026: https://www.yourfinanceguide.com.au/best-equipment-finance-2026
- Aussie, equipment and asset finance: https://www.aussie.com.au/your-goal/business-loans/vehicles-equipment-and-asset-finance-for-businesses.html
- JCE Fee Proposal Rev G (local): 1_Fee_Proposal/FP_Final_text_RevG.md
