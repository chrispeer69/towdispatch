# =====================================================================
# TowCommand - Railway deploy script (idempotent, Railway CLI v4 syntax).
#
# Prerequisites:
#   1. railway login         (one time, interactive, opens a browser)
#   2. cd C:\dev\towcommand
#   3. .\scripts\railway\deploy.ps1
#
# Re-running is safe: every step skips work that's already done.
#
# Why the cmd /c "... < NUL" wrapper: Railway CLI v4 detects an attached
# TTY in PowerShell and falls back to interactive prompts (e.g. "select
# an environment") even when --json is set, because environment selection
# is a separate concern from output format. Redirecting stdin to NUL
# forces non-interactive mode reliably.
# =====================================================================

$ErrorActionPreference = 'Stop'
$env:CI = 'true'
$env:NO_COLOR = '1'

function Require-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing required CLI: $name."
  }
}

function Invoke-Railway {
  # Run railway with stdin closed (< NUL) so it never blocks on a prompt.
  # Returns the command's stdout/stderr combined as a string, sets $LASTEXITCODE.
  param(
    [Parameter(Mandatory)] [string[]] $Args,
    [switch] $Quiet
  )
  $escaped = $Args | ForEach-Object {
    if ($_ -match '[\s"&|<>]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }
  $argString = $escaped -join ' '
  if (-not $Quiet) {
    Write-Host "    $ railway $argString" -ForegroundColor DarkGray
  }
  $output = & cmd /c "railway $argString < NUL 2>&1"
  $exit = $LASTEXITCODE
  if (-not $Quiet -and $output) {
    foreach ($line in $output) { Write-Host "      $line" }
  }
  return @{ Exit = $exit; Output = ($output -join "`n") }
}

Require-Cmd railway
Require-Cmd git

$repoRoot = (git rev-parse --show-toplevel)
Set-Location $repoRoot

$projectName = 'towcommand-prod'
$envName     = 'production'
$backend     = 'backend'
$web         = 'web'

# ---------------------------------------------------------------------
# 1. Link project + environment together. Even when a project link
#    exists, the environment can be unset (the v4 CLI keeps them as
#    separate concerns) which causes `add`/`up` to prompt.
# ---------------------------------------------------------------------
Write-Host "==> 1. Link Railway project + environment" -ForegroundColor Cyan
$stat = Invoke-Railway -Args @('status', '--json') -Quiet
$linkedProject = $null
$linkedEnvironment = $null
try {
  $statusObj = $stat.Output | ConvertFrom-Json
  $linkedProject = $statusObj.name
  $linkedEnvironment = $statusObj.environment
} catch { }

if ($linkedProject -eq $projectName -and $linkedEnvironment -eq $envName) {
  Write-Host "    already linked: project=$projectName env=$envName" -ForegroundColor DarkGreen
} else {
  if ($linkedProject -ne $projectName) {
    Invoke-Railway -Args @('link', '--project', $projectName, '--environment', $envName) | Out-Null
  } else {
    # Project is linked, env is not. Link env only.
    Invoke-Railway -Args @('environment', 'link', $envName) | Out-Null
  }
  # Re-verify
  $stat = Invoke-Railway -Args @('status', '--json') -Quiet
  try {
    $statusObj = $stat.Output | ConvertFrom-Json
    $linkedProject = $statusObj.name
    $linkedEnvironment = $statusObj.environment
  } catch {
    throw "Failed to read status after link. Output: $($stat.Output)"
  }
  if ($linkedProject -ne $projectName -or $linkedEnvironment -ne $envName) {
    throw "Link verification failed. Got project=$linkedProject env=$linkedEnvironment"
  }
  Write-Host "    linked: project=$linkedProject env=$linkedEnvironment" -ForegroundColor DarkGreen
}

# ---------------------------------------------------------------------
# 2. Inventory services (used to skip-create where already present).
# ---------------------------------------------------------------------
Write-Host "==> 2. Inventory services" -ForegroundColor Cyan
$svcList = Invoke-Railway -Args @('service', 'list', '--json') -Quiet
$existingServices = @()
try {
  $svcArr = $svcList.Output | ConvertFrom-Json
  foreach ($s in $svcArr) { $existingServices += $s.name }
  Write-Host "    existing services: $(($existingServices -join ', '))" -ForegroundColor DarkGreen
} catch {
  Write-Host "    (could not parse service list; will attempt to create all)" -ForegroundColor Yellow
}

# Match Railway's casing: dashboards usually display "Postgres" / "Redis".
$pgExists    = ($existingServices | Where-Object { $_ -match '^(?i)postgres' }).Count -gt 0
$redisExists = ($existingServices | Where-Object { $_ -match '^(?i)redis' }).Count -gt 0

# ---------------------------------------------------------------------
# 3. Postgres + Redis databases
# ---------------------------------------------------------------------
Write-Host "==> 3. Ensure Postgres + Redis are provisioned" -ForegroundColor Cyan
if (-not $pgExists) {
  Invoke-Railway -Args @('add', '--database', 'postgres', '--json') | Out-Null
} else {
  Write-Host "    Postgres already present, skipping" -ForegroundColor DarkGreen
}
if (-not $redisExists) {
  Invoke-Railway -Args @('add', '--database', 'redis', '--json') | Out-Null
} else {
  Write-Host "    Redis already present, skipping" -ForegroundColor DarkGreen
}

# ---------------------------------------------------------------------
# 4. Create backend + web services
# ---------------------------------------------------------------------
Write-Host "==> 4. Ensure backend + web services exist" -ForegroundColor Cyan
if ($existingServices -notcontains $backend) {
  Invoke-Railway -Args @('add', '--service', $backend, '--json') | Out-Null
} else {
  Write-Host "    $backend service already present, skipping" -ForegroundColor DarkGreen
}
if ($existingServices -notcontains $web) {
  Invoke-Railway -Args @('add', '--service', $web, '--json') | Out-Null
} else {
  Write-Host "    $web service already present, skipping" -ForegroundColor DarkGreen
}

# ---------------------------------------------------------------------
# 5. Push env vars. --skip-deploys + explicit --service per call.
# ---------------------------------------------------------------------
function Set-EnvFile {
  param([string]$Service, [string]$Path)
  if (-not (Test-Path $Path)) { throw "Env file not found: $Path" }
  Write-Host "    -> $Service from $Path" -ForegroundColor DarkGray
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1).Trim()
    $res = Invoke-Railway -Args @(
      'variables', '--service', $Service, '--set', "$key=$val", '--skip-deploys'
    ) -Quiet
    if ($res.Exit -ne 0) {
      Write-Host "        WARN: failed to set $key on $Service" -ForegroundColor Yellow
      Write-Host "          $($res.Output)" -ForegroundColor Yellow
    } else {
      Write-Host "        + $key" -ForegroundColor DarkGreen
    }
  }
}

Write-Host "==> 5. Push env vars to services" -ForegroundColor Cyan
Set-EnvFile -Service $backend -Path 'scripts/railway/backend.env'
Set-EnvFile -Service $web     -Path 'scripts/railway/web.env'

# ---------------------------------------------------------------------
# 6. Custom domains. railway domain is idempotent on a hostname.
# ---------------------------------------------------------------------
Write-Host "==> 6. Attach custom domains" -ForegroundColor Cyan
Invoke-Railway -Args @('domain', '--service', $backend, 'api.towcommand.cloud') | Out-Null
Invoke-Railway -Args @('domain', '--service', $web,     'app.towcommand.cloud') | Out-Null

# ---------------------------------------------------------------------
# 7. Deploy
# ---------------------------------------------------------------------
Write-Host "==> 7. Deploy backend" -ForegroundColor Cyan
Invoke-Railway -Args @('up', '--service', $backend, '--detach') | Out-Null

Write-Host "==> 8. Deploy web" -ForegroundColor Cyan
Invoke-Railway -Args @('up', '--service', $web, '--detach') | Out-Null

# ---------------------------------------------------------------------
# 9. Snapshot for the deploy report
# ---------------------------------------------------------------------
Write-Host "==> 9. Snapshot deploy status" -ForegroundColor Cyan
$finalStatus = (Invoke-Railway -Args @('service', 'list', '--json') -Quiet).Output
$finalStatus | Out-File scripts/railway/.deploy-status.json -Encoding utf8

Write-Host ""
Write-Host "DONE. Watch builds at https://railway.app/dashboard" -ForegroundColor Green
Write-Host "  Backend health (once green):  https://api.towcommand.cloud/health" -ForegroundColor Green
Write-Host "  Web (once green):             https://app.towcommand.cloud" -ForegroundColor Green
Write-Host ""
Write-Host "Status snapshot saved to scripts/railway/.deploy-status.json" -ForegroundColor DarkGray
