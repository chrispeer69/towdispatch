# =====================================================================
# TowCommand — Railway one-shot deploy script.
# Runs ALL the calls in the deploy plan after you've authenticated.
#
# Prerequisites (one-time, interactive — cannot be automated from here):
#   1. winget install Railway.cli   (or: npm i -g @railway/cli)
#   2. railway login                (opens browser)
#   3. cd C:\dev\towcommand
#   4. .\scripts\railway\deploy.ps1
#
# Script is idempotent: re-running it is safe; it will reuse existing
# services and just update env vars + redeploy.
# =====================================================================

$ErrorActionPreference = 'Stop'

function Require-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing required CLI: $name. See header for install instructions."
  }
}

Require-Cmd railway
Require-Cmd git

$repoRoot = (git rev-parse --show-toplevel)
Set-Location $repoRoot

$projectName = 'towcommand-prod'
$envName     = 'production'

Write-Host "==> 1. Create or link Railway project: $projectName" -ForegroundColor Cyan
$projectInit = railway list 2>&1 | Out-String
if ($projectInit -notmatch [regex]::Escape($projectName)) {
  railway init --name $projectName
} else {
  railway link --project $projectName
}

Write-Host "==> 2. Provision Postgres + Redis plugins" -ForegroundColor Cyan
railway add --plugin postgres 2>$null
railway add --plugin redis 2>$null

Write-Host "==> 3. Create + configure backend service" -ForegroundColor Cyan
railway service create backend 2>$null
railway service backend
Get-Content scripts/railway/backend.env | Where-Object { $_ -and $_ -notmatch '^\s*#' } | ForEach-Object {
  $pair = $_ -split '=', 2
  if ($pair.Length -eq 2) {
    railway variables --set "$($pair[0])=$($pair[1])" | Out-Null
  }
}

Write-Host "==> 4. Create + configure web service" -ForegroundColor Cyan
railway service create web 2>$null
railway service web
Get-Content scripts/railway/web.env | Where-Object { $_ -and $_ -notmatch '^\s*#' } | ForEach-Object {
  $pair = $_ -split '=', 2
  if ($pair.Length -eq 2) {
    railway variables --set "$($pair[0])=$($pair[1])" | Out-Null
  }
}

Write-Host "==> 5. Deploy backend" -ForegroundColor Cyan
railway service backend
railway up --detach

Write-Host "==> 6. Deploy web" -ForegroundColor Cyan
railway service web
railway up --detach

Write-Host "==> 7. Attach custom domains" -ForegroundColor Cyan
railway service backend
railway domain api.towcommand.cloud 2>$null
railway service web
railway domain app.towcommand.cloud 2>$null

Write-Host "==> 8. Capture Railway-provided URLs (fallback)" -ForegroundColor Cyan
railway service backend
$backendStatus = railway status --json 2>$null | Out-String
railway service web
$webStatus     = railway status --json 2>$null | Out-String
$backendStatus | Out-File scripts/railway/.deploy-backend-status.json -Encoding utf8
$webStatus     | Out-File scripts/railway/.deploy-web-status.json -Encoding utf8

Write-Host ""
Write-Host "DONE. Check the Railway dashboard for build progress." -ForegroundColor Green
Write-Host "  Backend health:  https://api.towcommand.cloud/health" -ForegroundColor Green
Write-Host "  Web:             https://app.towcommand.cloud" -ForegroundColor Green
Write-Host ""
Write-Host "If custom domains haven't propagated, the Railway URLs in" -ForegroundColor Yellow
Write-Host "  scripts/railway/.deploy-{backend,web}-status.json work immediately." -ForegroundColor Yellow
