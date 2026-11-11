# Loads each builder's OWN house designs into that builder's LIVE Glide Inside house library (so their test builder and client logins have designs to place).
# Run from glideinside-v6\live-tools\ (the wrapper A-IMPORT-BUILDER-HOUSES.cmd does this). Needs the Worker with the import route deployed first.
#   - Reads the live admin token from ..\LIVE-ADMIN-TOKEN-keep-private.txt (never printed, never logged).
#   - Finds each organisation by slug via GET /api/portal/admin/orgs (the list carries each org's slug).
#   - Posts builder-houses\<slug>.json to POST /api/portal/admin/orgs/<id>/houses, in one request, only to that builder's own org.
#   - Safe to run again: a design with the same name in that org is replaced, never duplicated. Nothing is emailed.
#   - Writes import-builder-houses.log next to this script: builder, number imported, failures.
param(
  [string]$TokenFile = (Join-Path $PSScriptRoot '..\LIVE-ADMIN-TOKEN-keep-private.txt'),
  [string]$DataDir = (Join-Path $PSScriptRoot 'builder-houses'),
  [string]$Log = (Join-Path $PSScriptRoot 'import-builder-houses.log'),
  [string]$Site = 'https://glideinside.com.au'
)
$ErrorActionPreference = 'Stop'
$Api = "$Site/api/portal"
# slug -> display name. The planner file for Tulliplan Homes is spelled "Tullipan"; the slug (and this list) is "tulliplan".
$Builders = @(
  @{ slug = 'mcdonald-jones'; name = 'McDonald Jones Homes' }, @{ slug = 'hunter-homes'; name = 'Hunter Homes' },
  @{ slug = 'montgomery'; name = 'Montgomery Homes' }, @{ slug = 'hotondo'; name = 'Hotondo Homes' },
  @{ slug = 'mojo'; name = 'MOJO Homes' }, @{ slug = 'tulliplan'; name = 'Tulliplan Homes' }
)
$lines = New-Object System.Collections.Generic.List[string]
function Say([string]$s) { Write-Host $s; $lines.Add($s) }
function Flush { $lines | Set-Content -Path $Log -Encoding UTF8 }
function ErrText($e) { $m = $e.ErrorDetails.Message; if (-not $m) { $m = $e.Exception.Message }; if ($m -and $m.Length -gt 300) { $m = $m.Substring(0, 300) }; return $m }

Say "Builder house import (LIVE) $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
if (-not (Test-Path $TokenFile)) { Say "STOP: token file not found at $TokenFile"; Flush; exit 1 }
$raw = (Get-Content $TokenFile -Raw).Trim()
$tok = ($raw -split "`r?`n" | Where-Object { $_ -match '^[A-Za-z0-9_\-\.]{20,}$' } | Select-Object -First 1)
if (-not $tok) { $m = [regex]::Match($raw, '[A-Za-z0-9_\-\.]{32,}'); if ($m.Success) { $tok = $m.Value } }
if (-not $tok) { Say 'STOP: no admin token found in the token file.'; Flush; exit 1 }
$adm = @{ Authorization = "Bearer $tok"; 'x-gi-request' = '1' }

try { $orgs = @(Invoke-RestMethod -Uri "$Api/admin/orgs" -Headers $adm) }
catch { Say "STOP: could not list organisations: $(ErrText $_)"; Flush; exit 1 }

$totalOk = 0; $totalFail = 0
foreach ($b in $Builders) {
  $file = Join-Path $DataDir "$($b.slug).json"
  if (-not (Test-Path $file)) { Say "== $($b.name) [$($b.slug)]: no file $file, skipped"; continue }
  try {
    $org = $orgs | Where-Object { $_.slug -eq $b.slug } | Select-Object -First 1
    if (-not $org) { Say "== $($b.name) [$($b.slug)]: FAILED: no organisation with that slug on the live site. Run MAKE-BUILDER-TEST-LOGINS first."; $totalFail++; continue }
    $orgId = $org.id
    if (-not $orgId) { Say "== $($b.name) [$($b.slug)]: FAILED: the organisation row has no id."; $totalFail++; continue }
    # The file is an array of { name, description, project }. It is posted as written (no PowerShell JSON round trip) so the designs arrive byte for byte.
    $text = (Get-Content $file -Raw -Encoding UTF8).Trim()
    if (-not $text.StartsWith('[')) { throw "$file is not a JSON array of houses." }
    $okN = 0; $failN = 0; $names = @()
    try {
      $body = '{"houses":' + $text + '}'
      $res = Invoke-RestMethod -Method Post -Uri "$Api/admin/orgs/$orgId/houses" -Headers $adm -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
      foreach ($r in @($res.results)) {
        if ($r.status -eq 'failed') { $failN++; Say "     FAILED $($r.name): $($r.error)" } else { $okN++; $names += "$($r.name) ($($r.status))" }
      }
    } catch { $failN++; Say "     FAILED request: $(ErrText $_)" }
    $totalOk += $okN; $totalFail += $failN
    Say "== $($b.name) [$($b.slug)]: imported $okN, failed $failN"
    foreach ($n in $names) { Say "     $n" }
  } catch { $totalFail++; Say "== $($b.name) [$($b.slug)]: FAILED: $(ErrText $_)" }
}
Say "Total imported $totalOk, failed $totalFail"
Flush
