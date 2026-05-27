# Start script: kiest API (Projects met /ms365 als die map bestaat, anders lokale api/), start dotnet run + npm run dev.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$projectsApi = "C:\RRO\Projects\Teamleader-Dashboard\api"
$useProjectsApi = Test-Path (Join-Path $projectsApi "*.csproj")

if ($useProjectsApi) {
  Write-Host "API: volledige dashboard-API (Teamleader + Microsoft Graph) — $projectsApi" -ForegroundColor Cyan
  $apiDir = $projectsApi
} elseif (Get-ChildItem "$root\api\*.csproj" -ErrorAction SilentlyContinue) {
  Write-Host "WAARSCHUWING: alleen korte API in deze map — geen /ms365. Installeer/sync Projects voor MS365." -ForegroundColor Yellow
  $apiDir = "$root\api"
} else {
  Write-Host "Geen .csproj gevonden. Zet Teamleader-Dashboard op C:\RRO\Projects\ of voeg api\.csproj toe." -ForegroundColor Red
  exit 1
}

Write-Host "Start API op http://localhost:5055 ..." -ForegroundColor Cyan
Start-Process powershell -WorkingDirectory $apiDir -ArgumentList "-NoExit", "-Command", "dotnet run"
Start-Sleep -Seconds 4
Write-Host "Start frontend (npm run dev) in $root ..." -ForegroundColor Cyan
Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", "npm run dev"
Write-Host "Klaar. Open http://localhost:5173 — .env moet VITE_API_URL=http://localhost:5055 hebben." -ForegroundColor Green
