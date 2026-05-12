# =====================================================================
# TowCommand - Railway deploy script (idempotent, Railway CLI v4 syntax).
#
# Prerequisites:
#   1. railway login   (one time, interactive, opens a browser)
#   2. cd C:\dev\towcommand
#   3. .\scripts\railway\deploy.ps1
#
# Re-running is safe: every step skips work that's already done.
# =====================================================================

$ErrorActionPreference = 'Stop'

function Require-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing required CLI: $name."
  }
}

function Try-Cmd {
  # Run a railway command. Print its output. Don't blow up on non-zero exit —
  # we treat "already exists" / "already linked" as success and continue.
  param([Parameter(ValueFromRemainingArguments)] [string[]] $cmd)
  $joined = ($cmd -join ' ')
  Write-Host "    $ railway $joined" -ForegroundColor DarkGray
  & railway @cmd 2>&1 | ForEach-Object { Write-Host "      $_" }
  return $LASTEXITCODE
}

Require-Cmd railway
Require-Cmd git

$repoRoot = (git rev-parse --show-toplevel)
Set-Location $repoRoot

$projectName = 'towcommand-prod'
$backend     = 'backend'
$web         = 'web'

# ---------------------------------------------------------------------
# 1. Link project (skip if already linked to towcommand-prod)
# ---------------------------------------------------------------------
Write-Host "==> 1. Link Railway project: $projectName" -ForegroundColor Cyan
$statusJson = railway status --json 2>&1 | Out-String
$alreadyLinked = $false
try {
  $status = $statusJson | ConvertFrom-Json
  if ($status.name -eq $projectName) { $alreadyLinked = $true }
} catch { }

if ($alreadyLinked) {
  Write-Host "    already linked to $projectName, skipping" -ForegroundColor DarkGreen
} else {
  Try-Cmd link --project $projectName | Out-Null
  # Verify
  $statusJson = railway status --json 2>&1 | Out-String
  try {
    $status = $statusJson | ConvertFrom-Json
    if ($status.name -ne $projectName) {
      throw "Failed to link to $projectName. Got: $($status.name)"
    }
  } catch {
    throw "Failed to read project status after link. CLI returned: $statusJson"
  }
}

# ---------------------------------------------------------------------
# 2. List existing services - used to skip-create where present
# ---------------------------------------------------------------------
Write-Host "==> 2. Inventory services" -ForegroundColor Cyan
$svcListJson = railway service list --json 2>&1 | Out-String
$existingServices = @()
try {
  $svcArr = $svcListJson | ConvertFrom-Json
  foreach ($s in $svcArr) { $existingServices += $s.name }
  Write-Host "    existing services: $($existingServices -join ', ')" -ForegroundColor DarkGreen
} catch {
  Write-Host "    (could not parse service list; will attempt to create all)" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------
# 3. Postgres + Redis databases (idempotent — Railway "add --database"
#    errors out if already present, which we treat as success)
# ---------------------------------------------------------------------
Write-Host "==> 3. Ensure Postgres + Redis are provisioned" -ForegroundColor Cyan
if ($existingServices -notcontains 'Postgres') {
  Try-Cmd add --database postgres --json | Out-Null
} else {
  Write-Host "    Postgres already present, skipping" -ForegroundColor DarkGreen
}
if ($existingServices -notcontains 'Redis') {
  Try-Cmd add --database redis --json | Out-Null
} else {
  Write-Host "    Redis already present, skipping" -ForegroundColor DarkGreen
}

# ---------------------------------------------------------------------
# 4. Create backend + web services
# ---------------------------------------------------------------------
Write-Host "==> 4. Ensure backend + web services exist" -ForegroundColor Cyan
if ($existingServices -notcontains $backend) {
  Try-Cmd add --service $backend --json | Out-Null
} else {
  Write-Host "    $backend service already present, skipping" -ForegroundColor DarkGreen
}
if ($existingServices -notcontains $web) {
  Try-Cmd add --service $web --json | Out-Null
} else {
  Write-Host "    $web service already present, skipping" -ForegroundColor DarkGreen
}

# ---------------------------------------------------------------------
# 5. Push env vars. --skip-deploys keeps Railway from redeploying after
#    every variable set; we trigger a single explicit deploy at the end.
# ---------------------------------------------------------------------
function Set-EnvFile {
  param([string]$Service, [string]$Path)
  if (-not (Test-Path $Path)) { throw "Env file not found: $Path" }
  Write-Host "    -> $Service from $Path" -ForegroundColor DarkGray
  Get-Content $Path | Where-Object { $_ -and $_ -notmatch '^\s*#' } | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    # Variable references like ${{Postgres.DATABASE_URL}} pass through Railway untouched.
    & railway variables --service $Service --set "$key=$val" --skip-deploys 2>&1 |
      Where-Object { $_ -match 'Error|error' } |
      ForEach-Object { Write-Host "        $_" -ForegroundColor Yellow }
  }
}

Write-Host "==> 5. Push env vars to services" -ForegroundColor Cyan
Set-EnvFile -Service $backend -Path 'scripts/railway/backend.env'
Set-EnvFile -Service $web     -Path 'scripts/railway/web.env'

# ---------------------------------------------------------------------
# 6. Custom domains. Railway is idempotent here — calling domain a
#    second time with the same hostname is a no-op.
# ---------------------------------------------------------------------
Write-Host "==> 6. Attach custom domains" -ForegroundColor Cyan
Try-Cmd domain --service $backend api.towcommand.cloud | Out-Null
Try-Cmd domain --service $web app.towcommand.cloud | Out-Null

# ---------------------------------------------------------------------
# 7. Deploy. --detach so the script doesn't block on log streaming.
# ---------------------------------------------------------------------
Write-Host "==> 7. Deploy backend" -ForegroundColor Cyan
Try-Cmd up --service $backend --detach | Out-Null

Write-Host "==> 8. Deploy web" -ForegroundColor Cyan
Try-Cmd up --service $web --detach | Out-Null

# ---------------------------------------------------------------------
# 9. Capture final status for the report
# ---------------------------------------------------------------------
Write-Host "==> 9. Snapshot deploy status" -ForegroundColor Cyan
$finalStatus = railway service list --json 2>&1 | Out-String
$finalStatus | Out-File scripts/railway/.deploy-status.json -Encoding utf8

Write-Host ""
Write-Host "DONE. Watch builds at https://railway.app/dashboard" -ForegroundColor Green
Write-Host "  Backend health (once green):  https://api.towcommand.cloud/health" -ForegroundColor Green
Write-Host "  Web (once green):             https://app.towcommand.cloud" -ForegroundColor Green
Write-Host ""
Write-Host "Status snapshot saved to scripts/railway/.deploy-status.json" -ForegroundColor DarkGray
