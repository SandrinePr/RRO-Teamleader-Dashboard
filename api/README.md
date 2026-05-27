# API

Teamleader-data ophalen: /users, /deals, /contacts, /companies.

**Starten:** `dotnet run` (vanuit map `api`) → http://localhost:5055

**Optioneel:** http://localhost:5055/auth/login voor eenmalig inloggen (token wordt opgeslagen).

**Redirect URI in Teamleader Marketplace** (moet exact kloppen):

`http://localhost:5055/api/teamleader/auth/callback`

Controle in de browser: http://localhost:5055/auth/info
