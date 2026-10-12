# Talk to a civil engineer: enquiry components

Sends an enquiry to JCE Infrastructure (the platform's industry partner) via `POST /enquiries` (multipart; backend in `backend/app/api/enquiries.py`).

## One-line integration

Add a nav tab titled "Talk to an engineer" that renders the button:

```tsx
import EngineerEnquiryButton from "@/components/enquiry/EngineerEnquiryButton";
<EngineerEnquiryButton className="your-nav-tab-class" />   // omit className for the built-in styled button
```

On a project page pass context so the address/lot are prefilled and the "Share my project summary" option appears:

```tsx
<EngineerEnquiryButton projectId={id} context={{ address, lotPlan, developmentType, summary: { zoning, constraints }, planLinks }} />
```

Nothing from `summary` or `planLinks` is sent unless the user ticks the share box.

## Parts

- `EngineerEnquiryModal` (default and named export): props `open`, `onClose`, `projectId?`, `context?`, `userId?`. Accessible dialog with focus trap, ESC, backdrop click, scroll lock, focus restore; full-screen on phones.
- `EngineerEnquiryButton`: trigger plus modal.
- `EngineerEnquiryForm`: the form alone (used by the modal and by the page at `/engineer`, optional `?project=<uuid>`).
- `src/lib/enquiry.ts`: types, validation, `buildFormData`, `submitEnquiry`.

## Theming

Styles are scoped under `.enq` and read the app's CSS variables (`--bg`, `--surface`/`--panel`, `--ink`/`--fg`, `--muted`, `--line`, `--brand`/`--accent`, `--danger`, `--ok`, plus `--font-display`, `--font-body`, `--font-mono`) with fallbacks. Variables are expected as space-separated RGB triplets, as in `globals.css` (`rgb(var(--bg))`). If the redesign adds `--panel`, `--fg` or `--accent` they take precedence automatically.

## Before launch (owner)

Set `ENQUIRY_TO` and SMTP/webhook variables (see `.env.example`), publish a privacy policy at `/legal/privacy` (or change `PRIVACY_POLICY_URL`), and have the solicitor confirm `legal/TERMS_ADDENDUM_REFERRAL.md`.
