# Glide Inside and Pocket Architect: staging

A private test copy of the whole site, the app, the builder portal and the API. It runs as its own Cloudflare Worker, `pocket-architect-staging`, at a workers.dev address. It has its own D1 database (`pocket-architect-staging`) and its own R2 bucket (`pocket-architect-staging-files`). It does not use the live Worker, the live D1 database, the live R2 bucket or Stripe. There are no routes, so glideinside.com.au is never touched. Every page shows a red "STAGING, not the live site" tag and is set to noindex.

## The one command (PowerShell, Windows)

Copy `glideinside-staging.zip` into Downloads, then run:

```powershell
Set-Location $HOME\Downloads; Expand-Archive -Force .\glideinside-staging.zip .; powershell -NoProfile -ExecutionPolicy Bypass -File .\glideinside-staging\GlideInside\staging\deploy-staging.ps1
```

If you work from the git checkout instead (branch `claude/glide-staging`):

```powershell
git pull; powershell -NoProfile -ExecutionPolicy Bypass -File .\GlideInside\staging\deploy-staging.ps1
```

What it does, in order:

- Refuses to run unless `wrangler.staging.toml` names `pocket-architect-staging`, has no route and no live resource.
- Checks node (20 or newer) and wrangler, installs them locally on the first run, runs `npx wrangler whoami`.
- Builds the staging site (git checkout only; the zip already contains it).
- Creates the staging D1 database and R2 bucket if they are missing, applies every migration to the staging database only (`--remote`).
- Deploys the Worker, sets the staging secrets (random, generated on your PC, never printed or committed), then calls `/api/health` and `/api/site/health` and prints them.
- Prints the URL, and a sample builder login for the portal (username and temporary password, shown once).

The first run takes a few minutes (npm installs). Running it again is safe: it reuses the database, bucket and secrets, redeploys the newest code and gives the sample builder a new temporary password. After other branches are merged (3D polish, PDF plan set), a new zip or a `git pull` followed by the same command is all that is needed.

Note: `/api/site/health` is the government services check (NSW and QLD address, lot, aerial and elevation services). It must be reachable from Cloudflare, so a failure there on staging is worth reporting.

## What to test

- Any NSW address, for example a real house in Tamworth or Gunnedah, and a QLD address such as one in Townsville. Use Find my block, check the lot boundary, frontage, the aerial and contours.
- The setbacks panel for that council (the rules load per council from `/plan-studio/data/setbacks/`).
- Draw a house, the 3D view and the walk through, Split.
- PDF plan set and the other exports. On staging the A$30 Plan Pack paywall is bypassed by a staging-only dev unlock: the app asks the staging server for a free test Plan Pack (the server only offers it when `STAGING=1` and it has no Stripe key, so it cannot exist on the live Worker). PDF, DXF, GLB, OBJ and interactive HTML are built by the real server export code.
- Save and share: make a share link, open it in a private window. Links point back at the staging address and are stored in the staging R2 bucket.
- Builder portal at `/portal/` with the sample login printed by the script (the first sign in forces a new password). Try houses, Generate account for a client, the Billing tab (this month's client login count and rate) and the client sign in.
- The AI assistant shows "not available on the staging site" (there is no Anthropic key on staging). Checkout cannot work (no Stripe). Email is never sent (no Resend key).

Client login pricing on the portal Billing view: A$30 each for the first 15 new client logins in a Sydney month, A$25 each for logins 16 to 50, a custom rate above that (set by the owner admin route `POST /api/portal/admin/orgs/<id>/login-rate`).

## Remove staging afterwards

From the staging folder (`...\GlideInside\staging`):

```powershell
npx wrangler delete --config wrangler.staging.toml
npx wrangler d1 delete pocket-architect-staging
npx wrangler r2 bucket delete pocket-architect-staging-files
```

The bucket delete only works once it is empty. The folder and the `.staging-url` and `.staging-admin-token` files can then be deleted. These commands name staging resources only; check the name before confirming each prompt.
