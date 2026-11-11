# SUPERSEDED for the 12/11/2026 launch by deploy-live.ps1 (run RUN-LIVE-DEPLOY.cmd). Kept for reference.
# Glide Inside go-live deploy for the API Worker "pocket-architect-api" (the LIVE Worker, merged with the release code).
# Run from the pocket-architect-source folder (the one that holds wrangler.toml and package.json), after reading golive\GO-LIVE.md Step 0.
# It asks for a secret only if that secret is missing. It never overwrites a secret that is already set.
# Nothing here sends email or changes a Stripe key (set those yourself, GO-LIVE.md Step 3).
$ErrorActionPreference = 'Stop'
if (-not (Test-Path .\wrangler.toml)) { throw 'Run this from the folder that holds wrangler.toml (pocket-architect-source).' }
if (Select-String -Path .\wrangler.toml -Pattern 'REPLACE-WITH' -Quiet) { throw 'wrangler.toml still has a REPLACE-WITH line.' }
if (-not (Select-String -Path .\wrangler.toml -Pattern 'name = "pocket-architect-api"' -Quiet)) { throw 'wrangler.toml must say name = "pocket-architect-api" (the live Worker), or a second Worker would be created.' }
if (-not (Select-String -Path .\wrangler.toml -Pattern 'fccdf1f7-e48c-4c72-8723-b343b3f2fad4' -Quiet)) { throw 'wrangler.toml must use the live D1 database id fccdf1f7-e48c-4c72-8723-b343b3f2fad4.' }

npm ci --no-audit --no-fund
npx wrangler whoami

# Before anything changes: what is live now (the "before" picture) and a bundle check.
Write-Host 'Live health now:'; curl.exe -s https://glideinside.com.au/api/health; Write-Host ''
npx wrangler deploy --dry-run
if ($LASTEXITCODE -ne 0) { throw 'The dry run failed. Nothing was changed.' }

# 1. Database: backup, then the migrations (additive, recorded, safe to run again).
$backup = Join-Path $env:USERPROFILE ("Downloads\pocket-architect-before-release-" + (Get-Date -Format 'yyyyMMdd-HHmm') + ".sql")
npx wrangler d1 export pocket-architect --remote --output $backup
if ($LASTEXITCODE -ne 0) { throw 'The D1 backup failed. Stopping before any change.' }
Write-Host "Backup saved to $backup"
npx wrangler d1 migrations apply pocket-architect --remote
if ($LASTEXITCODE -ne 0) { throw 'A migration failed. Stopping before the deploy. The live Worker is unchanged.' }

# 2. Secrets: only the NEW ones, and only if missing. The live secrets are never touched.
$have = (npx wrangler secret list | ConvertFrom-Json).name
foreach ($n in @('RESEND_API_KEY', 'ADMIN_TOKEN')) {
  if ($have -contains $n) { Write-Host "$n already set, skipping"; continue }
  if ($n -eq 'ADMIN_TOKEN') {
    $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    $tok = ($b | ForEach-Object { $_.ToString('x2') }) -join ''
    Write-Host "Generated ADMIN_TOKEN (save it in your password manager, it is not shown again): $tok"
    $tok | npx wrangler secret put ADMIN_TOKEN
  } else { Write-Host "Setting $n (paste the value when asked)"; npx wrangler secret put $n }
}
# The live secrets must already exist. Stop if one is missing rather than deploy a Worker that cannot take payments.
foreach ($n in @('ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'ENTITLEMENT_SECRET', 'IP_HASH_SALT')) {
  if ($have -notcontains $n) { throw "Secret $n is not set on the live Worker. Set it (GO-LIVE.md Step 3) before deploying." }
}

# 3. Deploy. --keep-vars keeps any variable that was set only in the Cloudflare dashboard.
npx wrangler deploy --keep-vars
Write-Host ''
Write-Host 'Deployed. Smoke test now (GO-LIVE.md Step 7): health must show "sharing":true, and an existing share link must still open.'
curl.exe -s https://glideinside.com.au/api/health
Write-Host ''
Write-Host 'To undo the deploy: npx wrangler rollback'
