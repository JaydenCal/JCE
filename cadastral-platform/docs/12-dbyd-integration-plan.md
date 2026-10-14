# JCESITE: DBYD (Before You Dig Australia) integration plan

Date: 14/10/2026. Status: PLAN ONLY. Nothing in this document is built. Items marked UNRESOLVED must be confirmed with Before You Dig Australia (BYDA) before any build starts.

## 1. Purpose

Existing underground services are the biggest gap on the plan set. Sheets C100 and C310 currently show "DATA NOT AVAILABLE" for existing services, which is correct, because the platform holds no service data. This plan describes how JCESITE can bring real DBYD referral and asset-owner plan information into a project so that those sheets can show services with their source, date and limits.

## 2. Rules the integration must respect

- Never invent data. A service appears on a plan only if it comes from an asset owner plan or a response attached to a DBYD enquiry for that project.
- "Not checked" never means "clear". A project with no enquiry, or with responses outstanding, shows "EXISTING SERVICES NOT CONFIRMED" and never an empty plan.
- DBYD information is indicative. Every service label carries the asset owner, the plan date and "LOCATION INDICATIVE, CONFIRM BY POTHOLING". The existing acknowledgement dbyd_physical_verification remains mandatory.
- Asset owner plans are third party content. Licence, redistribution and validity terms must be honoured (UNRESOLVED, see section 8).
- JCESITE outputs remain AI generated drafts for checking by a qualified person.

## 3. What is known today

From BYDA's article of 07/08/2024 on its API:
- The API supports bulk referral enquiries, including several job sites at once and enquiries uploaded from a spatial data file.
- It is aimed at frequent users, and access needs a subscription plan, requested through the contact form on the BYDA website.
- The article does not describe asset owner responses, plan delivery, pricing, rate limits or terms. These are UNRESOLVED.

Everything else in this plan about API behaviour is an assumption to be replaced by BYDA's documentation.

## 4. Phased approach

### Phase 0: manual path (can be built now, no BYDA agreement needed)
- The user lodges the enquiry on BYDA's own site or app, using their own account.
- JCESITE shows a "DBYD" panel on the project: enquiry reference (typed in), date lodged, the lot polygon exported as a spatial file ready to upload to BYDA, and a checklist of asset owners.
- The user uploads each asset owner response or plan (PDF, image or CAD) through the existing upload pipeline, with the existing upload rights warranty acknowledgement.
- A person traces or confirms services over the uploaded plan in the viewer. Each traced service stores its source plan, owner and date. Nothing is auto-trusted.
- Sheets C100 and C310 draw only confirmed services, labelled as in section 2.

### Phase 1: referral API (needs a BYDA subscription)
- JCESITE submits the lot polygon as a referral enquiry through the API, on behalf of a user who holds the BYDA subscription or authority (UNRESOLVED: who may lodge).
- The returned list of asset owners to contact is stored and shown with response status: awaiting, received, no assets, plans attached.
- Status is polled or pushed (UNRESOLVED) and shown on the project and on C100 as "EXISTING SERVICES NOT CONFIRMED" until responses are in.

### Phase 2: response ingestion
- Asset owner plans arrive by upload, or by API if BYDA exposes them (UNRESOLVED).
- Automatic extraction (vector CAD or PDF linework) proposes service lines and pits as DRAFT features with a confidence flag. A person must verify each feature before it can reach a drawing.

### Phase 3: plan outputs and reminders
- Verified services drawn on C100 and C310 with symbols (HYD, WM, T pit, grate) and owner, plan date and expiry.
- Warnings when a plan is past its validity period (value UNRESOLVED, taken from the source plan) or when the design changes after the enquiry.

## 5. Data model (new tables)

| Table | Key fields |
|---|---|
| dbyd_enquiry | id, project_id, mode (manual or api), external_ref, status, lodged_at, lodged_by, polygon, work_type, planned_dig_dates |
| dbyd_referral | id, enquiry_id, asset_owner_name, contact (stored only if supplied), response_status, responded_at |
| dbyd_plan | id, referral_id, upload_id, received_at, source_valid_until, licence_note, parse_status |
| service_feature | id, project_id, plan_id, service_type, geometry, depth_note, status (draft, verified, rejected), verified_by, verified_at |

All rows keep an audit trail (who, when, source file hash).

## 6. Platform changes

- New optional agent SA12 DBYD: waits in the run status waiting_user until the enquiry exists and responses are received, never blocking runs that do not need services.
- New API endpoints (proposed): POST /projects/{id}/dbyd/enquiries, GET /projects/{id}/dbyd, POST /projects/{id}/dbyd/plans, PATCH /dbyd/features/{id} (verify or reject).
- Plan set: C100 and C310 read verified service_feature rows. The data availability panel states how many features are verified, how many are draft, and which asset owners have not responded.
- Report: a DBYD section listing owners, status, dates and the limits in section 2.
- Frontend: DBYD tab on the project page with the owner checklist, upload and verify tools. The website design session picks this up from the brief.

## 7. Delivery estimate (to be refined)

| Step | Effort |
|---|---|
| Phase 0 (panel, uploads, trace and verify, drawing) | 2 to 3 build stages |
| Phase 1 (API client, enquiry and referral tracking) | 1 to 2 stages once documentation is in hand |
| Phase 2 (extraction and verification workflow) | 2 to 3 stages |
| Phase 3 (drawing polish, expiry warnings, report) | 1 stage |

## 8. Open questions for BYDA and for you

1. Subscription type, cost, rate limits and terms of use for the API (UNRESOLVED).
2. Does the API return asset owner responses and plans, or referrals only (UNRESOLVED)?
3. Who may lodge: the end user, JCESITE as agent, or only a registered account holder (UNRESOLVED)?
4. Plan licence and redistribution limits, and plan validity period (UNRESOLVED).
5. Sandbox or test environment availability (UNRESOLVED).
6. Decision for the owner: start with Phase 0 now and apply for API access in parallel?

## Sources

- BYDA, "BYDA API improves access to referral information", 07/08/2024: https://www.byda.com.au/2024/08/07/byda-api-improves-access-to-referral-information/
- BYDA general FAQs: https://byda.com.au/faq
