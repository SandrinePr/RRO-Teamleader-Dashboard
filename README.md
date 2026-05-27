# Teamleader Dashboard

React-frontend + .NET API.

### Microsoft 365 (e-mailtelling Sales-activiteit)

De API in **`api\`** ondersteunt **`/ms365/users`**, **`/ms365/emails`**, **`/ms365/emails/daily`** als **`MicrosoftGraph`** is ingevuld (lokaal in `appsettings.Development.json`, gitignored, of environment-variabelen).

- **Flow:** app-only (client credentials). Je Entra-app-registratie moet **application**-machtigingen hebben (minimaal **Mail.Read** + **User.Read.All**), met **beheerderstoestemming**.
- **Zelfde Client ID** als waar het **clientgeheim** voor hoort (niet mixen met een andere app).

**Optioneel:** `.\start-local.ps1` kan nog steeds de API uit `C:\RRO\Projects\Teamleader-Dashboard\api` starten als die map bestaat.

## Starten

**Eén klik (aanrader):** vanuit deze map in PowerShell:

```powershell
.\start-local.ps1
```

Dat opent twee vensters (API op **5055**, daarna Vite). Laat beide open.

**Handmatig — Terminal 1 – API**
```powershell
cd "c:\RRO\Dasboard\TeamleaderDashboard.Api\api"
dotnet run
```
→ API: `http://localhost:5055`

**Terminal 2 – Frontend**
```powershell
cd "c:\RRO\Dasboard\TeamleaderDashboard.Api"
npm run dev
```
→ Dashboard: **`http://localhost:5173/`** (`npm run dev` maakt 5173 eerst vrij via `kill-port`).

### Config

Zorg dat in de hoofdmap een `.env` staat met:

```text
VITE_API_URL=http://localhost:5055
```

**Graph (Development):** in `api/appsettings.Development.json` sectie `MicrosoftGraph`: `TenantId`, `ClientId`, `ClientSecret`. Of env: `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID`, `MICROSOFT_GRAPH_CLIENT_SECRET`.

### Veelvoorkomende issues

- **PowerShell fout op `&&`**: gebruik twee regels (zoals hierboven) of `;` i.p.v. `&&`.
- **Poort 5173**: `npm run dev` = `kill-port 5173` + Vite met `strictPort: true`.
- **API build faalt: file is locked**: er draait nog een oude API. Stop die terminal met `Ctrl+C`, of forceer:

```powershell
Get-Process -Name "TeamleaderDashboard.Api" -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Structuur

- `src/` – React-app (pages, components, shared)
- `api/` – C# API (Teamleader aanroepen)

## Call logging via Zapier

Er zijn extra endpoints toegevoegd om calls automatisch te loggen en KPI's op te halen.

- `POST /integrations/calls/log`  
  Logt inkomende/uitgaande call-events (ook bruikbaar vanuit Zapier Webhooks).
- `GET /calls/metrics`  
  Geeft de belangrijkste call-metrics terug + trend per week/maand + pipeline snapshot.

### Voorbeeld payload (Zapier -> webhook)

```json
{
  "direction": "outgoing",
  "started_at": "2026-03-23T09:30:00Z",
  "ended_at": "2026-03-23T09:36:12Z",
  "duration_sec": 372,
  "seller_id": "u_123",
  "seller_name": "Jan Jansen",
  "recording_url": "https://example.com/recording/abc",
  "source": "zapier",
  "is_mobile": false
}
```

Verplicht: `direction` (`incoming`/`outgoing`) en `started_at`.

### Metrics endpoint gebruiken

Voor maand:

```text
GET /calls/metrics?period=month&value=2026-03&goal_outgoing=120&goal_incoming=60
```

Voor week:

```text
GET /calls/metrics?period=week&value=2026-W13
```

Belangrijke outputvelden:

- `kpis.outgoing_calls`
- `kpis.outgoing_avg_duration_sec`
- `kpis.incoming_calls`
- `kpis.incoming_avg_duration_sec`
- `trends.outgoing_calls_per_week`
- `trends.outgoing_calls_per_month`
- `trends.incoming_calls_per_month`
- `sellers.outgoing_avg_duration_by_seller`
- `goals.*` (status t.o.v. targets)
- `pipeline.*` (open/won/lost + success rate)

### Mobiel

Mobiele call-koppeling is nog **niet actief**. De API geeft dit expliciet terug via:

- `constraints.mobile_supported = false`

en sluit mobiele data standaard uit.
