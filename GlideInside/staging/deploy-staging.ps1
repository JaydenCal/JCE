<#
  Glide Inside and Pocket Architect: STAGING deploy. Re-runnable (run it again after any new merge or a fresh zip).

  Run from PowerShell:   .\GlideInside\staging\deploy-staging.ps1     (git checkout)
                         .\glideinside-staging\GlideInside\staging\deploy-staging.ps1   (unzipped package)

  It only ever touches the Worker "pocket-architect-staging", the D1 database "pocket-architect-staging" and the R2 bucket
  "pocket-architect-staging-files". It never uses the live Worker, live D1, live R2 or Stripe, and it refuses to run if
  wrangler.staging.toml names anything else or contains a route.
#>
param(
  [switch]$SkipBuild         # reuse the site already in website-live-staging
)
$ErrorActionPreference = 'Stop'
$env:CI = 'true'                      # wrangler: no interactive prompts (migrations, d1 create)
$env:WRANGLER_SEND_METRICS = 'false'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Here                                   # ...\GlideInside
$Src  = Join-Path $Root 'pocket-architect-source'
$Site = Join-Path $Root 'website-live-staging'
$Cfg  = Join-Path $Here 'wrangler.staging.toml'
$StateUrl = Join-Path $Here '.staging-url'
$StateTok = Join-Path $Here '.staging-admin-token'
$WorkerName = 'pocket-architect-staging'
$DbName = 'pocket-architect-staging'
$BucketName = 'pocket-architect-staging-files'
$SampleOrg = 'Sample Builder (staging)'

function Step($m)  { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function Fail($m)  { Write-Host ""; Write-Host "STOPPED: $m" -ForegroundColor Red; exit 1 }
function Wrangler {
  # runs the locally installed wrangler from the staging folder; returns the output text and sets $script:WrExit
  Push-Location $Here
  try {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & npx --no-install wrangler @args 2>&1 | ForEach-Object { "$_" }
    $script:WrExit = $LASTEXITCODE
    $ErrorActionPreference = $prev
  } finally { Pop-Location }
  return ($out -join "`n")
}

# 0. Safety: the config must be the staging one and nothing else ------------------------------------------------------
Step 'Checking the staging config'
if (-not (Test-Path $Cfg)) { Fail "Missing $Cfg" }
$raw = Get-Content $Cfg -Raw
$lines = $raw -split "`r?`n" | ForEach-Object { ($_ -replace '#.*$', '').Trim() } | Where-Object { $_ -ne '' }
$nameLine = $lines | Where-Object { $_ -match '^name\s*=' } | Select-Object -First 1
if ($nameLine -notmatch '^name\s*=\s*"pocket-architect-staging"$') { Fail "The Worker name in wrangler.staging.toml is not pocket-architect-staging ($nameLine)." }
if ($lines | Where-Object { $_ -match '^(routes?|zone_name|zone_id|pattern|custom_domain)\b|\[\[routes\]\]|\[routes\]|\[\[env\.' }) { Fail 'wrangler.staging.toml contains a route or zone. Staging must use workers.dev only.' }
if ($lines -notcontains 'workers_dev = true') { Fail 'workers_dev = true is required.' }
if (($lines -join "`n") -match 'pocket-architect-api|fccdf1f7|glideinside\.com\.au/|"pocket-architect"|"pocket-architect-files"') { Fail 'wrangler.staging.toml refers to the live Worker, D1 database or R2 bucket.' }
if ($lines -notcontains "database_name = `"$DbName`"") { Fail "The D1 database in the config must be $DbName." }
if ($lines -notcontains "bucket_name = `"$BucketName`"") { Fail "The R2 bucket in the config must be $BucketName." }
if ($lines | Where-Object { $_ -match '^(STRIPE_|RESEND_|ANTHROPIC_)' }) { Fail 'Staging must not have Stripe, Resend or Anthropic settings.' }
Write-Host "OK: $WorkerName, workers.dev only, D1 $DbName, R2 $BucketName."

# 1. Tools ----------------------------------------------------------------------------------------------------------------
Step 'Checking node and wrangler'
try { $nodeV = (& node -v) } catch { Fail 'Node.js is not installed. Install Node 20 or newer from https://nodejs.org and run this again.' }
$major = [int](($nodeV -replace '^v', '') -split '\.')[0]
if ($major -lt 20) { Fail "Node $nodeV is too old. Install Node 20 or newer." }
Write-Host "node $nodeV"
$RepoMode = Test-Path (Join-Path $Src 'tools\build-single.mjs')
if (-not (Test-Path (Join-Path $Here 'node_modules\.bin\wrangler.cmd'))) {
  Write-Host 'Installing wrangler (staging folder)...'
  Push-Location $Here; & npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'npm ci failed in the staging folder.' }; Pop-Location
}
$needSrc = -not (Test-Path (Join-Path $Src 'node_modules\jspdf')) -or ($RepoMode -and -not (Test-Path (Join-Path $Src 'node_modules\esbuild')))
if ($needSrc) {
  Write-Host 'Installing the server libraries (pocket-architect-source)...'
  Push-Location $Src
  if ($RepoMode) { & npm ci --no-audit --no-fund } else { & npm ci --omit=dev --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'npm ci failed in pocket-architect-source.' }
  Pop-Location
}
Write-Host (Wrangler '--version' | Select-String -Pattern '\d+\.\d+\.\d+' | Select-Object -First 1)

Step 'Cloudflare login (wrangler whoami)'
$who = Wrangler 'whoami'
Write-Host $who
if ($who -match 'not authenticated|You are not logged in') { Fail 'wrangler is not logged in. Run:  npx wrangler login   (in the staging folder) and run this again.' }

# 2. Site -----------------------------------------------------------------------------------------------------------------
Step 'Building the staging site'
if ($RepoMode -and -not $SkipBuild) {
  & node (Join-Path $Here 'build-staging-site.mjs')
  if ($LASTEXITCODE -ne 0) { Fail 'The staging site build failed.' }
} else {
  Write-Host 'Using the prebuilt site in website-live-staging (package mode or -SkipBuild).'
}
if (-not (Test-Path (Join-Path $Site 'plan-studio\app\index.html'))) { Fail 'website-live-staging\plan-studio\app\index.html is missing.' }

# 3. D1 (own database, created if missing) ---------------------------------------------------------------------------------
Step "D1 database $DbName"
$dbId = $null
$list = Wrangler 'd1' 'list' '--json'
$s = $list.IndexOf('['); $e = $list.LastIndexOf(']')
if ($s -ge 0 -and $e -gt $s) {
  try { $dbs = $list.Substring($s, $e - $s + 1) | ConvertFrom-Json; $dbId = ($dbs | Where-Object { $_.name -eq $DbName } | Select-Object -First 1).uuid } catch {}
}
if (-not $dbId) {
  Write-Host "Creating $DbName ..."
  $created = Wrangler 'd1' 'create' $DbName
  Write-Host $created
  if ($created -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { $dbId = $Matches[1] }
  if (-not $dbId) { Fail 'Could not read the new D1 database id. Run  npx wrangler d1 list  and paste the id into wrangler.staging.toml.' }
}
if ($dbId -eq 'fccdf1f7-e48c-4c72-8723-b343b3f2fad4') { Fail 'That is the LIVE database id. Refusing.' }
$raw = Get-Content $Cfg -Raw
$raw = [regex]::Replace($raw, '(?m)^(database_id\s*=\s*)"[^"]*"', "`$1`"$dbId`"")
[System.IO.File]::WriteAllText($Cfg, $raw, (New-Object System.Text.UTF8Encoding($false)))   # no BOM
Write-Host "D1 id $dbId written to wrangler.staging.toml"

# 4. R2 bucket (own bucket, for share links and issued PDF sets) --------------------------------------------------------
Step "R2 bucket $BucketName"
$buckets = Wrangler 'r2' 'bucket' 'list'
if ($buckets -notmatch [regex]::Escape($BucketName)) {
  $mk = Wrangler 'r2' 'bucket' 'create' $BucketName
  Write-Host $mk
  if ($script:WrExit -ne 0 -and $mk -notmatch 'already exists') { Fail 'Could not create the R2 bucket. Is R2 enabled on this Cloudflare account?' }
} else { Write-Host 'Bucket exists.' }

# 5. Migrations (remote, staging database only) -------------------------------------------------------------------------
Step 'Applying migrations to the staging database'
$mig = Wrangler 'd1' 'migrations' 'apply' $DbName '--remote' '--config' $Cfg
Write-Host $mig
if ($script:WrExit -ne 0) { Fail 'Migrations failed (see above).' }

# 6. Deploy ----------------------------------------------------------------------------------------------------------------
Step "Deploying $WorkerName"
$dep = Wrangler 'deploy' '--config' $Cfg
Write-Host $dep
if ($script:WrExit -ne 0) { Fail 'wrangler deploy failed (see above).' }
$url = $null
if ($dep -match '(https://pocket-architect-staging\.[A-Za-z0-9-]+\.workers\.dev)') { $url = $Matches[1] }
if (-not $url -and (Test-Path $StateUrl)) { $url = (Get-Content $StateUrl -Raw).Trim() }
if (-not $url) { $url = (Read-Host 'Paste the workers.dev URL printed above').Trim().TrimEnd('/') }
if ($url -notmatch '^https://pocket-architect-staging\.[A-Za-z0-9-]+\.workers\.dev$') { Fail "Unexpected staging URL: $url" }
Set-Content -Path $StateUrl -Value $url -Encoding ASCII

# 7. Secrets (staging Worker only; generated here, kept in a local file that is never committed) ---------------------------
Step 'Staging secrets'
function RandomSecret([int]$bytes = 32) {
  $b = New-Object byte[] $bytes; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([BitConverter]::ToString($b) -replace '-', '').ToLower()
}
$have = Wrangler 'secret' 'list' '--config' $Cfg '--format' 'json'
$haveNames = @(); $s = $have.IndexOf('['); $e = $have.LastIndexOf(']')
if ($s -ge 0 -and $e -gt $s) { try { $haveNames = @(($have.Substring($s, $e - $s + 1) | ConvertFrom-Json) | ForEach-Object { $_.name }) } catch {} }
function PutSecret($name, $value) {
  Push-Location $Here
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $value | & npx --no-install wrangler secret put $name --config $Cfg 2>&1 | ForEach-Object { "$_" } | Out-Null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev; Pop-Location }
  if ($code -ne 0) { Fail "Setting the secret $name failed." }
  Write-Host "set $name"
}
$tok = $null
if ((Test-Path $StateTok) -and ($haveNames -contains 'ADMIN_TOKEN')) { $tok = (Get-Content $StateTok -Raw).Trim() }
if (-not $tok) { $tok = RandomSecret; Set-Content -Path $StateTok -Value $tok -Encoding ASCII; PutSecret 'ADMIN_TOKEN' $tok }
if ($haveNames -notcontains 'ENTITLEMENT_SECRET') { PutSecret 'ENTITLEMENT_SECRET' (RandomSecret) }
if ($haveNames -notcontains 'IP_HASH_SALT') { PutSecret 'IP_HASH_SALT' (RandomSecret 16) }
Write-Host 'Secrets are in place (ADMIN_TOKEN is kept only in staging\.staging-admin-token on this PC).'

# 8. Health ---------------------------------------------------------------------------------------------------------------
Step 'Health checks'
function Get-Json($path, $retries = 12) {
  for ($i = 1; $i -le $retries; $i++) {
    try { return (Invoke-RestMethod -Uri "$url$path" -TimeoutSec 60) } catch { Start-Sleep -Seconds 5; $last = $_ }
  }
  return "FAILED: $($last.Exception.Message)"
}
$h1 = Get-Json '/api/health'
Write-Host "/api/health      : $($h1 | ConvertTo-Json -Compress -Depth 6)"
$h2 = Get-Json '/api/site/health' 3
Write-Host "/api/site/health : $($h2 | ConvertTo-Json -Compress -Depth 6)"
if ($h1 -is [string]) { Fail "The staging Worker did not answer /api/health. $h1" }
if (-not $h1.devGrant) { Write-Host 'WARNING: devGrant is not on, so the Plan Pack will not be unlocked.' -ForegroundColor Yellow }

# 9. Sample builder login (portal) --------------------------------------------------------------------------------------
Step 'Sample builder login for the portal'
$hdr = @{ Authorization = "Bearer $tok"; 'x-gi-request' = '1' }
$cred = $null
try {
  $orgs = Invoke-RestMethod -Uri "$url/api/portal/admin/orgs" -Headers $hdr -TimeoutSec 60
  $existing = $orgs | Where-Object { $_.name -eq $SampleOrg } | Select-Object -First 1
  if ($existing) {
    # The login is only shown once, so a re-run issues a new temporary password for the sample builder's admin.
    $r = Invoke-RestMethod -Method Post -Uri "$url/api/portal/admin/orgs/$($existing.id)/reset-admin" -Headers $hdr -ContentType 'application/json' -Body '{}' -TimeoutSec 60
    $cred = $r.credentials
  } else {
    $body = @{ name = $SampleOrg; adminFirstName = 'Sam'; adminEmail = 'sample.builder@example.com' } | ConvertTo-Json
    $r = Invoke-RestMethod -Method Post -Uri "$url/api/portal/admin/orgs" -Headers $hdr -ContentType 'application/json' -Body $body -TimeoutSec 60
    $cred = $r.credentials
  }
} catch { Write-Host "Could not create the sample builder: $($_.Exception.Message)" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host " STAGING IS UP (not the live site)" -ForegroundColor Green
Write-Host "   Site and app : $url/" 
Write-Host "   Pocket Architect : $url/plan-studio/app/"
Write-Host "   Builder portal   : $url/portal/"
if ($cred) {
  Write-Host "   Sample builder login (shown once, this run only; the first sign in asks for a new password):"
  Write-Host "     Username : $($cred.username)"
  Write-Host "     Password : $($cred.password)"
} else { Write-Host "   (no sample login this run, run the script again)" }
Write-Host "   Remove it later: see STAGING.md (npx wrangler delete --config ...)"
Write-Host "=====================================================================" -ForegroundColor Green
