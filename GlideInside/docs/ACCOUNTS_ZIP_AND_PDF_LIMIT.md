# Accounts, zip save/load and the one-PDF-set rule (for the Pocket Architect app)

This static site only describes these rules. They must be enforced by the app and its server. Nothing on a static page can stop someone printing twice.

## Price
A$35 per job (`planPackPrice` in `site.config.js`). Each job is a separate purchase. Stripe: one Payment Link, adjustable quantity on.

## Accounts and zip files
- Sign up with an email address (email one-time link or code; no passwords to store).
- Every job is saved to the account. "Download zip" bundles the project JSON, underlays, exports already issued and a manifest (job id, schema version, created date, SHA-256 of each file).
- "Open zip" loads the project JSON back into the editor. The zip contains no entitlement: the server decides what the signed-in account may do.

## One PDF set per job (server side only)
1. Table `jobs(id, account_id, paid_at, pdf_exports_used INT DEFAULT 0, pdf_exports_allowed INT DEFAULT 1)`.
2. `POST /api/export/pdf` runs one atomic statement: `UPDATE jobs SET pdf_exports_used = pdf_exports_used + 1 WHERE id=? AND account_id=? AND paid_at IS NOT NULL AND pdf_exports_used < pdf_exports_allowed`. Zero rows changed = refuse (HTTP 403 `PDF_LIMIT_REACHED`). Never check then update in two steps.
3. Generate the PDF on the server, store it against the job, and return it. Do not generate PDFs in the browser in production.
4. Re-delivery of the same stored file is allowed (it is not a new set), so people who lose the download are not stuck. Opening a saved zip must never reset `pdf_exports_used`. If the project is edited after the PDF was issued, the edit does not grant a new set; a new set is a new job and a new payment.
5. Mark a job paid only from the Stripe webhook (`checkout.session.completed`, signature verified), never from the browser redirect. Make the webhook idempotent by event id.
6. Rate limit the export endpoint, log each export (account, job, time, IP hash), and watermark or embed the job id in the PDF so leaks can be traced.
7. Keep the Stripe secret key and webhook secret on the server only.

## Stripe keys
The publishable key (`pk_live_...`) is safe in browser code but cannot take a payment on its own. For a Payment Link, use the `https://buy.stripe.com/...` URL in `stripePlan`. Never paste a secret key (`sk_live_...`) or webhook secret into the site or into chat.
