# Creates one test organisation per builder on the home page picker, on the LIVE site, with a builder admin login and one client login.
# Reads the live admin token from LIVE-ADMIN-TOKEN-keep-private.txt (never printed). Writes BUILDER-TEST-LOGINS.txt next to this script's folder.
# Safe to run twice: a builder whose slug already has an organisation is skipped (its admin login is reset instead and the new temporary password written).
param([string]$TokenFile = (Join-Path $PSScriptRoot '..\LIVE-ADMIN-TOKEN-keep-private.txt'), [string]$Out = (Join-Path $PSScriptRoot '..\BUILDER-TEST-LOGINS.txt'))
$ErrorActionPreference = 'Stop'
$Site = 'https://glideinside.com.au'
$Api = "$Site/api/portal"
$Builders = @(
  @{ slug = 'mcdonald-jones'; name = 'McDonald Jones Homes' }, @{ slug = 'hunter-homes'; name = 'Hunter Homes' },
  @{ slug = 'masterton'; name = 'Masterton Homes' }, @{ slug = 'coral-homes'; name = 'Coral Homes' },
  @{ slug = 'hotondo'; name = 'Hotondo Homes' }, @{ slug = 'mojo'; name = 'MOJO Homes' },
  @{ slug = 'montgomery'; name = 'Montgomery Homes' }, @{ slug = 'allworth'; name = 'Allworth Homes' },
  @{ slug = 'tulliplan'; name = 'Tulliplan Homes' }, @{ slug = 'gj-gardner'; name = 'G.J. Gardner Homes' }
)
$raw = (Get-Content $TokenFile -Raw).Trim()
$tok = ($raw -split "`r?`n" | Where-Object { $_ -match '^[A-Za-z0-9_\-\.]{20,}$' } | Select-Object -First 1)
if (-not $tok) { $m = [regex]::Match($raw, '[A-Za-z0-9_\-\.]{32,}'); if ($m.Success) { $tok = $m.Value } }
if (-not $tok) { throw 'No admin token found in the token file.' }
$adm = @{ Authorization = "Bearer $tok"; 'x-gi-request' = '1' }
$web = @{ 'x-gi-request' = '1'; Origin = $Site }
function J($o) { $o | ConvertTo-Json -Depth 6 -Compress }
function NewPw { $w = 'river','stone','maple','harbour','summit','cedar','meadow','ember','delta','granite'; ($w | Get-Random) + '-' + ($w | Get-Random) + '-' + (Get-Random -Minimum 10 -Maximum 99) + 'Gx' }

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("GLIDE INSIDE builder test logins (LIVE site) created $(Get-Date -Format 'dd/MM/yyyy HH:mm')")
$lines.Add('Temporary passwords: each login asks for a new password at first sign in. Temporary passwords expire after a few days; reset from the portal admin if needed.')
$lines.Add('')
$existing = Invoke-RestMethod -Uri "$Api/admin/orgs" -Headers $adm
foreach ($b in $Builders) {
  try {
    $brand = $null; try { $brand = Invoke-RestMethod -Uri "$Api/brand/$($b.slug)" } catch {}
    if ($brand -and $brand.name) {
      $org = $existing | Where-Object { $_.name -eq $brand.name } | Select-Object -First 1
      $lines.Add("== $($b.name): already set up (org '$($brand.name)'), skipped. Reset its admin from the portal admin page if you need a new password.")
      $lines.Add(''); continue
    }
    $c = Invoke-RestMethod -Method Post -Uri "$Api/admin/orgs" -Headers $adm -ContentType 'application/json' -Body (J @{ name = $b.name; adminFirstName = 'Builder' })
    $orgId = $c.org.id
    Invoke-RestMethod -Method Post -Uri "$Api/admin/orgs/$orgId/slug" -Headers $adm -ContentType 'application/json' -Body (J @{ slug = $b.slug }) | Out-Null
    # Sign in as the builder admin to issue one client login, then hand the builder a fresh temporary password.
    $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    Invoke-RestMethod -Method Post -Uri "$Api/session" -WebSession $s -Headers $web -ContentType 'application/json' -Body (J @{ identifier = $c.credentials.username; password = $c.credentials.password }) | Out-Null
    $pw = NewPw
    Invoke-RestMethod -Method Post -Uri "$Api/password" -WebSession $s -Headers $web -ContentType 'application/json' -Body (J @{ currentPassword = $c.credentials.password; newPassword = $pw }) | Out-Null
    $cl = Invoke-RestMethod -Method Post -Uri "$Api/clients" -WebSession $s -Headers $web -ContentType 'application/json' -Body (J @{ firstName = 'Test client'; houseAccess = 'all' })
    try { Invoke-RestMethod -Method Delete -Uri "$Api/session" -WebSession $s -Headers $web | Out-Null } catch {}
    $ra = Invoke-RestMethod -Method Post -Uri "$Api/admin/orgs/$orgId/reset-admin" -Headers $adm -ContentType 'application/json' -Body '{}'
    $lines.Add("== $($b.name)")
    $lines.Add("  Builder sign in : $Site/portal/?builder=$($b.slug)&role=builder")
    $lines.Add("    Username      : $($ra.credentials.username)")
    $lines.Add("    Temp password : $($ra.credentials.password)")
    $lines.Add("  Client sign in  : $Site/portal/?builder=$($b.slug)&role=client")
    $lines.Add("    Username      : $($cl.credentials.username)")
    $lines.Add("    Temp password : $($cl.credentials.password)")
    $lines.Add('')
  } catch {
    $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
    $lines.Add("== $($b.name): FAILED: $msg"); $lines.Add('')
  }
}
$lines | Set-Content -Path $Out -Encoding UTF8
'done' | Set-Content -Path (Join-Path $PSScriptRoot '..\builder-test-logins.log')
