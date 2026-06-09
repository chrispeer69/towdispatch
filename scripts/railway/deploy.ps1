# =====================================================================
# Tow Dispatch - Railway deploy script (idempotent, Railway CLI v4 syntax).
#
# Prerequisites:
#   1. railway login         (one time, interactive, opens a browser)
#   2. cd C:\dev\towdispatch
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

$projectName = 'towdispatch-prod'
$envName     = 'production'
$backend     = 'backend'
$web         = 'web'

# ---------------------------------------------------------------------
# 1. Link project + environment together. Even when a project link
#    exists, the environment can be unset (the v4 CLI keeps them as
#    separate concerns) which causes `add`/`up` to prompt.
# ---------------------------------------------------------------------
Write-Host "==> 1. Link Railway project + environment" -ForegroundColor Cyan
# Read current link state. The `environment` field in `railway status --json`
# is unreliable in v4.57 - sometimes the project is linked and the active env
# is set but the JSON readback returns an empty string. We trust the project
# name from JSON and trust the exit code of `environment link` for env state.
$stat = Invoke-Railway -Args @('status', '--json') -Quiet
$linkedProject = $null
try {
  $statusObj = $stat.Output | ConvertFrom-Json
  $linkedProject = $statusObj.name
} catch { }

if ($linkedProject -ne $projectName) {
  $res = Invoke-Railway -Args @('link', '--project', $projectName, '--environment', $envName)
  if ($res.Exit -ne 0) {
    throw "Failed to link project ${projectName}: $($res.Output)"
  }
  # Confirm the project link took. Don't check env here - see comment above.
  $stat = Invoke-Railway -Args @('status', '--json') -Quiet
  try { $linkedProject = ($stat.Output | ConvertFrom-Json).name } catch { }
  if ($linkedProject -ne $projectName) {
    throw "Project link verification failed. Got: $linkedProject"
  }
}

# Always (re-)activate the environment. The command is idempotent on the
# server side and a non-zero exit here is the only signal we can trust for
# env state, since `railway status --json` doesn't reliably echo it back.
$envRes = Invoke-Railway -Args @('environment', 'link', $envName)
if ($envRes.Exit -ne 0) {
  $combined = "$($envRes.Output)".ToLower()
  if ($combined -notmatch 'already' -and $combined -notmatch 'activated') {
    throw "Failed to link environment ${envName}: $($envRes.Output)"
  }
  # Non-zero but the CLI said "already" / "activated" -> treat as success.
}
Write-Host "    linked: project=$projectName env=$envName (env-link exit=$($envRes.Exit))" -ForegroundColor DarkGreen

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
# 4. Ensure backend + web services exist (empty). GitHub source linking
#    happens via the dashboard (one-time, ~30s) because Railway CLI's
#    --repo flag returns Unauthorized until the user has connected
#    GitHub in their Railway account settings, and there's no CLI to do
#    that. After dashboard wiring, every push to master rebuilds
#    automatically via the Dockerfiles in apps/{api,web}/Dockerfile.
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
    # Railway rejects KEY= with no value. Skip - owner can paste real values
    # later in the dashboard. This keeps placeholder rows in the env file as
    # documentation without breaking the push.
    if (-not $val) {
      Write-Host "        . $key (skipped - empty value)" -ForegroundColor DarkGray
      return
    }
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

function Invoke-RailwayWithRetry {
  # Wrap Invoke-Railway with retries for transient TLS / connection errors
  # surfaced by `railway up` and occasionally `railway domain`. Errors like
  # "BadRecordMac", "connection forcibly closed", and "Unauthorized" right
  # after a successful whoami are almost always transient.
  param(
    [Parameter(Mandatory)] [string[]] $Args,
    [int] $MaxAttempts = 4,
    [int] $DelaySeconds = 5
  )
  $attempt = 0
  while ($true) {
    $attempt++
    $res = Invoke-Railway -Args $Args
    if ($res.Exit -eq 0) { return $res }
    $out = "$($res.Output)"
    $transient = $out -match 'BadRecordMac' -or `
                 $out -match 'forcibly closed' -or `
                 $out -match 'connection error' -or `
                 $out -match 'timed out' -or `
                 $out -match 'temporar' -or `
                 $out -match 'Unauthorized'
    if (-not $transient -or $attempt -ge $MaxAttempts) {
      Write-Host "    gave up after $attempt attempt(s)" -ForegroundColor Yellow
      return $res
    }
    Write-Host "    transient error, retry $attempt/$MaxAttempts in ${DelaySeconds}s..." -ForegroundColor Yellow
    Start-Sleep -Seconds $DelaySeconds
    $DelaySeconds = [Math]::Min($DelaySeconds * 2, 30)
  }
}

Write-Host "==> 5. Push env vars to services" -ForegroundColor Cyan
Set-EnvFile -Service $backend -Path 'scripts/railway/backend.env'
Set-EnvFile -Service $web     -Path 'scripts/railway/web.env'

# ---------------------------------------------------------------------
# 6. Generate Railway-provided domains (fallback URLs).
#    Custom domains (api/app.towdispatch.cloud) require dashboard setup
#    AND a paid plan, so we generate the .up.railway.app URLs the CLI
#    can issue without those gates - they work the instant GitHub
#    source linking is done in the dashboard.
# ---------------------------------------------------------------------
Write-Host "==> 6. Generate Railway-provided URLs" -ForegroundColor Cyan
Invoke-Railway -Args @('domain', '--service', $backend) | Out-Null
Invoke-Railway -Args @('domain', '--service', $web) | Out-Null

# ---------------------------------------------------------------------
# 7. Snapshot for the deploy report
# ---------------------------------------------------------------------
Write-Host "==> 7. Snapshot deploy status" -ForegroundColor Cyan
$finalStatus = (Invoke-Railway -Args @('service', 'list', '--json') -Quiet).Output
$finalStatus | Out-File scripts/railway/.deploy-status.json -Encoding utf8

Write-Host ""
Write-Host "================ NEXT STEPS (one-time, dashboard) =================" -ForegroundColor Green
Write-Host "1. Open https://railway.com/dashboard -> towdispatch-prod" -ForegroundColor Green
Write-Host "2. For BOTH 'backend' and 'web' services:" -ForegroundColor Green
Write-Host "     Settings -> Source -> Connect Repo" -ForegroundColor Green
Write-Host "     Repo: chrispeer69/towdispatch     Branch: master" -ForegroundColor Green
Write-Host "     (Railway will auto-detect apps/{api,web}/railway.toml)" -ForegroundColor Green
Write-Host "3. For custom domains (paid plan required):" -ForegroundColor Green
Write-Host "     backend -> Settings -> Networking -> Custom Domain ->" -ForegroundColor Green
Write-Host "         api.towdispatch.cloud" -ForegroundColor Green
Write-Host "     web -> Settings -> Networking -> Custom Domain ->" -ForegroundColor Green
Write-Host "         app.towdispatch.cloud" -ForegroundColor Green
Write-Host "===================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Once GitHub is linked the first build runs immediately." -ForegroundColor Green
Write-Host "Status snapshot saved to scripts/railway/.deploy-status.json" -ForegroundColor DarkGray
