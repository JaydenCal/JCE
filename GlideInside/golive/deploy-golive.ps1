# Glide Inside go-live deploy for the API Worker. Run from the pocket-architect-source folder (the one that holds wrangler.toml
# and package.json). It does NOT ask again for secrets that are already set; it only asks for the new ones.
# Nothing here sends email or uses a live Stripe key.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path .\wrangler.toml)) { throw 'Run this from the folder that holds wrangler.toml (pocket-architect-source).' }
if (Select-String -Path .\wrangler.toml -Pattern 'REPLACE-WITH' -Quiet) { throw 'wrangler.toml still has a REPLACE-WITH line. Edit it first (worker name and database_id).' }

npm install --no-audit --no-fund
npx wrangler whoami

# 1. Database: additive schema (safe to run again).
npx wrangler d1 execute plan-studio --remote --file server/schema.sql

# 2. Secrets: only the ones that are missing are asked for.
$have = (npx wrangler secret list | ConvertFrom-Json).name
$need = @('ANTHROPIC_API_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','ENTITLEMENT_SECRET','RESEND_API_KEY','ADMIN_TOKEN')
foreach ($n in $need) {
  if ($have -contains $n) { Write-Host "$n already set, skipping" }
  else {
    if ($n -eq 'ADMIN_TOKEN') {
      $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
      $tok = ($b | ForEach-Object { $_.ToString('x2') }) -join ''
      Write-Host "Generated ADMIN_TOKEN (save it in your password manager, it is not shown again): $tok"
      $tok | npx wrangler secret put ADMIN_TOKEN
    } else { Write-Host "Setting $n (paste the value when asked)"; npx wrangler secret put $n }
  }
}

# 3. Deploy. --keep-vars keeps any variable that was set only in the Cloudflare dashboard.
npx wrangler deploy --keep-vars
Write-Host 'Deployed. Now check https://glideinside.com.au/api/health and /api/site/health'
