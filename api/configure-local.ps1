# Eenmalige lokale setup: vraagt Teamleader Client Secret (optioneel Client Id) → dotnet user-secrets (niet in git).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-ChildItem "*.csproj" -ErrorAction SilentlyContinue)) {
  Write-Host "Start dit script vanuit de map api (waar de .csproj staat)." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "=== Teamleader lokaal ===" -ForegroundColor Cyan
Write-Host "Je Client Secret komt in dotnet user-secrets (niet in git)."
Write-Host ""

$sec = Read-Host "Plak je Teamleader Client Secret"
if ([string]::IsNullOrWhiteSpace($sec)) {
  Write-Host "Geen secret: gestopt. Zonder secret blijft 'Teamleader niet geconfigureerd'." -ForegroundColor Red
  exit 1
}
dotnet user-secrets set "Teamleader:ClientSecret" $sec.Trim()

$id = Read-Host "Client ID (Enter = overslaan; dan gebruikt de API appsettings.json)"
if (-not [string]::IsNullOrWhiteSpace($id)) {
  dotnet user-secrets set "Teamleader:ClientId" $id.Trim()
}

Write-Host ""
Write-Host "Klaar. Start nu:  dotnet run" -ForegroundColor Green
Write-Host "Test: http://localhost:5055/health/deployment — teamleader_client_secret_set moet true zijn."
Write-Host ""
