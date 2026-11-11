<#
  Glide Inside LIVE deploy: replaces the Worker "pocket-architect-api" (route glideinside.com.au/api/*) with the release code.

  Normal use: double-click RUN-LIVE-DEPLOY.cmd (it runs this script). Run it AFTER SET-LIVE-KEYS-TOMORROW.cmd.

  What it does, in order. It stops at the first problem and says why. Nothing is changed until step 4.
    1. Preflight: node, wrangler login, the live config (Worker name, route, D1 id, no staging names, no secret under [vars],
       PLAN_PACK_PRICE_CENTS 3000, PORTAL_ENABLED 1), the migration files, and that every required secret EXISTS (names only, never values).
    2. Notes what is live now (health, previous Worker version id for rollback).
    3. Asks you to press Enter (skip with -NoPrompt).
    4. Backs up the live D1 database to a timestamped .sql file in Downloads, applies the remaining migrations, deploys the Worker.
    5. Runs smoke-live.ps1 and prints PASS or FAIL with the exact rollback command.

  Options:  -PreflightOnly  steps 1 and 2 plus a wrangler dry run. Changes nothing. Safe to run tonight.
            -NoPrompt       do not wait for Enter before step 4.
            -ShareId <id>   an existing share link id (the part after ?share=) that must still open after the deploy.

  Log: golive-deploy.log next to this script.
#>
param(
  [switch]$PreflightOnly,
  [switch]$NoPrompt,
  [string]$ShareId = ''
)
$ErrorActionPreference = 'Stop'
$env:CI = 'true'
$env:WRANGLER_SEND_METRICS = 'false'
$env:NO_UPDATE_NOTIFIER = '1'
$env:npm_config_update_notifier = 'false'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Here                                   # ...\GlideInside
$Src = Join-Path $Root 'pocket-architect-source'
$Cfg = Join-Path $Here 'wrangler.live.toml'
$Log = Join-Path $Here 'golive-deploy.log'
$Smoke = Join-Path $Here 'smoke-live.ps1'
$Live = 'https://glideinside.com.au'
$WorkerName = 'pocket-architect-api'
$LiveDbId = 'fccdf1f7-e48c-4c72-8723-b343b3f2fad4'
$GuidRe = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
$RequiredSecrets = @('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'RESEND_API_KEY', 'ADMIN_TOKEN', 'ENTITLEMENT_SECRET', 'IP_HASH_SALT', 'ANTHROPIC_API_KEY')
$RequiredMigrations = @('0009_glide_library_default_off.sql', '0010_org_brand_colours.sql', '0011_org_slug.sql')
$script:Changed = $false         # becomes true at the first step that changes anything live
$script:PrevVersion = ''
$script:NewVersion = ''
$script:Backup = ''
$script:WrExit = 0

try { Start-Transcript -Path $Log -Force | Out-Null } catch {}

function Step([string]$m) { Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "OK    $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "WARN  $m" -ForegroundColor Yellow }
function Fail([string]$m) {
  Write-Host ''
  Write-Host "STOPPED: $m" -ForegroundColor Red
  if ($script:Changed) { Show-Rollback }
  else { Write-Host 'Nothing live was changed.' -ForegroundColor Yellow }
  Write-Host "Log: $Log"
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}

# Runs wrangler from the golive folder with the live config. Returns the output text and sets $script:WrExit.
function Wrangler {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  Push-Location $Here
  try {
    $wa = @($args)
    $out = & $script:WranglerBin @wa 2>&1 | ForEach-Object { "$_" }
    $script:WrExit = $LASTEXITCODE
  } finally { Pop-Location; $ErrorActionPreference = $prev }
  return ($out -join "`n")
}

function Rollback-Command {
  $id = if ($script:PrevVersion) { $script:PrevVersion } else { '<VERSION ID from: wrangler deployments list>' }
  return ('"{0}" rollback {1} --config "{2}" --message "Glide Inside launch rollback" --yes' -f $script:WranglerBin, $id, $Cfg)
}
function Show-Rollback {
  Write-Host ''
  Write-Host 'IF THE NEW WORKER IS LIVE AND YOU WANT IT UNDONE (the database needs no undo: 0009 changes one default, show_glide_to_clients to 0, and 0010 and 0011 only add columns). Do not sell until the new Worker is redeployed:' -ForegroundColor Yellow
  Write-Host ('  ' + (Rollback-Command))
  Write-Host '  or double-click golive\ROLLBACK-LIVE.cmd, or Cloudflare dashboard > Workers and Pages > pocket-architect-api > Deployments > Rollback.'
  Write-Host "  D1 backup taken before the change: $($script:Backup)"
}

function Strip-Lines([string]$text) {
  return @($text -split "`r?`n" | ForEach-Object { ($_ -replace '#.*$', '').Trim() } | Where-Object { $_ -ne '' })
}

function Curl-Text([string]$url) {
  $out = & curl.exe -s -m 60 -A 'GlideInside-golive/1.0' $url 2>&1 | Out-String
  return $out.Trim()
}

# ------------------------------------------------------------------------------------------------------------------------
Write-Host ''
Write-Host 'Glide Inside LIVE deploy' -ForegroundColor Cyan
Write-Host "$(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')   Worker $WorkerName   route glideinside.com.au/api/*"
if ($PreflightOnly) { Write-Host 'PREFLIGHT ONLY: nothing will be changed.' -ForegroundColor Yellow }

# 1. Preflight -----------------------------------------------------------------------------------------------------------
Step '1. Preflight: tools'
try { $nodeV = (& node -v) } catch { Fail 'Node.js is not installed. Install Node 20 or newer from https://nodejs.org and run this again.' }
$major = [int](($nodeV -replace '^v', '') -split '\.')[0]
if ($major -lt 20) { Fail "Node $nodeV is too old. Install Node 20 or newer." }
Ok "node $nodeV"

$script:WranglerBin = ''
foreach ($cand in @((Join-Path $Root 'staging\node_modules\.bin\wrangler.cmd'), (Join-Path $Src 'node_modules\.bin\wrangler.cmd'))) {
  if (Test-Path $cand) { $script:WranglerBin = $cand; break }
}
if (-not $script:WranglerBin) {
  $stg = Join-Path $Root 'staging'
  if (Test-Path (Join-Path $stg 'package.json')) {
    Warn 'wrangler is not installed in staging. Running npm ci there (this can take a minute).'
    Push-Location $stg
    try {
      & npm ci 2>&1 | Out-Host
      if ($LASTEXITCODE -ne 0) { Warn 'npm ci failed, trying npm install.'; & npm install 2>&1 | Out-Host }
    } finally { Pop-Location }
    $cand = Join-Path $stg 'node_modules\.bin\wrangler.cmd'
    if (Test-Path $cand) { $script:WranglerBin = $cand }
  }
}
if (-not $script:WranglerBin) { Fail 'wrangler is not installed. Expected staging\node_modules\.bin\wrangler.cmd (run the staging deploy once, or run npm ci in the staging folder).' }
$wv = Wrangler '--version'
Ok ("wrangler " + ($wv | Select-String -Pattern '\d+\.\d+\.\d+' | Select-Object -First 1))

$RepoMode = Test-Path (Join-Path $Src 'tools\build-single.mjs')
$needSrc = -not (Test-Path (Join-Path $Src 'node_modules\jspdf')) -or -not (Test-Path (Join-Path $Src 'node_modules\three'))
if ($needSrc) {
  Write-Host 'Installing the server libraries (pocket-architect-source), one time...'
  Push-Location $Src
  try {
    if ($RepoMode) { & npm ci --no-audit --no-fund } else { & npm ci --omit=dev --no-audit --no-fund }
    $npmCode = $LASTEXITCODE
  } finally { Pop-Location }
  if ($npmCode -ne 0) { Fail 'npm ci failed in pocket-architect-source.' }
}
Ok 'server libraries present (jspdf, three)'

Step '1. Preflight: the live config'
if (-not (Test-Path $Cfg)) { Fail "Missing $Cfg. It is part of the golive folder." }
$lines = Strip-Lines (Get-Content $Cfg -Raw)
$nameLine = $lines | Where-Object { $_ -match '^name\s*=' } | Select-Object -First 1
if ($nameLine -ne 'name = "pocket-architect-api"') { Fail "The Worker name in wrangler.live.toml is not $WorkerName ($nameLine)." }
if (-not ($lines | Where-Object { $_ -match '^routes\s*=.*glideinside\.com\.au/api/\*' })) { Fail 'The route glideinside.com.au/api/* is not in wrangler.live.toml.' }
if ($lines -notcontains "database_id = `"$LiveDbId`"") { Fail "wrangler.live.toml does not use the live D1 database id $LiveDbId." }
if ($lines -notcontains 'database_name = "pocket-architect"') { Fail 'The D1 database name must be pocket-architect.' }
if ($lines -notcontains 'bucket_name = "pocket-architect-files"') { Fail 'The R2 bucket must be pocket-architect-files.' }
if ($lines | Where-Object { $_ -match 'staging' -or $_ -match '(?i)^STAGING\s*=' }) { Fail 'wrangler.live.toml contains a staging name or the STAGING variable. Refusing.' }
if ($lines | Where-Object { $_ -match '^workers_dev\s*=\s*true' }) { Fail 'workers_dev = true found. The live config must not publish a workers.dev copy.' }
$secretUnderVars = $lines | Where-Object { $_ -match '^(STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PRICE_ID|RESEND_API_KEY|ADMIN_TOKEN|ENTITLEMENT_SECRET|IP_HASH_SALT|ANTHROPIC_API_KEY|TEST_CODES)\s*=' }
if ($secretUnderVars) { Fail 'A secret name is set under [vars] in wrangler.live.toml. That would overwrite the secret on deploy. Refusing.' }
if ($lines -notcontains 'PLAN_PACK_PRICE_CENTS = "3000"') { Fail 'PLAN_PACK_PRICE_CENTS is not "3000" in the vars.' }
if ($lines -notcontains 'PORTAL_ENABLED = "1"') { Fail 'PORTAL_ENABLED is not "1" in the vars.' }
if ($lines | Where-Object { $_ -match 'REPLACE-WITH|PASTE_ID' }) { Fail 'wrangler.live.toml still has a placeholder.' }
Ok 'name pocket-architect-api, route glideinside.com.au/api/*, live D1 id, live R2 bucket'
Ok 'no staging names, no secret under [vars], PLAN_PACK_PRICE_CENTS 3000, PORTAL_ENABLED 1'
$mainLine = $lines | Where-Object { $_ -match '^main\s*=' } | Select-Object -First 1
$migLine = $lines | Where-Object { $_ -match '^migrations_dir\s*=' } | Select-Object -First 1
$mainRel = ([regex]::Match($mainLine, '"([^"]+)"')).Groups[1].Value
$migRel = ([regex]::Match($migLine, '"([^"]+)"')).Groups[1].Value
if (-not (Test-Path (Join-Path $Here $mainRel))) { Fail "The Worker code is missing: $mainRel (relative to golive)." }
$MigDir = Join-Path $Here $migRel
if (-not (Test-Path $MigDir)) { Fail "The migrations folder is missing: $migRel." }
foreach ($mf in $RequiredMigrations) {
  if (-not (Test-Path (Join-Path $MigDir $mf))) { Fail "Migration file $mf is not in the package. This package is older than the release. Get the newest package." }
}
Ok ("migration files present: " + ((Get-ChildItem $MigDir -Filter '*.sql' | Sort-Object Name | ForEach-Object { $_.Name.Substring(0, 4) }) -join ' '))

Step '1. Preflight: Cloudflare login'
$who = Wrangler 'whoami'
if ($who -match 'not authenticated|not logged in|You are not logged in') { Fail 'wrangler is not logged in. Open PowerShell in the staging folder and run:  node_modules\.bin\wrangler.cmd login   then run this again.' }
Write-Host ($who -split "`n" | Select-Object -First 14 | Out-String).TrimEnd()
Ok 'wrangler is logged in'

Step '1. Preflight: required secrets exist (names only, values are never shown)'
$sl = Wrangler 'secret' 'list' '--config' $Cfg '--format' 'json'
if ($script:WrExit -ne 0) { Fail 'Could not list the Worker secrets. Is the Worker pocket-architect-api in this Cloudflare account?' }
$haveNames = @([regex]::Matches($sl, '"name"\s*:\s*"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
Write-Host ('Secrets on the live Worker: ' + ($haveNames -join ', '))
$missing = @($RequiredSecrets | Where-Object { $haveNames -notcontains $_ })
if ($missing.Count -gt 0) { Fail ('These secrets are not set on the live Worker: ' + ($missing -join ', ') + '. Run SET-LIVE-KEYS-TOMORROW.cmd first (Stripe and Resend). ADMIN_TOKEN: GO-LIVE.md Step 3.') }
Ok 'all required secrets exist'
if ($haveNames -contains 'TEST_CODES') { Warn 'TEST_CODES is set. Test codes unlock free Plan Packs. Delete it if it is not wanted:  wrangler secret delete TEST_CODES' }

Step '1. Preflight: bundle check (dry run, deploys nothing)'
$dry = Wrangler 'deploy' '--dry-run' '--config' $Cfg
Write-Host ($dry -split "`n" | Select-Object -Last 25 | Out-String).TrimEnd()
if ($script:WrExit -ne 0) { Fail 'wrangler deploy --dry-run failed. Nothing was changed.' }
if ($dry -notmatch 'env\.DB' -or $dry -notmatch 'env\.FILES') { Fail 'The dry run does not list the DB and FILES bindings.' }
Ok 'the Worker bundles and lists env.DB (pocket-architect) and env.FILES (pocket-architect-files)'

# 2. What is live now ------------------------------------------------------------------------------------------------------
Step '2. What is live now'
$hNow = Curl-Text "$Live/api/health"
Write-Host "Health now: $hNow"
if ($ShareId) {
  $shNow = Curl-Text "$Live/api/projects/$ShareId"
  if ($shNow -match '"project"') { Ok "existing share link $ShareId opens on the current Worker" } else { Warn "existing share link $ShareId did not return a design on the current Worker: $($shNow.Substring(0, [Math]::Min(120, $shNow.Length)))" }
}
$ds = Wrangler 'deployments' 'status' '--json' '--config' $Cfg
$vm = [regex]::Matches($ds, '"version_id"\s*:\s*"(' + $GuidRe + ')"')
if ($vm.Count -gt 0) { $script:PrevVersion = $vm[0].Groups[1].Value }
if (-not $script:PrevVersion) {
  $dls = Wrangler 'deployments' 'list' '--json' '--config' $Cfg
  $vm = [regex]::Matches($dls, '"version_id"\s*:\s*"(' + $GuidRe + ')"')
  if ($vm.Count -gt 0) { $script:PrevVersion = $vm[$vm.Count - 1].Groups[1].Value }
}
if ($script:PrevVersion) { Ok "current live version (the rollback target): $($script:PrevVersion)" }
else { Warn 'Could not read the current version id. Rollback will use:  wrangler deployments list  then  wrangler rollback <id>.' }
$pl = Wrangler 'd1' 'migrations' 'list' 'pocket-architect' '--remote' '--config' $Cfg
Write-Host 'Migrations status on the live database:'
Write-Host ($pl -split "`n" | Select-Object -Last 20 | Out-String).TrimEnd()

if ($PreflightOnly) {
  Write-Host ''
  Write-Host 'PREFLIGHT PASSED. Nothing was changed. Run RUN-LIVE-DEPLOY.cmd to deploy.' -ForegroundColor Green
  try { Stop-Transcript | Out-Null } catch {}
  exit 0
}

# 3. Go -----------------------------------------------------------------------------------------------------------------------
Step '3. Ready to change the LIVE site'
Write-Host 'Next: D1 backup, migrations (additive), Worker deploy, smoke test.'
if (-not $NoPrompt) { [void](Read-Host 'Press Enter to deploy LIVE (close this window to stop)') }

# 4. Backup, migrations, deploy ------------------------------------------------------------------------------------------------
Step '4a. D1 backup'
$dl = Join-Path $env:USERPROFILE 'Downloads'
if (-not (Test-Path $dl)) { $dl = $Here }
$script:Backup = Join-Path $dl ('pocket-architect-before-golive-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql')
$ex = Wrangler 'd1' 'export' 'pocket-architect' '--remote' '--output' $script:Backup '--config' $Cfg
if ($script:WrExit -ne 0 -or -not (Test-Path $script:Backup) -or ((Get-Item $script:Backup).Length -lt 100)) { Write-Host $ex; Fail 'The D1 backup failed. Stopping before any change.' }
Ok ("backup saved: {0} ({1} KB)" -f $script:Backup, [Math]::Round((Get-Item $script:Backup).Length / 1024))

# From here a Worker rollback command is shown on any failure.
Step '4b. Migrations (additive, recorded, safe to run again)'
$script:Changed = $true
$mg = Wrangler 'd1' 'migrations' 'apply' 'pocket-architect' '--remote' '--config' $Cfg
Write-Host $mg
if ($script:WrExit -ne 0) { Fail 'A migration failed. The Worker was NOT deployed (the old Worker still runs). Send this log to Claude.' }
$ml = Wrangler 'd1' 'migrations' 'list' 'pocket-architect' '--remote' '--config' $Cfg
if ($ml -match 'No migrations to apply') { Ok 'every migration is applied (0009, 0010 and 0011 included)' }
else { Write-Host $ml; Warn 'migrations list did not say "No migrations to apply". Check the list above before trusting the deploy.' }

Step '4c. Deploy the Worker'
$dep = Wrangler 'deploy' '--keep-vars' '--config' $Cfg
Write-Host $dep
if ($script:WrExit -ne 0) { Fail 'wrangler deploy failed. The old Worker should still be running; check the health line above.' }
$nv = [regex]::Match($dep, '(?i)Current Version ID:\s*(' + $GuidRe + ')')
if ($nv.Success) { $script:NewVersion = $nv.Groups[1].Value; Ok "deployed, new version: $($script:NewVersion)" } else { Ok 'deployed (version id not printed)' }

# Write the one-click rollback file now that the target is known.
$rb = '@echo off' + "`r`n" + 'echo This puts the previous Glide Inside Worker version back on glideinside.com.au/api/*.' + "`r`n" + 'pause' + "`r`n" + 'call ' + (Rollback-Command) + "`r`n" + 'echo.' + "`r`n" + 'pause' + "`r`n"
try { [IO.File]::WriteAllText((Join-Path $Here 'ROLLBACK-LIVE.cmd'), $rb, (New-Object System.Text.UTF8Encoding($false))) } catch { Warn 'Could not write ROLLBACK-LIVE.cmd' }

# 5. Smoke ------------------------------------------------------------------------------------------------------------------------
Step '5. Smoke test (live)'
Start-Sleep -Seconds 10
$smokeCode = 1
if (Test-Path $Smoke) {
  & $Smoke -BaseUrl $Live
  $smokeCode = $LASTEXITCODE
} else { Warn 'smoke-live.ps1 is missing.' }
$shareOk = $true
if ($ShareId) {
  $shAfter = Curl-Text "$Live/api/projects/$ShareId"
  if ($shAfter -match '"project"') { Ok "existing share link $ShareId still opens" } else { $shareOk = $false; Write-Host "FAIL  existing share link $ShareId no longer opens" -ForegroundColor Red }
}

Write-Host ''
Write-Host '=====================================================================' -ForegroundColor Cyan
if ($smokeCode -eq 0 -and $shareOk) {
  Write-Host ' LIVE DEPLOY: PASS' -ForegroundColor Green
  Write-Host ' Next: upload the site (UPLOAD-STEPS.md), then run smoke-live.ps1 -Pages.'
} else {
  Write-Host ' LIVE DEPLOY: FAIL (see the FAIL lines above)' -ForegroundColor Red
  Write-Host ' Decide: fix forward, or undo with the rollback command below, and send this log to Claude.'
}
Write-Host " Previous version : $($script:PrevVersion)"
Write-Host " New version      : $($script:NewVersion)"
Write-Host " D1 backup        : $($script:Backup)"
Write-Host " Log              : $Log"
Show-Rollback
Write-Host '=====================================================================' -ForegroundColor Cyan
try { Stop-Transcript | Out-Null } catch {}
if ($smokeCode -eq 0 -and $shareOk) { exit 0 } else { exit 1 }
