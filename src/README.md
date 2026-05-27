# Frontend-structuur

Alle broncode staat in **6 bestanden**:

| Bestand        | Doel |
|----------------|------|
| `main.tsx`     | Startpunt: rendert de app |
| `App.tsx`      | Router en layout (navigatie) |
| `styles/main.scss` | Alle styling (Red Rock–thema) |
| `api.ts`       | API-client (`apiGet`) + alle datatypes (DealRow, ContactRow, …) |
| `Dashboard.tsx`| Dashboardpagina: data ophalen en widgets tonen |
| `components.tsx`| Alle UI-componenten (Layout, Widget, KpiCards, SalesSummary, DealStatusPie, …) |

Geen submappen meer: alles overzichtelijk op één niveau.

//LocalSite
cd c:\AA-RedRock\TeamleaderDashboard.Api
npm run dev  

//API
cd c:\AA-RedRock\TeamleaderDashboard.Api\api
dotnet run 