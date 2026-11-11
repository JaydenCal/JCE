<#
  Glide Inside LIVE smoke test. Read only apart from two harmless writes: one tiny test design (Save and share) and one unpaid
  Stripe Checkout session (it expires by itself, nothing is charged). No email is sent and no real customer data is touched.

  Run alone:   powershell -NoProfile -ExecutionPolicy Bypass -File .\smoke-live.ps1
  After the website upload, also check the 8 key pages:   ... -File .\smoke-live.ps1 -Pages
  deploy-live.ps1 runs it automatically after the deploy.

  Exit code 0 = every line PASS (WARN lines do not fail the run). Exit code 1 = at least one FAIL.
#>
param(
  [string]$BaseUrl = 'https://glideinside.com.au',
  [string]$Query = '454 Peel Street Tamworth',
  [switch]$Pages
)
$ErrorActionPreference = 'Continue'
$Base = $BaseUrl.TrimEnd('/')
$script:nPass = 0
$script:nFail = 0
$script:nWarn = 0
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('gi-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp -Force | Out-Null

function Report([string]$Name, [bool]$Ok, [string]$Detail = '', [switch]$WarnOnly) {
  if ($Ok) { $script:nPass++; $tag = 'PASS'; $col = 'Green' }
  elseif ($WarnOnly) { $script:nWarn++; $tag = 'WARN'; $col = 'Yellow' }
  else { $script:nFail++; $tag = 'FAIL'; $col = 'Red' }
  $line = ('{0}  {1}' -f $tag, $Name)
  if ($Detail) { $line = $line + '  (' + $Detail + ')' }
  Write-Host $line -ForegroundColor $col
}

# One HTTP call through curl.exe (ships with Windows 10 and 11). Returns Status, Text, Bytes, ContentType, Json.
function Call([string]$Method, [string]$Path, [string]$Body = $null, [int]$Timeout = 60, [switch]$Follow) {
  $id = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $outFile = Join-Path $Tmp ("r$id.bin")
  $hdrFile = Join-Path $Tmp ("r$id.h")
  $url = if ($Path -match '^https?://') { $Path } else { $Base + $Path }
  $a = @('-s', '-S', '-o', $outFile, '-D', $hdrFile, '-w', '%{http_code}', '-m', "$Timeout", '-A', 'GlideInside-live-smoke/1.0', '-X', $Method)
  if ($Follow) { $a += '-L' }
  if ($Body) {
    $bodyFile = Join-Path $Tmp ("b$id.json")
    [IO.File]::WriteAllText($bodyFile, $Body, (New-Object System.Text.UTF8Encoding($false)))
    $a += @('-H', 'content-type: application/json', '--data-binary', "@$bodyFile")
  }
  $a += $url
  $code = (& curl.exe @a 2>&1 | Out-String).Trim()
  $r = [ordered]@{ Status = 0; Text = ''; Bytes = 0; ContentType = ''; Json = $null; Error = '' }
  if ($code -match '(\d{3})$') { $r.Status = [int]$Matches[1] } else { $r.Error = $code }
  if (Test-Path $outFile) {
    $r.Bytes = (Get-Item $outFile).Length
    if ($r.Bytes -lt 3000000) { $r.Text = [IO.File]::ReadAllText($outFile) }
  }
  if (Test-Path $hdrFile) {
    $ms = [regex]::Matches([IO.File]::ReadAllText($hdrFile), '(?im)^content-type:\s*([^\r\n;]+)')
    if ($ms.Count -gt 0) { $r.ContentType = $ms[$ms.Count - 1].Groups[1].Value.Trim().ToLower() }
  }
  if ($r.Text -and $r.ContentType -like '*json*') { try { $r.Json = $r.Text | ConvertFrom-Json } catch { $r.Json = $null } }
  return [pscustomobject]$r
}
function Retry([scriptblock]$Try, [int]$Times = 3, [int]$Wait = 8) {
  $res = $null
  for ($i = 1; $i -le $Times; $i++) {
    $res = & $Try
    if ($res.Ok) { return $res }
    if ($i -lt $Times) { Start-Sleep -Seconds $Wait }
  }
  return $res
}

try {
  Write-Host ''
  Write-Host "Glide Inside live smoke test: $Base   ($(Get-Date -Format 'dd/MM/yyyy HH:mm:ss'))" -ForegroundColor Cyan
  Write-Host ''

  # 1. API health -------------------------------------------------------------------------------------------------------
  $h = Call 'GET' '/api/health'
  $j = $h.Json
  Report 'GET /api/health answers 200 with ok true' (($h.Status -eq 200) -and $j -and ($j.ok -eq $true)) ("HTTP $($h.Status)")
  Report '/api/health paymentsConfigured is true (Stripe secrets present)' ($j -and ($j.paymentsConfigured -eq $true)) ("paymentsConfigured=$($j.paymentsConfigured)")
  Report '/api/health sharing is true (R2 and share table bound)' ($j -and ($j.sharing -eq $true)) ("sharing=$($j.sharing)")
  Report '/api/health aiPaused is false (Anthropic key present, no spend pause)' ($j -and ($j.aiPaused -eq $false)) ("aiPaused=$($j.aiPaused)") -WarnOnly
  Report '/api/health has no devGrant (free test unlock is off)' ($j -and (-not $j.devGrant)) ''

  # 2. Government services ----------------------------------------------------------------------------------------------
  $sh = Retry { $x = Call 'GET' '/api/site/health' -Timeout 60; $x | Add-Member -NotePropertyName Ok -NotePropertyValue (($x.Status -eq 200) -and $x.Json -and ($x.Json.allOk -eq $true)) -Force -PassThru } 3 10
  if ($sh.Ok) { Report 'GET /api/site/health allOk is true' $true 'all upstream services answer' }
  elseif ($sh.Json -and $sh.Json.ok -eq $true) { Report 'GET /api/site/health allOk is true' $false 'ok is true (required services up) but allOk is false: an optional service is down. Launch can continue.' -WarnOnly }
  else { Report 'GET /api/site/health allOk is true' $false ("HTTP $($sh.Status), a required service is not answering") }

  # 3. Find my block: search, lot, aerial, contours ----------------------------------------------------------------------
  $q = [uri]::EscapeDataString($Query)
  $s = Call 'GET' "/api/site/search?q=$q" -Timeout 60
  $results = @()
  if ($s.Json -and $s.Json.results) { $results = @($s.Json.results) }
  $pick = $results | Where-Object { $_.label -match '454' } | Select-Object -First 1
  if (-not $pick -and $results.Count -gt 0) { $pick = $results[0] }
  Report "GET /api/site/search finds results for '$Query'" (($s.Status -eq 200) -and ($results.Count -gt 0)) ("HTTP $($s.Status), $($results.Count) results, first: $($pick.label)")

  $lot = $null
  if ($pick) {
    $lotPath = "/api/site/lot?lon=$($pick.lon)&lat=$($pick.lat)&state=$($pick.state)"
    $l = Retry { $x = Call 'GET' $lotPath -Timeout 90; $ok = ($x.Status -eq 200) -and $x.Json -and $x.Json.lot -and $x.Json.lot.lotLabel -and (@($x.Json.neighbours).Count -gt 0); $x | Add-Member -NotePropertyName Ok -NotePropertyValue $ok -Force -PassThru } 3 8
    $lot = $l.Json
    $nb = 0
    if ($lot) { $nb = @($lot.neighbours).Count }
    Report 'GET /api/site/lot returns a lot label and neighbours' ($l.Ok -eq $true) ("HTTP $($l.Status), label: $($lot.lot.lotLabel), neighbours: $nb")
  } else {
    Report 'GET /api/site/lot returns a lot label and neighbours' $false 'skipped, the search gave no result'
  }

  if ($lot -and $lot.lot -and $lot.lot.bboxMga) {
    $b = $lot.lot.bboxMga
    $org = "$($lot.origin.e),$($lot.origin.n)"
    $bigBox = "$($b.minE - 10),$($b.minN - 10),$($b.maxE + 10),$($b.maxN + 10)"
    $lotBox = "$($b.minE),$($b.minN),$($b.maxE),$($b.maxN)"
    $aerialPath = "/api/site/aerial?state=$($lot.state)&srid=$($lot.srid)&bbox=$bigBox&origin=$org"
    $ae = Retry { $x = Call 'GET' $aerialPath -Timeout 120; $x | Add-Member -NotePropertyName Ok -NotePropertyValue (($x.Status -eq 200) -and ($x.ContentType -like 'image/*') -and ($x.Bytes -gt 1000)) -Force -PassThru } 2 8
    Report 'GET /api/site/aerial returns 200 and an image' ($ae.Ok -eq $true) ("HTTP $($ae.Status), $($ae.ContentType), $($ae.Bytes) bytes")
    $contourPath = "/api/site/contours?state=$($lot.state)&srid=$($lot.srid)&bbox=$lotBox&buffer=10&origin=$org"
    $co = Retry { $x = Call 'GET' $contourPath -Timeout 120; $x | Add-Member -NotePropertyName Ok -NotePropertyValue (($x.Status -eq 200) -and ($x.ContentType -like '*json*') -and ($x.Json -ne $null)) -Force -PassThru } 2 8
    Report 'GET /api/site/contours returns 200 and JSON' ($co.Ok -eq $true) ("HTTP $($co.Status), $($co.ContentType), $($co.Bytes) bytes")
  } else {
    Report 'GET /api/site/aerial returns 200 and an image' $false 'skipped, no lot'
    Report 'GET /api/site/contours returns 200 and JSON' $false 'skipped, no lot'
  }

  # 4. Save and share round trip ------------------------------------------------------------------------------------------
  $proj = '{"project":{"schema":1,"id":"golive-smoke","name":"GI launch smoke test (safe to ignore)","levels":[{"id":"L0","name":"Ground"}]}}'
  $c = Call 'POST' '/api/projects' $proj -Timeout 60
  $sid = $null
  if ($c.Json) { $sid = $c.Json.id }
  Report 'POST /api/projects creates a shared design' (($c.Status -eq 201) -and $sid -and $c.Json.editKey) ("HTTP $($c.Status), id: $sid")
  if ($sid) {
    $g = Call 'GET' "/api/projects/$sid" -Timeout 60
    Report 'GET /api/projects/<id> reads it back (share link round trip)' (($g.Status -eq 200) -and $g.Json -and $g.Json.project -and ($g.Json.project.name -like 'GI launch smoke test*')) ("HTTP $($g.Status)")
  } else {
    Report 'GET /api/projects/<id> reads it back (share link round trip)' $false 'skipped, nothing was created'
  }
  Write-Host 'INFO  There is no delete endpoint for shared designs. The test design is tiny and expires by itself after PROJECT_TTL_DAYS.' -ForegroundColor DarkGray
  $nf = Call 'GET' '/api/projects/doesnotexist1234567' -Timeout 60
  Report 'GET /api/projects/<unknown id> answers 404' ($nf.Status -eq 404) ("HTTP $($nf.Status)")

  # 5. Stripe Checkout in LIVE mode (a session is created, never paid; it expires on its own) -------------------------------
  $ck = Call 'POST' '/api/checkout' '{"projectId":"golive-smoke","projectName":"Smoke test (do not pay)"}' -Timeout 60
  $cu = ''
  if ($ck.Json -and $ck.Json.url) { $cu = [string]$ck.Json.url }
  Report 'POST /api/checkout returns a checkout.stripe.com URL' (($ck.Status -eq 200) -and ($cu -match '^https://checkout\.stripe\.com/')) ("HTTP $($ck.Status)")
  Report 'Checkout session is LIVE mode (cs_live_), not test' ($cu -match 'cs_live_') ($(if ($cu -match 'cs_test_') { 'this is a TEST mode session: STRIPE_SECRET_KEY is a test key' } elseif ($cu) { 'session id prefix checked, URL not printed' } else { 'no URL' }))

  # 6. Builder portal -----------------------------------------------------------------------------------------------------
  $pm = Call 'GET' '/api/portal/me' $null -Timeout 60
  Report 'GET /api/portal/me without a login answers 401 (not 500)' ($pm.Status -eq 401) ("HTTP $($pm.Status)")
  $tr = Call 'POST' '/api/portal/trial-request' '{"consent":false,"email":"not-an-email"}' -Timeout 60
  Report 'POST /api/portal/trial-request with an invalid body answers 400' ($tr.Status -eq 400) ("HTTP $($tr.Status)")

  # 7. The 8 key site pages (only with -Pages, after the cPanel upload and the cache purge) -----------------------------------
  if ($Pages) {
    Write-Host ''
    Write-Host 'Key pages (after upload and cache purge)' -ForegroundColor Cyan
    $stamp = [DateTime]::UtcNow.Ticks
    $pageList = @(
      @{ P = '/'; Has = 'Setbacks drawn from council or state code rules'; Not = '' },
      @{ P = '/plans/'; Has = ''; Not = 'Free to draw' },
      @{ P = '/pricing/'; Has = ''; Not = '' },
      @{ P = '/for-builders/'; Has = ''; Not = '' },
      @{ P = '/plan-studio/launch/'; Has = ''; Not = '' },
      @{ P = '/plan-studio/app/'; Has = ''; Not = '' },
      @{ P = '/portal/'; Has = ''; Not = '' },
      @{ P = '/subdivision/'; Has = 'gi-chrome.css'; Not = '' }
    )
    foreach ($pg in $pageList) {
      $r = Call 'GET' ("$($pg.P)?gi=$stamp") $null -Timeout 60 -Follow
      $ok = ($r.Status -eq 200) -and ($r.Bytes -gt 2000)
      $why = "HTTP $($r.Status), $($r.Bytes) bytes"
      if ($ok -and $pg.Has -and ($r.Text -notmatch [regex]::Escape($pg.Has))) { $ok = $false; $why = "missing text: $($pg.Has)  (old page cached, or the upload or reskin was not done)" }
      if ($ok -and $pg.Not) {
        $top = $r.Text.Substring(0, [Math]::Min(5000, $r.Text.Length))
        if ($top -match [regex]::Escape($pg.Not)) { $ok = $false; $why = "still says: $($pg.Not)  (old page cached or not uploaded)" }
      }
      Report "GET $($pg.P)" $ok $why
    }
  }
}
finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

Write-Host ''
$summary = "Smoke test: $($script:nPass) PASS, $($script:nFail) FAIL, $($script:nWarn) WARN"
if ($script:nFail -eq 0) { Write-Host $summary -ForegroundColor Green; exit 0 }
Write-Host $summary -ForegroundColor Red
exit 1
