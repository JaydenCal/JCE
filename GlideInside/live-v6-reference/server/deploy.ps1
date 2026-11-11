# Pocket Architect API deploy for Windows PowerShell. Run in the server folder:  powershell -ExecutionPolicy Bypass -File deploy.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
npm install --no-audit --no-fund
npx wrangler login
if (-not (Test-Path wrangler.toml)) {
  Copy-Item wrangler.toml.example wrangler.toml
  $out = npx wrangler d1 create pocket-architect | Out-String
  Write-Host $out
  $id = [regex]::Match($out, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}').Value
  if (-not $id) { Remove-Item wrangler.toml; throw "Could not read the database id. Re-run this script." }
  (Get-Content wrangler.toml) -replace 'PASTE_ID', $id | Set-Content wrangler.toml
}
$ErrorActionPreference = "Continue"
npx wrangler r2 bucket create pocket-architect-files
npx wrangler d1 execute pocket-architect --remote --file=schema.sql --yes
$ErrorActionPreference = "Stop"
foreach ($s in "STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET","STRIPE_PRICE_ID","ANTHROPIC_API_KEY") {
  if ((Read-Host "Set $s now? (y/N)") -eq "y") { npx wrangler secret put $s }
}
$existing = npx wrangler secret list 2>$null | Out-String
foreach ($s in "ENTITLEMENT_SECRET","IP_HASH_SALT") {
  if ($existing -match "`"$s`"") { Write-Host "$s already set, keeping it."; continue }
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put $s
}
node test/worker.test.mjs
npx wrangler deploy
Write-Host "Deployed. Check https://glideinside.com.au/api/health"
