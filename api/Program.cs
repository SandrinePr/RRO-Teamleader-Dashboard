// Teamleader-dashboard backend (ASP.NET minimal API): OAuth, Teamleader-proxy (deals/contacts/…),
// verrijkte deals+bedrijven met cache, call-webhook + metrics uit calls-log.json, tokenopslag in tokens.json.
// Optioneel: Microsoft Graph (client credentials) voor /ms365/users en verzonden mail per gebruiker/maand.
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Globalization;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.Extensions.FileProviders;

// Lokale API-poort (gelijk houden met launchSettings + .env VITE_API_URL + Teamleader redirect-URI).
const int LocalDevApiPort = 5055;
const string TeamleaderOAuthBase = "https://focus.teamleader.eu";

var railwayPort = Environment.GetEnvironmentVariable("PORT");
if (string.IsNullOrWhiteSpace(railwayPort))
  Environment.SetEnvironmentVariable("ASPNETCORE_URLS", $"http://localhost:{LocalDevApiPort}");
else
  Environment.SetEnvironmentVariable("ASPNETCORE_URLS", $"http://0.0.0.0:{railwayPort}");

static string FirstNonEmptyEarly(params string?[] values)
{
  foreach (var v in values)
    if (!string.IsNullOrWhiteSpace(v)) return v!.Trim();
  return "";
}

var apiPublicUrl = FirstNonEmptyEarly(
  Environment.GetEnvironmentVariable("API_PUBLIC_URL"),
  $"http://localhost:{LocalDevApiPort}").TrimEnd('/');
// Moet exact overeenkomen met Redirect URI in Teamleader Marketplace (zelfde als Teamleader-Dashboard).
var redirectUri = FirstNonEmptyEarly(
  Environment.GetEnvironmentVariable("TEAMLEADER_REDIRECT_URI"),
  $"{apiPublicUrl}/api/teamleader/auth/callback");
var frontendUri = FirstNonEmptyEarly(
  Environment.GetEnvironmentVariable("FRONTEND_ORIGIN"),
  apiPublicUrl);

string? _accessToken = null;
string? _refreshToken = null;
var _lock = new object();
var tokensFile = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "tokens.json"));
var callLogsFile = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "calls-log.json"));
var callLogsLock = new object();
var newCustomersPipelineId = Environment.GetEnvironmentVariable("TEAMLEADER_NEW_CUSTOMERS_PIPELINE_ID") ?? "f2d4af30-1e5d-054b-a54c-1b91b0b57200";
var enrichDealsInMonthRaw = (Environment.GetEnvironmentVariable("TEAMLEADER_ENRICH_DEALS_IN_MONTH") ?? "true").Trim();
var enrichDealsInMonth = !string.Equals(enrichDealsInMonthRaw, "false", StringComparison.OrdinalIgnoreCase);
var dealInfoDelayMs = int.TryParse(Environment.GetEnvironmentVariable("TEAMLEADER_DEAL_INFO_DELAY_MS"), out var _delayParsed)
  ? Math.Max(0, _delayParsed)
  : 75;
var customerKindFieldKey = Environment.GetEnvironmentVariable("TEAMLEADER_CUSTOMER_KIND_FIELD_KEY") ?? "";
var oldCustomerValuesRaw = Environment.GetEnvironmentVariable("TEAMLEADER_OLD_CUSTOMER_VALUES") ?? "oud,old,bestaande klant,existing customer,bestaand";
var oldCustomerValues = oldCustomerValuesRaw
  .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
  .Select(x => x.Trim().ToLowerInvariant())
  .Where(x => !string.IsNullOrWhiteSpace(x))
  .ToHashSet(StringComparer.OrdinalIgnoreCase);
var dealsWithCompaniesCacheLock = new object();
JsonObject? dealsWithCompaniesCachePayload = null;
DateTimeOffset dealsWithCompaniesCacheExpiresUtc = DateTimeOffset.MinValue;
DateTimeOffset dealsWithCompaniesCacheStaleUntilUtc = DateTimeOffset.MinValue;
var dealsWithCompaniesMonthCache = new Dictionary<string, (JsonObject payload, DateTimeOffset expiresUtc)>(StringComparer.OrdinalIgnoreCase);
var dealInfoCacheLock = new object();
var dealInfoCache = new Dictionary<string, (JsonObject data, DateTimeOffset expiresUtc)>(StringComparer.OrdinalIgnoreCase);
var dealInfoConcurrency = int.TryParse(Environment.GetEnvironmentVariable("TEAMLEADER_DEAL_INFO_CONCURRENCY"), out var _concParsed)
  ? Math.Clamp(_concParsed, 1, 16)
  : 6;
var dealInfoThrottle = new SemaphoreSlim(dealInfoConcurrency, dealInfoConcurrency);

JsonObject NewCustomersPipelineFilter() => new()
{
  ["pipeline_ids"] = new JsonArray { newCustomersPipelineId },
};

void LoadTokens()
{
  var envAccess = Environment.GetEnvironmentVariable("TEAMLEADER_ACCESS_TOKEN");
  var envRefresh = Environment.GetEnvironmentVariable("TEAMLEADER_REFRESH_TOKEN");
  if (!string.IsNullOrWhiteSpace(envAccess))
  {
    _accessToken = envAccess.Trim();
    _refreshToken = string.IsNullOrWhiteSpace(envRefresh) ? null : envRefresh.Trim();
    return;
  }
  if (!File.Exists(tokensFile)) return;
  try
  {
    var o = System.Text.Json.JsonSerializer.Deserialize<TokenFile>(File.ReadAllText(tokensFile));
    if (o != null) { _accessToken = o.AccessToken; _refreshToken = o.RefreshToken; }
  }
  catch { }
}

void SaveTokens(string access, string? refresh)
{
  _accessToken = access;
  if (refresh != null) _refreshToken = refresh;
  try
  {
    var dir = Path.GetDirectoryName(tokensFile);
    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
    File.WriteAllText(tokensFile, System.Text.Json.JsonSerializer.Serialize(new TokenFile { AccessToken = access, RefreshToken = _refreshToken }));
  }
  catch { }
}

LoadTokens();

var builder = WebApplication.CreateBuilder(args);

static string FirstNonEmpty(params string?[] values)
{
  foreach (var v in values)
    if (!string.IsNullOrWhiteSpace(v)) return v!.Trim();
  return "";
}

var clientId = FirstNonEmpty(
  builder.Configuration["Teamleader:ClientId"],
  Environment.GetEnvironmentVariable("TEAMLEADER_CLIENT_ID"));
var clientSecret = FirstNonEmpty(
  builder.Configuration["Teamleader:ClientSecret"],
  Environment.GetEnvironmentVariable("TEAMLEADER_CLIENT_SECRET"));

var graphTenantId = FirstNonEmpty(
  builder.Configuration["MicrosoftGraph:TenantId"],
  Environment.GetEnvironmentVariable("MICROSOFT_GRAPH_TENANT_ID"));
var graphClientId = FirstNonEmpty(
  builder.Configuration["MicrosoftGraph:ClientId"],
  Environment.GetEnvironmentVariable("MICROSOFT_GRAPH_CLIENT_ID"));
var graphClientSecret = FirstNonEmpty(
  builder.Configuration["MicrosoftGraph:ClientSecret"],
  Environment.GetEnvironmentVariable("MICROSOFT_GRAPH_CLIENT_SECRET"));
var graphIsConfigured =
  !string.IsNullOrEmpty(graphTenantId) && !string.IsNullOrEmpty(graphClientId) && !string.IsNullOrEmpty(graphClientSecret);

string? graphAppToken = null;
var graphAppTokenExpiresUtc = DateTimeOffset.MinValue;
var graphTokenLock = new object();

if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PORT")))
  builder.WebHost.UseUrls($"http://localhost:{LocalDevApiPort}");
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
  p.SetIsOriginAllowed(origin =>
  {
    if (string.IsNullOrEmpty(origin)) return false;
    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
    if (uri.Scheme == "http" && uri.Host == "localhost" && uri.Port == 5173)
      return true;
    return false;
  })
  .AllowAnyHeader()
  .AllowAnyMethod()));
builder.Services.Configure<JsonOptions>(x => x.SerializerOptions.PropertyNamingPolicy = null);
builder.Services.AddHttpClient();

var app = builder.Build();
app.UseCors();
var frontendRootCandidates = new[]
{
  app.Environment.WebRootPath,
  Path.Combine(app.Environment.ContentRootPath, "wwwroot"),
  Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "wwwroot")),
  Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "wwwroot")),
  Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "wwwroot")),
  Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "dist")),
  Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "dist")),
  Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "dist")),
};
var frontendRootPath = frontendRootCandidates.FirstOrDefault(path =>
  !string.IsNullOrWhiteSpace(path) &&
  Directory.Exists(path) &&
  File.Exists(Path.Combine(path, "index.html")));

if (!string.IsNullOrWhiteSpace(frontendRootPath))
{
  var frontendFiles = new PhysicalFileProvider(frontendRootPath);
  app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = frontendFiles });
  app.UseStaticFiles(new StaticFileOptions { FileProvider = frontendFiles });
}
else
{
  Console.WriteLine("[startup] No frontend root with index.html found; /api and /healthz remain available.");
}

app.MapGet("/healthz", () => Results.Ok(new { ok = true }));
app.MapGet("/api", () => "Teamleader API. Endpoints: /users, /deals, /deals-with-companies, /contacts, /companies, /tasks, /calls. OAuth: /auth/login. MS Graph (optioneel): /ms365/users, /ms365/emails, /ms365/emails/daily");

string TeamleaderAuthorizeUrl() =>
  $"{TeamleaderOAuthBase}/oauth2/authorize?client_id={Uri.EscapeDataString(clientId)}&response_type=code&redirect_uri={Uri.EscapeDataString(redirectUri)}";

async Task<IResult> TeamleaderAuthCallbackAsync(string? code, IHttpClientFactory f)
{
  if (string.IsNullOrEmpty(code)) return Results.Redirect($"{frontendUri}?auth=error");
  var c = f.CreateClient();
  var body = new FormUrlEncodedContent(new Dictionary<string, string>
  {
    ["client_id"] = clientId, ["client_secret"] = clientSecret, ["code"] = code,
    ["grant_type"] = "authorization_code", ["redirect_uri"] = redirectUri,
  });
  var res = await c.PostAsync($"{TeamleaderOAuthBase}/oauth2/access_token", body);
  if (!res.IsSuccessStatusCode) return Results.Redirect($"{frontendUri}?auth=failed");
  var json = await res.Content.ReadFromJsonAsync<TokenResponse>();
  if (string.IsNullOrEmpty(json?.AccessToken)) return Results.Redirect($"{frontendUri}?auth=no_token");
  SaveTokens(json.AccessToken, json.RefreshToken ?? "");
  return Results.Redirect($"{frontendUri}?auth=ok");
}

app.MapGet("/auth/info", () => Results.Json(new
{
  redirect_uri = redirectUri,
  authorize_url = TeamleaderAuthorizeUrl(),
  login_url = $"{apiPublicUrl}/auth/login",
  marketplace = "https://marketplace.focus.teamleader.eu/",
  hint = "Zet redirect_uri exact zo in je Teamleader-integratie (Marketplace → Build).",
}));

app.MapGet("/auth/login", () => Results.Redirect(TeamleaderAuthorizeUrl()));
app.MapGet("/api/teamleader/auth/login", () => Results.Redirect(TeamleaderAuthorizeUrl()));

app.MapGet("/auth/callback", TeamleaderAuthCallbackAsync);
app.MapGet("/api/teamleader/auth/callback", TeamleaderAuthCallbackAsync);

app.MapGet("/users", (IHttpClientFactory f) => Fetch(f, "https://api.teamleader.eu/users.list"));
app.MapGet("/deals", async (IHttpClientFactory f) =>
{
  var (body, err) = await FetchRaw(f, "https://api.teamleader.eu/deals.list");
  if (err != null || string.IsNullOrWhiteSpace(body))
    return Results.Json(new { data = Array.Empty<object>(), _error = err ?? "Kon deals niet ophalen." }, statusCode: 502);
  try
  {
    var root = JsonNode.Parse(body) as JsonObject;
    var arr = root?["data"]?.AsArray() ?? new JsonArray();
    var filtered = new JsonArray();
    foreach (var d in arr)
    {
      if (d is not JsonObject obj) continue;
      var pipelineObj = (obj["pipeline"] ?? obj["Pipeline"]) as JsonObject;
      var pipelineId = pipelineObj?["id"]?.GetValue<string>() ?? "";
      if (string.Equals(pipelineId, newCustomersPipelineId, StringComparison.OrdinalIgnoreCase))
      {
        filtered.Add(obj);
      }
    }
    return Results.Json(new { data = filtered });
  }
  catch (Exception ex)
  {
    return Results.Json(new { data = Array.Empty<object>(), _error = ex.Message }, statusCode: 502);
  }
});
app.MapGet("/contacts", (IHttpClientFactory f) => Fetch(f, "https://api.teamleader.eu/contacts.list"));
app.MapGet("/companies", (IHttpClientFactory f) => Fetch(f, "https://api.teamleader.eu/companies.list"));
app.MapGet("/tasks", (IHttpClientFactory f) => Fetch(f, "https://api.teamleader.eu/tasks.list"));
app.MapGet("/calls", (IHttpClientFactory f) => Fetch(f, "https://api.teamleader.eu/calls.list"));

app.MapPost("/integrations/calls/log", async (HttpContext http) =>
{
  JsonNode? body;
  try
  {
    body = await JsonNode.ParseAsync(http.Request.Body);
  }
  catch
  {
    return Results.BadRequest(new { ok = false, error = "Ongeldige JSON-body." });
  }

  if (body is not JsonObject payload)
    return Results.BadRequest(new { ok = false, error = "Body moet een JSON-object zijn." });

  var parsed = ParseCallEvent(payload);
  if (parsed is null)
    return Results.BadRequest(new { ok = false, error = "Verplicht: direction (incoming/outgoing) en started_at." });

  SaveCallEvent(parsed, callLogsFile, callLogsLock);
  return Results.Ok(new { ok = true, id = parsed.Id, mobile_supported = false, note = "Mobiele koppeling is nog niet actief." });
});

app.MapGet("/calls/metrics", async (HttpContext http, IHttpClientFactory f) =>
{
  var q = http.Request.Query;
  var period = (q["period"].ToString() ?? "month").Trim().ToLowerInvariant(); // week|month
  var periodValue = (q["value"].ToString() ?? "").Trim(); // YYYY-MM of YYYY-Www
  var includeMobile = string.Equals(q["include_mobile"], "true", StringComparison.OrdinalIgnoreCase);
  var goalOutgoing = TryToInt(q["goal_outgoing"]);
  var goalIncoming = TryToInt(q["goal_incoming"]);

  var logs = LoadCallEvents(callLogsFile, callLogsLock);
  var filtered = logs.Where(x => includeMobile || !x.IsMobile).ToList();

  var now = DateTimeOffset.UtcNow;
  if (string.IsNullOrEmpty(periodValue))
  {
    if (period == "week")
    {
      var iw = ISOWeek.GetWeekOfYear(now.UtcDateTime);
      periodValue = $"{now.Year}-W{iw:00}";
    }
    else
    {
      periodValue = $"{now.Year}-{now.Month:00}";
      period = "month";
    }
  }

  var inPeriod = filtered.Where(x => IsInPeriod(x.StartedAtUtc, period, periodValue)).ToList();

  var outgoing = inPeriod.Where(x => x.Direction == "outgoing").ToList();
  var incoming = inPeriod.Where(x => x.Direction == "incoming").ToList();

  var outgoingPerWeek = filtered
    .Where(x => x.Direction == "outgoing")
    .GroupBy(x =>
    {
      var dt = x.StartedAtUtc.UtcDateTime;
      var y = dt.Year;
      var w = ISOWeek.GetWeekOfYear(dt);
      return $"{y}-W{w:00}";
    })
    .OrderBy(g => g.Key)
    .Select(g => new { period = g.Key, count = g.Count() })
    .ToArray();

  var outgoingPerMonth = filtered
    .Where(x => x.Direction == "outgoing")
    .GroupBy(x => $"{x.StartedAtUtc.Year}-{x.StartedAtUtc.Month:00}")
    .OrderBy(g => g.Key)
    .Select(g => new { period = g.Key, count = g.Count() })
    .ToArray();

  var incomingPerMonth = filtered
    .Where(x => x.Direction == "incoming")
    .GroupBy(x => $"{x.StartedAtUtc.Year}-{x.StartedAtUtc.Month:00}")
    .OrderBy(g => g.Key)
    .Select(g => new { period = g.Key, count = g.Count() })
    .ToArray();

  var outgoingAvgBySeller = inPeriod
    .Where(x => x.Direction == "outgoing")
    .GroupBy(x => x.SellerName ?? x.SellerId ?? "Onbekend")
    .OrderBy(g => g.Key)
    .Select(g => new
    {
      seller = g.Key,
      calls = g.Count(),
      avg_duration_sec = SafeAvg(g.Select(z => z.DurationSeconds)),
    })
    .ToArray();

  // Pipeline-resultaten t.o.v. goals (uit Teamleader deals)
  var pipeline = await GetPipelineSnapshot(f);

  var payloadOut = new
  {
    period = new { type = period, value = periodValue },
    constraints = new
    {
      mobile_supported = false,
      include_mobile = includeMobile,
      note = includeMobile ? "include_mobile=true gevraagd, maar er is nog geen mobiele koppeling." : "Mobiele call-koppeling ontbreekt; cijfers zijn enkel niet-mobiel.",
    },
    kpis = new
    {
      outgoing_calls = outgoing.Count,
      outgoing_avg_duration_sec = SafeAvg(outgoing.Select(x => x.DurationSeconds)),
      incoming_calls = incoming.Count,
      incoming_avg_duration_sec = SafeAvg(incoming.Select(x => x.DurationSeconds)),
    },
    trends = new
    {
      outgoing_calls_per_week = outgoingPerWeek,
      outgoing_calls_per_month = outgoingPerMonth,
      incoming_calls_per_month = incomingPerMonth,
    },
    sellers = new
    {
      outgoing_avg_duration_by_seller = outgoingAvgBySeller,
    },
    goals = new
    {
      outgoing_target = goalOutgoing,
      outgoing_status = GoalStatus(outgoing.Count, goalOutgoing),
      incoming_target = goalIncoming,
      incoming_status = GoalStatus(incoming.Count, goalIncoming),
    },
    pipeline = pipeline,
  };

  return Results.Ok(payloadOut);
});

app.MapGet("/deals-with-companies", async (HttpContext http, IHttpClientFactory f) =>
{
  var monthQuery = (http.Request.Query["month"].ToString() ?? "").Trim();
  var hasMonthFilter = monthQuery.Length == 7 && monthQuery[4] == '-';
  DateTimeOffset monthStartUtc = default;
  DateTimeOffset monthEndUtc = default;
  if (hasMonthFilter)
  {
    if (!int.TryParse(monthQuery.AsSpan(0, 4), out var y) || !int.TryParse(monthQuery.AsSpan(5, 2), out var mon) || mon is < 1 or > 12)
      hasMonthFilter = false;
    else
    {
      monthStartUtc = new DateTimeOffset(y, mon, 1, 0, 0, 0, TimeSpan.Zero);
      monthEndUtc = monthStartUtc.AddMonths(1).AddTicks(-1);
    }
  }

  // Cache-key versie: cohort-logica wijzigde (phase_history + UTC); oude lege maand-cache vermijden.
  const string monthCacheVersion = "v2-phase";
  var monthCacheKey = hasMonthFilter ? $"{monthQuery}|{monthCacheVersion}" : "";

  // Deze endpoint doet meerdere paginatie calls. Teamleader rate-limits kunnen dan leiden tot 429/502.
  // Daarom cachen we het resultaat kort, zodat refreshen niet meteen fout gaat.
  if (!hasMonthFilter)
  {
    lock (dealsWithCompaniesCacheLock)
    {
      if (dealsWithCompaniesCachePayload != null && DateTimeOffset.UtcNow <= dealsWithCompaniesCacheExpiresUtc)
        return Results.Json(dealsWithCompaniesCachePayload);
    }
  }
  else
  {
    lock (dealsWithCompaniesCacheLock)
    {
      if (dealsWithCompaniesMonthCache.TryGetValue(monthCacheKey, out var monthCached) &&
          DateTimeOffset.UtcNow <= monthCached.expiresUtc)
      {
        return Results.Json(monthCached.payload);
      }
    }
  }

  var (dealsArray, included, err) = await FetchAllListData(
    f, "deals.list", include: "lead.customer", filter: NewCustomersPipelineFilter());
  if (err != null)
  {
    lock (dealsWithCompaniesCacheLock)
    {
      if (dealsWithCompaniesCachePayload != null && DateTimeOffset.UtcNow <= dealsWithCompaniesCacheStaleUntilUtc)
        return Results.Json(dealsWithCompaniesCachePayload);
    }
    return Results.Json(new { data = Array.Empty<object>(), _error = err }, statusCode: 502);
  }

  // Alleen deals uit pipeline "Sales - Nieuwe klanten".
  // Standaard-id kan via env var overschreven worden:
  // TEAMLEADER_NEW_CUSTOMERS_PIPELINE_ID=<pipeline-id>
  for (int i = dealsArray.Count - 1; i >= 0; i--)
  {
    if (dealsArray[i] is not JsonObject dealObj)
    {
      dealsArray.RemoveAt(i);
      continue;
    }
    var pipelineObj = (dealObj["pipeline"] ?? dealObj["Pipeline"]) as JsonObject;
    var pipelineId = pipelineObj?["id"]?.GetValue<string>() ?? "";
    if (!string.Equals(pipelineId, newCustomersPipelineId, StringComparison.OrdinalIgnoreCase))
    {
      dealsArray.RemoveAt(i);
    }
  }

  DateTimeOffset? ParseInstantFromNode(JsonObject dealObj, string key)
  {
    var raw = dealObj[key]?.GetValue<string>();
    if (string.IsNullOrWhiteSpace(raw)) return null;
    if (DateTimeOffset.TryParse(raw, out var dto)) return dto.ToUniversalTime();
    if (!DateTime.TryParse(raw, out var dt)) return null;
    return new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc));
  }

  bool AnyDealInstantInUtcRange(JsonObject dealObj, DateTimeOffset rangeStartUtc, DateTimeOffset rangeEndUtc)
  {
    foreach (var key in new[] { "updated_at", "closed_at", "created_at" })
    {
      var t = ParseInstantFromNode(dealObj, key);
      if (t is null) continue;
      if (t.Value >= rangeStartUtc && t.Value <= rangeEndUtc) return true;
    }
    return false;
  }

  bool PhaseHistoryStartedInUtcRange(JsonObject dealObj, DateTimeOffset rangeStartUtc, DateTimeOffset rangeEndUtc)
  {
    if (dealObj["phase_history"] is not JsonArray hist) return false;
    foreach (var node in hist)
    {
      if (node is not JsonObject entry) continue;
      var startedRaw =
        entry["started_at"]?.GetValue<string>() ??
        entry["entered_at"]?.GetValue<string>();
      if (string.IsNullOrWhiteSpace(startedRaw)) continue;
      if (!DateTimeOffset.TryParse(startedRaw, out var started)) continue;
      started = started.ToUniversalTime();
      if (started >= rangeStartUtc && started <= rangeEndUtc) return true;
    }
    return false;
  }

  var enableDealInfoEnrichmentForMonth = enrichDealsInMonth;

  // Maandfilter: zonder enrichment alleen created/updated/closed in de maand (UTC).
  // Met enrichment: eerst ruimere set (maand + vorige maand op dealdatums), daarna strikt op datums of phase_history in de maand.
  if (hasMonthFilter)
  {
    var preStart = enableDealInfoEnrichmentForMonth ? monthStartUtc.AddMonths(-1) : monthStartUtc;
    var preEnd = monthEndUtc;
    for (int i = dealsArray.Count - 1; i >= 0; i--)
    {
      if (dealsArray[i] is not JsonObject dealObj)
      {
        dealsArray.RemoveAt(i);
        continue;
      }

      if (!AnyDealInstantInUtcRange(dealObj, preStart, preEnd)) dealsArray.RemoveAt(i);
    }
  }

  if (hasMonthFilter && enableDealInfoEnrichmentForMonth)
  {
    async Task EnrichOneDealAsync(JsonObject dealObj, string id)
    {
      await dealInfoThrottle.WaitAsync();
      try
      {
        var info = await FetchDealInfoWithRetry(f, id);
        if (info != null)
        {
          if (info["phase_history"] != null) dealObj["phase_history"] = info["phase_history"]!.DeepClone();
          if (dealObj["closed_at"] == null && info["closed_at"] != null) dealObj["closed_at"] = info["closed_at"]!.DeepClone();
          if (dealObj["custom_fields"] == null && info["custom_fields"] != null) dealObj["custom_fields"] = info["custom_fields"]!.DeepClone();
          if (dealObj["customFieldValues"] == null && info["customFieldValues"] != null) dealObj["customFieldValues"] = info["customFieldValues"]!.DeepClone();
          if (dealObj["custom_field_values"] == null && info["custom_field_values"] != null) dealObj["custom_field_values"] = info["custom_field_values"]!.DeepClone();
        }
        if (dealInfoDelayMs > 0) await Task.Delay(dealInfoDelayMs);
      }
      finally
      {
        dealInfoThrottle.Release();
      }
    }

    var enrichTasks = new List<Task>();
    foreach (var deal in dealsArray)
    {
      if (deal is not JsonObject dealObj) continue;
      if (dealObj["phase_history"] is JsonArray) continue;
      var id = dealObj["id"]?.GetValue<string>();
      if (string.IsNullOrWhiteSpace(id)) continue;
      enrichTasks.Add(EnrichOneDealAsync(dealObj, id!));
    }
    await Task.WhenAll(enrichTasks);

    // Geen cohort-filter op eerste discovery; maandset blijft gebaseerd op activiteit.

    // Unieke deals in de maandset: 1 deal_id slechts 1x.
    var seenDealIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    for (int i = dealsArray.Count - 1; i >= 0; i--)
    {
      if (dealsArray[i] is not JsonObject dealObj)
      {
        dealsArray.RemoveAt(i);
        continue;
      }

      var dealId = dealObj["id"]?.GetValue<string>() ?? "";
      if (string.IsNullOrWhiteSpace(dealId) || !seenDealIds.Add(dealId))
      {
        dealsArray.RemoveAt(i);
      }
    }

    // Strikte cohort: dealdatum in targetmaand (UTC) óf een fase-ingang (phase_history.started_at) in die maand.
    for (int i = dealsArray.Count - 1; i >= 0; i--)
    {
      if (dealsArray[i] is not JsonObject dealObj)
      {
        dealsArray.RemoveAt(i);
        continue;
      }

      var inCohort =
        AnyDealInstantInUtcRange(dealObj, monthStartUtc, monthEndUtc) ||
        PhaseHistoryStartedInUtcRange(dealObj, monthStartUtc, monthEndUtc);
      if (!inCohort) dealsArray.RemoveAt(i);
    }
  }
  else if (hasMonthFilter)
  {
    Console.WriteLine("[deals-with-companies] month enrichment skipped (TEAMLEADER_ENRICH_DEALS_IN_MONTH != true)");
  }

  string NormalizeCustomerKindValue(JsonNode? v)
  {
    if (v == null) return "";
    if (v is JsonValue jv)
    {
      if (jv.TryGetValue<bool>(out var b)) return b ? "true" : "false";
      if (jv.TryGetValue<string>(out var s)) return (s ?? "").Trim().ToLowerInvariant();
      return jv.ToJsonString().Trim().Trim('"').ToLowerInvariant();
    }
    if (v is JsonObject jo)
    {
      var name = jo["name"]?.GetValue<string>() ?? jo["label"]?.GetValue<string>() ?? jo["value"]?.GetValue<string>() ?? "";
      return name.Trim().ToLowerInvariant();
    }
    return v.ToJsonString().Trim().Trim('"').ToLowerInvariant();
  }

  bool CustomFieldMatchesKey(JsonObject field, string key)
  {
    if (string.IsNullOrWhiteSpace(key)) return true;
    var keyLc = key.Trim().ToLowerInvariant();
    var id = (field["id"]?.GetValue<string>() ?? "").Trim().ToLowerInvariant();
    var name = (field["name"]?.GetValue<string>() ?? "").Trim().ToLowerInvariant();
    var definition = field["definition"] as JsonObject;
    var defId = (definition?["id"]?.GetValue<string>() ?? "").Trim().ToLowerInvariant();
    var defName = (definition?["name"]?.GetValue<string>() ?? "").Trim().ToLowerInvariant();
    return id == keyLc || name == keyLc || defId == keyLc || defName == keyLc;
  }

  bool TryGetCustomerKindFromCustomFields(JsonObject dealObj, out string kindValue, out string sourceKey)
  {
    kindValue = "";
    sourceKey = "";
    JsonArray? arr = null;
    if (dealObj["custom_fields"] is JsonArray cf) arr = cf;
    else if (dealObj["customFieldValues"] is JsonArray cfv) arr = cfv;
    else if (dealObj["custom_field_values"] is JsonArray cfu) arr = cfu;
    if (arr == null) return false;

    foreach (var node in arr)
    {
      if (node is not JsonObject obj) continue;
      if (!CustomFieldMatchesKey(obj, customerKindFieldKey)) continue;
      var valueNode = obj["value"] ?? obj["selected"] ?? obj["option"] ?? obj["data"];
      var value = NormalizeCustomerKindValue(valueNode);
      if (string.IsNullOrWhiteSpace(value)) continue;
      kindValue = value;
      sourceKey =
        (obj["name"]?.GetValue<string>() ?? "") switch
        {
          var n when !string.IsNullOrWhiteSpace(n) => n,
          _ => (obj["id"]?.GetValue<string>() ?? "") switch
          {
            var i when !string.IsNullOrWhiteSpace(i) => i,
            _ => "custom_field"
          }
        };
      return true;
    }
    return false;
  }

  bool IsOldCustomerDeal(JsonObject dealObj, out string reason)
  {
    reason = "";
    var directMarkers = new[]
    {
      "is_new_customer", "isNewCustomer", "new_customer", "newCustomer",
      "is_existing_customer", "isExistingCustomer", "existing_customer", "existingCustomer",
      "customer_type", "customerType", "klant_type", "type_klant"
    };
    foreach (var key in directMarkers)
    {
      var raw = dealObj[key];
      if (raw == null) continue;
      var val = NormalizeCustomerKindValue(raw);
      if (string.IsNullOrWhiteSpace(val)) continue;
      if (key.Contains("is_new", StringComparison.OrdinalIgnoreCase) || key.Contains("new_customer", StringComparison.OrdinalIgnoreCase))
      {
        if (val == "false" || oldCustomerValues.Contains(val))
        {
          reason = $"{key}={val}";
          return true;
        }
      }
      else if (key.Contains("existing", StringComparison.OrdinalIgnoreCase))
      {
        if (val == "true" || oldCustomerValues.Contains(val))
        {
          reason = $"{key}={val}";
          return true;
        }
      }
      else if (oldCustomerValues.Contains(val))
      {
        reason = $"{key}={val}";
        return true;
      }
    }

    if (TryGetCustomerKindFromCustomFields(dealObj, out var customKind, out var source))
    {
      if (oldCustomerValues.Contains(customKind))
      {
        reason = $"{source}={customKind}";
        return true;
      }
      if (source.Contains("new", StringComparison.OrdinalIgnoreCase) && customKind == "false")
      {
        reason = $"{source}=false";
        return true;
      }
      if (source.Contains("existing", StringComparison.OrdinalIgnoreCase) && customKind == "true")
      {
        reason = $"{source}=true";
        return true;
      }
    }
    return false;
  }

  var beforeOldCustomerFilter = dealsArray.Count;
  var removedOldCustomers = 0;
  var loggedCustomFieldHints = 0;
  for (int i = dealsArray.Count - 1; i >= 0; i--)
  {
    if (dealsArray[i] is not JsonObject dealObj)
    {
      dealsArray.RemoveAt(i);
      continue;
    }
    if (string.IsNullOrWhiteSpace(customerKindFieldKey) && loggedCustomFieldHints < 25)
    {
      JsonArray? arr = null;
      if (dealObj["custom_fields"] is JsonArray cf) arr = cf;
      else if (dealObj["customFieldValues"] is JsonArray cfv) arr = cfv;
      else if (dealObj["custom_field_values"] is JsonArray cfu) arr = cfu;
      if (arr != null)
      {
        foreach (var node in arr)
        {
          if (node is not JsonObject obj) continue;
          var fieldName =
            obj["name"]?.GetValue<string>() ??
            (obj["definition"] as JsonObject)?["name"]?.GetValue<string>() ??
            "";
          var fieldId =
            obj["id"]?.GetValue<string>() ??
            (obj["definition"] as JsonObject)?["id"]?.GetValue<string>() ??
            "";
          var valNode = obj["value"] ?? obj["selected"] ?? obj["option"] ?? obj["data"];
          var valNorm = NormalizeCustomerKindValue(valNode);
          if (string.IsNullOrWhiteSpace(fieldName) && string.IsNullOrWhiteSpace(fieldId)) continue;
          Console.WriteLine($"[deals-with-companies] custom-field hint: name={fieldName} id={fieldId} value={valNorm}");
          loggedCustomFieldHints++;
          if (loggedCustomFieldHints >= 25) break;
        }
      }
    }

    if (!IsOldCustomerDeal(dealObj, out var reason)) continue;
    removedOldCustomers++;
    if (removedOldCustomers <= 20)
    {
      var id = dealObj["id"]?.GetValue<string>() ?? "";
      var title = dealObj["title"]?.GetValue<string>() ?? "";
      Console.WriteLine($"[deals-with-companies] skip old customer: id={id} title={title} reason={reason}");
    }
    dealsArray.RemoveAt(i);
  }
  Console.WriteLine(
    $"[deals-with-companies] old-customer filter: before={beforeOldCustomerFilter} removed={removedOldCustomers} after={dealsArray.Count} fieldKey={(string.IsNullOrWhiteSpace(customerKindFieldKey) ? "<auto>" : customerKindFieldKey)}");

  var companyNameById = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

  string? GetVal(JsonNode? n, string key)
  {
    var o = n as JsonObject;
    if (o == null) return null;
    var v = o[key] ?? (key.Length > 0 ? o[char.ToUpperInvariant(key[0]) + key.Substring(1)] : null);
    return v?.GetValue<string>();
  }

  if (included != null)
  {
    foreach (var comp in included["company"]?.AsArray() ?? new JsonArray())
    {
      var id = GetVal(comp, "id");
      if (string.IsNullOrEmpty(id)) continue;
      var name = GetVal(comp, "name") ?? GetVal(comp, "legal_name") ?? "";
      companyNameById[id] = name ?? "";
    }
    foreach (var cont in included["contact"]?.AsArray() ?? new JsonArray())
    {
      var id = GetVal(cont, "id");
      if (string.IsNullOrEmpty(id)) continue;
      var companyName = GetVal(cont, "company_name");
      if (string.IsNullOrEmpty(companyName) && cont is JsonObject co) companyName = GetVal(co["company"] ?? co["Company"], "name");
      if (!string.IsNullOrEmpty(companyName)) companyNameById[id] = companyName;
    }
  }

  // We verwachten dat `included` bij `include=lead.customer` genoeg company/contact info bevat.
  // Als sommige namen niet meegegeven worden, blijft company_name dan leeg in de UI i.p.v. dat we extra list-calls doen.
  var contactCompanyByName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
  if (included != null)
  {
    foreach (var cont in included["contact"]?.AsArray() ?? new JsonArray())
    {
      var id = GetVal(cont, "id");
      if (string.IsNullOrEmpty(id)) continue;
      var companyName = GetVal(cont, "company_name");
      if (string.IsNullOrEmpty(companyName) && cont?["company"] is JsonObject comp) companyName = GetVal(comp, "name");
      if (string.IsNullOrEmpty(companyName) && cont?["Company"] is JsonObject comp2) companyName = GetVal(comp2, "name");
      if (!string.IsNullOrEmpty(companyName)) contactCompanyByName[id] = companyName;
    }
  }

  foreach (var deal in dealsArray)
  {
    if (deal is not JsonObject obj) continue;
    string? customerId = null;
    var lead = deal["lead"] ?? deal["Lead"];
    var cust = lead?["customer"] as JsonObject ?? lead?["Customer"] as JsonObject;
    if (cust != null) customerId = GetVal(cust, "id");
    if (string.IsNullOrEmpty(customerId)) customerId = GetVal(deal, "company_id") ?? GetVal(deal, "customer_id");
    if (string.IsNullOrEmpty(customerId) && (deal["company"] ?? deal["Company"]) is JsonObject co)
      customerId = GetVal(co, "id");

    var companyName = "";
    if (!string.IsNullOrEmpty(customerId))
    {
      if (companyNameById.TryGetValue(customerId, out var n)) companyName = n ?? "";
      else if (contactCompanyByName.TryGetValue(customerId, out var cn)) companyName = cn ?? "";
    }
    obj["company_name"] = JsonValue.Create(companyName);
  }

  var payload = new JsonObject { ["data"] = dealsArray };
  if (!hasMonthFilter)
  {
    lock (dealsWithCompaniesCacheLock)
    {
      dealsWithCompaniesCachePayload = payload;
      dealsWithCompaniesCacheExpiresUtc = DateTimeOffset.UtcNow.AddMinutes(10);
      dealsWithCompaniesCacheStaleUntilUtc = DateTimeOffset.UtcNow.AddMinutes(30);
    }
  }
  else
  {
    lock (dealsWithCompaniesCacheLock)
    {
      // Maand-views prefetchen we in de frontend; langere TTL voorkomt telkens opnieuw Teamleader te raken
      // bij maand-switches / refreshes.
      dealsWithCompaniesMonthCache[monthCacheKey] = (payload, DateTimeOffset.UtcNow.AddMinutes(60));
    }
  }

  return Results.Json(payload);
});

void SaveCallEvent(CallEvent row, string file, object fileLock)
{
  lock (fileLock)
  {
    var rows = LoadCallEvents(file, fileLock);
    rows.Add(row);
    var dir = Path.GetDirectoryName(file);
    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
    File.WriteAllText(file, JsonSerializer.Serialize(rows));
  }
}

List<CallEvent> LoadCallEvents(string file, object fileLock)
{
  lock (fileLock)
  {
    if (!File.Exists(file)) return new List<CallEvent>();
    try
    {
      var json = File.ReadAllText(file);
      var data = JsonSerializer.Deserialize<List<CallEvent>>(json);
      return data ?? new List<CallEvent>();
    }
    catch
    {
      return new List<CallEvent>();
    }
  }
}

CallEvent? ParseCallEvent(JsonObject o)
{
  var directionRaw = FirstString(o, "direction", "call_direction", "type");
  var direction = NormalizeDirection(directionRaw);
  if (direction is null) return null;

  var startedRaw = FirstString(o, "started_at", "start_time", "timestamp", "time");
  var startedAt = ParseDateTime(startedRaw);
  if (startedAt is null) return null;
  var startedAtUtc = startedAt.Value;

  var endedRaw = FirstString(o, "ended_at", "end_time");
  var endedAt = ParseDateTime(endedRaw);

  var durationSec = TryToInt(FirstString(o, "duration_sec", "duration_seconds", "duration", "call_duration"));
  if ((durationSec is null || durationSec < 0) && startedAt is not null && endedAt is not null)
  {
    durationSec = (int)Math.Max(0, (endedAt.Value - startedAt.Value).TotalSeconds);
  }

  var source = (FirstString(o, "source", "provider", "integration") ?? "zapier").Trim();
  var recordingUrl = FirstString(o, "recording_url", "recording", "recording_link");
  var sellerId = FirstString(o, "seller_id", "user_id", "owner_id", "agent_id");
  var sellerName = FirstString(o, "seller_name", "owner_name", "agent_name", "user_name");

  var isMobile = false;
  var mobileRaw = FirstString(o, "is_mobile", "mobile");
  if (!string.IsNullOrWhiteSpace(mobileRaw) && bool.TryParse(mobileRaw, out var m)) isMobile = m;

  return new CallEvent
  {
    Id = Guid.NewGuid().ToString("N"),
    Direction = direction,
    StartedAtUtc = startedAtUtc,
    EndedAtUtc = endedAt,
    DurationSeconds = durationSec,
    RecordingUrl = recordingUrl,
    SellerId = sellerId,
    SellerName = sellerName,
    Source = source,
    IsMobile = isMobile,
    Raw = o,
  };
}

static string? FirstString(JsonObject o, params string[] keys)
{
  foreach (var key in keys)
  {
    if (!o.TryGetPropertyValue(key, out var n)) continue;
    if (n is null) continue;
    var s = n.ToString();
    if (!string.IsNullOrWhiteSpace(s)) return s.Trim();
  }
  return null;
}

static string? NormalizeDirection(string? directionRaw)
{
  var s = (directionRaw ?? "").Trim().ToLowerInvariant();
  if (s is "outgoing" or "outbound" or "uitgaand") return "outgoing";
  if (s is "incoming" or "inbound" or "inkomend") return "incoming";
  return null;
}

static DateTimeOffset? ParseDateTime(string? raw)
{
  if (string.IsNullOrWhiteSpace(raw)) return null;
  if (DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
    return dto.ToUniversalTime();
  if (DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dt))
    return new DateTimeOffset(dt.ToUniversalTime());
  return null;
}

static int? TryToInt(object? value)
{
  if (value is null) return null;
  if (value is int i) return i;
  var s = value.ToString();
  return int.TryParse(s, out var n) ? n : null;
}

static int SafeAvg(IEnumerable<int?> values)
{
  var arr = values.Where(x => x.HasValue).Select(x => x!.Value).ToArray();
  if (arr.Length == 0) return 0;
  return (int)Math.Round(arr.Average(), MidpointRounding.AwayFromZero);
}

static bool IsInPeriod(DateTimeOffset date, string period, string value)
{
  if (period == "week")
  {
    // format: YYYY-Www
    var parts = value.Split("-W", StringSplitOptions.RemoveEmptyEntries);
    if (parts.Length != 2) return false;
    if (!int.TryParse(parts[0], out var y)) return false;
    if (!int.TryParse(parts[1], out var w)) return false;
    var dt = date.UtcDateTime;
    return dt.Year == y && ISOWeek.GetWeekOfYear(dt) == w;
  }
  // default month: YYYY-MM
  var mParts = value.Split('-', StringSplitOptions.RemoveEmptyEntries);
  if (mParts.Length != 2) return false;
  if (!int.TryParse(mParts[0], out var yy)) return false;
  if (!int.TryParse(mParts[1], out var mm)) return false;
  return date.Year == yy && date.Month == mm;
}

static string GoalStatus(int actual, int? target)
{
  if (target is null || target <= 0) return "not_set";
  if (actual >= target) return "on_track";
  var pct = (int)Math.Round((actual * 100.0) / target.Value, MidpointRounding.AwayFromZero);
  if (pct >= 80) return "risk";
  return "off_track";
}

async Task<object> GetPipelineSnapshot(IHttpClientFactory factory)
{
  var (body, err) = await FetchRaw(factory, "https://api.teamleader.eu/deals.list");
  if (err != null || string.IsNullOrWhiteSpace(body))
    return new { available = false, error = err ?? "Kon pipeline-data niet ophalen." };

  try
  {
    var root = JsonNode.Parse(body) as JsonObject;
    var arr = root?["data"]?.AsArray() ?? new JsonArray();
    var total = arr.Count;
    var won = 0;
    var lost = 0;
    var open = 0;
    foreach (var item in arr)
    {
      var status = (item?["status"]?.ToString() ?? "").Trim().ToLowerInvariant();
      if (status == "won") won++;
      else if (status == "lost") lost++;
      else open++;
    }
    var successRate = (won + lost) > 0 ? (int)Math.Round((won * 100.0) / (won + lost), MidpointRounding.AwayFromZero) : 0;
    return new
    {
      available = true,
      deals_total = total,
      deals_open = open,
      deals_won = won,
      deals_lost = lost,
      success_rate_pct = successRate,
    };
  }
  catch
  {
    return new { available = false, error = "Pipeline-data kon niet geparsed worden." };
  }
}

async Task<(string? body, string? error)> FetchRaw(IHttpClientFactory factory, string url)
{
  var token = await GetToken(factory);
  if (string.IsNullOrEmpty(token)) return (null, "Geen token. Ga naar /auth/login.");
  var client = factory.CreateClient();
  client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
  try
  {
    using var req = BuildTeamleaderRequest(url);
    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    var res = await client.SendAsync(req);
    if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
    {
      lock (_lock) { _accessToken = null; }
      token = await GetToken(factory, force: true);
      if (string.IsNullOrEmpty(token)) return (null, "Token verlopen.");
      using var req2 = BuildTeamleaderRequest(url);
      req2.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
      res = await client.SendAsync(req2);
    }
    if (!res.IsSuccessStatusCode) return (null, "Teamleader: " + res.StatusCode);
    var body = await res.Content.ReadAsStringAsync();
    return (body, null);
  }
  catch (Exception ex) { return (null, ex.Message); }
}

async Task<(JsonArray data, JsonObject? included, string? error)> FetchAllListData(
  IHttpClientFactory factory,
  string endpoint,
  string? include = null,
  JsonNode? filter = null)
{
  var token = await GetToken(factory);
  if (string.IsNullOrEmpty(token)) return (new JsonArray(), null, "Geen token. Ga naar /auth/login.");

  var client = factory.CreateClient();
  var all = new JsonArray();
  var mergedIncluded = new JsonObject();
  const int pageSize = 100;

  for (var page = 1; page <= 200; page++)
  {
    var body = new JsonObject
    {
      ["filter"] = filter?.DeepClone() ?? new JsonObject(),
      ["page"] = new JsonObject
      {
        ["number"] = page,
        ["size"] = pageSize
      }
    };
    if (!string.IsNullOrWhiteSpace(include))
    {
      body["include"] = include;
    }

    const int maxRetriesPerPage = 6;
    HttpResponseMessage res = null!;
    var gotSuccess = false;

    for (var attempt = 0; attempt < maxRetriesPerPage; attempt++)
    {
      using var req = new HttpRequestMessage(HttpMethod.Post, $"https://api.teamleader.eu/{endpoint}");
      req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
      req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");

      try
      {
        res = await client.SendAsync(req);
      }
      catch (Exception ex)
      {
        return (new JsonArray(), null, ex.Message);
      }

      if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
      {
        lock (_lock) { _accessToken = null; }
        token = await GetToken(factory, force: true);
        if (string.IsNullOrEmpty(token)) return (new JsonArray(), null, "Token verlopen.");
        continue;
      }

      if (res.StatusCode == (System.Net.HttpStatusCode)429)
      {
        // Backoff bij rate-limit; Retry-After is soms aanwezig.
        var retryAfter = res.Headers.RetryAfter?.Delta;
        var delay = retryAfter ?? TimeSpan.FromSeconds(Math.Min(60, Math.Pow(2, attempt)));
        await Task.Delay(delay);

        if (attempt == maxRetriesPerPage - 1)
          return (new JsonArray(), null, "Teamleader: " + res.StatusCode);

        continue;
      }

      if (!res.IsSuccessStatusCode)
        return (new JsonArray(), null, "Teamleader: " + res.StatusCode);

      gotSuccess = true;
      break;
    }

    if (!gotSuccess)
      return (new JsonArray(), null, "Teamleader: ongeldige response (retry uitgeput).");

    var raw = await res.Content.ReadAsStringAsync();
    JsonObject? root;
    try
    {
      root = JsonNode.Parse(raw) as JsonObject;
    }
    catch
    {
      return (new JsonArray(), null, "Kon Teamleader-response niet parsen.");
    }

    var pageData = root?["data"] as JsonArray ?? new JsonArray();
    foreach (var item in pageData) all.Add(item?.DeepClone());

    if (root?["included"] is JsonObject inc)
    {
      foreach (var kv in inc)
      {
        var key = kv.Key;
        var arr = kv.Value as JsonArray;
        if (arr == null) continue;
        if (mergedIncluded[key] is not JsonArray outArr)
        {
          outArr = new JsonArray();
          mergedIncluded[key] = outArr;
        }
        foreach (var n in arr) outArr.Add(n?.DeepClone());
      }
    }

    if (pageData.Count < pageSize) break;
  }

  return (all, mergedIncluded, null);
}

async Task<JsonObject?> FetchDealInfoWithRetry(IHttpClientFactory factory, string id)
{
  lock (dealInfoCacheLock)
  {
    if (dealInfoCache.TryGetValue(id, out var cached) && DateTimeOffset.UtcNow <= cached.expiresUtc)
      return cached.data;
  }

  var token = await GetToken(factory);
  if (string.IsNullOrEmpty(token)) return null;
  var client = factory.CreateClient();

  for (var attempt = 0; attempt < 3; attempt++)
  {
    using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.teamleader.eu/deals.info");
    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    req.Content = new StringContent(JsonSerializer.Serialize(new { id }), Encoding.UTF8, "application/json");
    HttpResponseMessage res;
    try
    {
      res = await client.SendAsync(req);
    }
    catch
    {
      return null;
    }

    if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
    {
      lock (_lock) { _accessToken = null; }
      token = await GetToken(factory, force: true);
      if (string.IsNullOrEmpty(token)) return null;
      continue;
    }

    if (res.StatusCode == (System.Net.HttpStatusCode)429)
    {
      // Respecteer Retry-After als die meegegeven wordt.
      var retryAfterSeconds = res.Headers.RetryAfter?.Delta?.TotalSeconds;
      var wait = retryAfterSeconds.HasValue && retryAfterSeconds.Value > 0
        ? TimeSpan.FromSeconds(Math.Min(30, retryAfterSeconds.Value))
        : TimeSpan.FromSeconds(4 + attempt * 3);
      await Task.Delay(wait);
      continue;
    }

    if (!res.IsSuccessStatusCode) return null;
    try
    {
      var body = await res.Content.ReadAsStringAsync();
      var root = JsonNode.Parse(body) as JsonObject;
      var data = root?["data"] as JsonObject;
      if (data != null)
      {
        lock (dealInfoCacheLock)
        {
          dealInfoCache[id] = (data, DateTimeOffset.UtcNow.AddMinutes(30));
        }
      }
      return data;
    }
    catch
    {
      return null;
    }
  }
  return null;
}

async Task<IResult> Fetch(IHttpClientFactory factory, string url)
{
  var token = await GetToken(factory);
  if (string.IsNullOrEmpty(token))
    return Results.Json(new { data = Array.Empty<object>(), _error = "Geen token. Ga naar /auth/login of wacht even." }, statusCode: 502);

  var client = factory.CreateClient();
  try
  {
    using var req = BuildTeamleaderRequest(url);
    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    var res = await client.SendAsync(req);
    if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
    {
      lock (_lock) { _accessToken = null; }
      token = await GetToken(factory, force: true);
      if (string.IsNullOrEmpty(token)) return Results.Json(new { data = Array.Empty<object>(), _error = "Token verlopen." }, statusCode: 502);
      using var req2 = BuildTeamleaderRequest(url);
      req2.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
      res = await client.SendAsync(req2);
    }
    if (!res.IsSuccessStatusCode) return Results.Json(new { data = Array.Empty<object>(), _error = "Teamleader: " + res.StatusCode }, statusCode: 502);
    var json = await res.Content.ReadFromJsonAsync<ListResponse>();
    return Results.Json(new { data = json?.Data ?? Array.Empty<object>() });
  }
  catch (Exception ex)
  {
    return Results.Json(new { data = Array.Empty<object>(), _error = ex.Message }, statusCode: 502);
  }
}

static HttpRequestMessage BuildTeamleaderRequest(string url)
{
  // Teamleader `.list` endpoints zijn POST met JSON body (API docs).
  // Oude GET-requests missen velden zoals `phase_history`, wat we nodig hebben voor funnel-cijfers.
  var u = new Uri(url);
  var path = u.GetLeftPart(UriPartial.Path);
  var isList = path.EndsWith(".list", StringComparison.OrdinalIgnoreCase);
  if (!isList) return new HttpRequestMessage(HttpMethod.Get, url);

  string? include = null;
  var q = u.Query?.TrimStart('?') ?? "";
  if (!string.IsNullOrWhiteSpace(q))
  {
    foreach (var part in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
    {
      var kv = part.Split('=', 2);
      if (kv.Length != 2) continue;
      var key = Uri.UnescapeDataString(kv[0]);
      var val = Uri.UnescapeDataString(kv[1]);
      if (string.Equals(key, "include", StringComparison.OrdinalIgnoreCase)) include = val;
    }
  }

  var body = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
  {
    ["filter"] = new { },
  };
  if (!string.IsNullOrWhiteSpace(include)) body["include"] = include;

  var json = System.Text.Json.JsonSerializer.Serialize(body);
  var req = new HttpRequestMessage(HttpMethod.Post, path);
  req.Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
  return req;
}

async Task<string?> GetToken(IHttpClientFactory factory, bool force = false)
{
  if (!force) { lock (_lock) { if (!string.IsNullOrEmpty(_accessToken)) return _accessToken; } }
  else lock (_lock) { _accessToken = null; }

  var client = factory.CreateClient();

  if (!string.IsNullOrEmpty(_refreshToken))
  {
    var body = new FormUrlEncodedContent(new Dictionary<string, string>
    {
      ["client_id"] = clientId, ["client_secret"] = clientSecret, ["grant_type"] = "refresh_token", ["refresh_token"] = _refreshToken,
    });
    var res = await client.PostAsync($"{TeamleaderOAuthBase}/oauth2/access_token", body);
    if (res.IsSuccessStatusCode)
    {
      var j = await res.Content.ReadFromJsonAsync<TokenResponse>();
      if (!string.IsNullOrEmpty(j?.AccessToken)) { SaveTokens(j.AccessToken, j.RefreshToken ?? _refreshToken); return j.AccessToken; }
    }
  }

  var cc = new FormUrlEncodedContent(new Dictionary<string, string>
  {
    ["client_id"] = clientId, ["client_secret"] = clientSecret, ["grant_type"] = "client_credentials",
  });
  var r = await client.PostAsync($"{TeamleaderOAuthBase}/oauth2/access_token", cc);
  if (r.IsSuccessStatusCode)
  {
    var j = await r.Content.ReadFromJsonAsync<TokenResponse>();
    if (!string.IsNullOrEmpty(j?.AccessToken)) { lock (_lock) { _accessToken = j.AccessToken; } return j.AccessToken; }
  }

  return null;
}

static string GraphODataEscape(string s) => s.Replace("'", "''", StringComparison.Ordinal);

static bool TryParseGraphYearMonth(string? period, out DateTimeOffset rangeStart, out DateTimeOffset rangeEndExclusive)
{
  rangeStart = default;
  rangeEndExclusive = default;
  var p = (period ?? "").Trim();
  if (p.Length != 7 || p[4] != '-') return false;
  if (!int.TryParse(p.AsSpan(0, 4), out var y) || !int.TryParse(p.AsSpan(5, 2), out var mo) || mo is < 1 or > 12)
    return false;
  rangeStart = new DateTimeOffset(y, mo, 1, 0, 0, 0, TimeSpan.Zero);
  rangeEndExclusive = rangeStart.AddMonths(1);
  return true;
}

async Task<string?> GetGraphAppTokenAsync(IHttpClientFactory factory)
{
  lock (graphTokenLock)
  {
    if (!string.IsNullOrEmpty(graphAppToken) && DateTimeOffset.UtcNow < graphAppTokenExpiresUtc.AddMinutes(-2))
      return graphAppToken;
  }

  var client = factory.CreateClient();
  var form = new Dictionary<string, string>
  {
    ["client_id"] = graphClientId,
    ["client_secret"] = graphClientSecret,
    ["scope"] = "https://graph.microsoft.com/.default",
    ["grant_type"] = "client_credentials",
  };
  var res = await client.PostAsync(
    $"https://login.microsoftonline.com/{graphTenantId}/oauth2/v2.0/token",
    new FormUrlEncodedContent(form));
  if (!res.IsSuccessStatusCode) return null;

  using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
  var root = doc.RootElement;
  if (!root.TryGetProperty("access_token", out var atEl)) return null;
  var tok = atEl.GetString();
  var sec = 3600;
  if (root.TryGetProperty("expires_in", out var expEl) && expEl.TryGetInt32(out var e)) sec = e;
  lock (graphTokenLock)
  {
    graphAppToken = tok;
    graphAppTokenExpiresUtc = DateTimeOffset.UtcNow.AddSeconds(sec);
  }
  return tok;
}

async Task<string?> GraphResolveUserIdAsync(IHttpClientFactory factory, string graphToken, string emailOrUpn)
{
  var q = GraphODataEscape(emailOrUpn.Trim());
  if (string.IsNullOrEmpty(q)) return null;
  var filter = $"mail eq '{q}' or userPrincipalName eq '{q}'";
  var url = "https://graph.microsoft.com/v1.0/users?$filter=" + Uri.EscapeDataString(filter) + "&$select=id&$top=1";
  var client = factory.CreateClient();
  using var req = new HttpRequestMessage(HttpMethod.Get, url);
  req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", graphToken);
  var res = await client.SendAsync(req);
  if (!res.IsSuccessStatusCode) return null;
  using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
  if (!doc.RootElement.TryGetProperty("value", out var arr) || arr.ValueKind != JsonValueKind.Array || arr.GetArrayLength() == 0)
    return null;
  var first = arr[0];
  return first.TryGetProperty("id", out var id) ? id.GetString() : null;
}

app.MapGet("/ms365/users", async (IHttpClientFactory f) =>
{
  if (!graphIsConfigured)
    return Results.Json(new { data = Array.Empty<object>(), _note = "MicrosoftGraph (TenantId, ClientId, ClientSecret) niet geconfigureerd." });
  var token = await GetGraphAppTokenAsync(f);
  if (string.IsNullOrEmpty(token))
    return Results.Json(new { data = Array.Empty<object>(), _error = "Graph-token mislukt (controleer geheim en app-registratie)." }, statusCode: 502);

  var client = f.CreateClient();
  var list = new List<Dictionary<string, string>>();
  var next = "https://graph.microsoft.com/v1.0/users?$select=displayName,mail,userPrincipalName&$orderby=displayName&$top=999";
  while (!string.IsNullOrEmpty(next))
  {
    using var req = new HttpRequestMessage(HttpMethod.Get, next);
    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    var res = await client.SendAsync(req);
    if (!res.IsSuccessStatusCode)
      return Results.Json(new { data = list, _error = "Graph users: " + res.StatusCode }, statusCode: 502);
    using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
    var root = doc.RootElement;
    if (root.TryGetProperty("value", out var values) && values.ValueKind == JsonValueKind.Array)
    {
      foreach (var u in values.EnumerateArray())
      {
        var dn = u.TryGetProperty("displayName", out var d) ? d.GetString() ?? "" : "";
        var mail = u.TryGetProperty("mail", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() ?? "" : "";
        if (string.IsNullOrEmpty(mail) && u.TryGetProperty("userPrincipalName", out var upn))
          mail = upn.GetString() ?? "";
        if (string.IsNullOrEmpty(dn) && !string.IsNullOrEmpty(mail)) dn = mail;
        if (string.IsNullOrEmpty(dn)) continue;
        list.Add(new Dictionary<string, string> { ["displayName"] = dn, ["mail"] = mail });
      }
    }
    next = root.TryGetProperty("@odata.nextLink", out var nl) ? nl.GetString() ?? "" : "";
  }
  return Results.Json(new { data = list });
});

app.MapGet("/ms365/emails", async (HttpContext ctx, IHttpClientFactory f) =>
{
  var user = (ctx.Request.Query["user"].ToString() ?? "").Trim();
  var period = (ctx.Request.Query["period"].ToString() ?? "").Trim();
  if (!graphIsConfigured)
    return Results.Json(new { count = 0, _note = "MicrosoftGraph niet geconfigureerd." });
  if (string.IsNullOrEmpty(user) || !TryParseGraphYearMonth(period, out var start, out var endEx))
    return Results.Json(new { count = 0, _error = "Query ?user= en ?period=YYYY-MM verplicht." }, statusCode: 400);

  var token = await GetGraphAppTokenAsync(f);
  if (string.IsNullOrEmpty(token))
    return Results.Json(new { count = 0, _error = "Graph-token mislukt." }, statusCode: 502);
  var userId = await GraphResolveUserIdAsync(f, token, user);
  if (string.IsNullOrEmpty(userId))
    return Results.Json(new { count = 0, _error = "Gebruiker niet gevonden in Entra." }, statusCode: 404);

  var startIso = start.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
  var endIso = endEx.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
  var filter = $"sentDateTime ge {startIso} and sentDateTime lt {endIso}";
  var countPath = $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(userId)}/mailFolders/sentItems/messages/$count?$filter={Uri.EscapeDataString(filter)}";

  var client = f.CreateClient();
  using (var creq = new HttpRequestMessage(HttpMethod.Get, countPath))
  {
    creq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    creq.Headers.TryAddWithoutValidation("ConsistencyLevel", "eventual");
    var cres = await client.SendAsync(creq);
    if (cres.IsSuccessStatusCode)
    {
      var body = (await cres.Content.ReadAsStringAsync()).Trim();
      if (int.TryParse(body, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n))
        return Results.Json(new { count = n });
    }
  }

  var total = 0;
  var msgUrl =
    $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(userId)}/mailFolders/sentItems/messages?$select=id&$filter={Uri.EscapeDataString(filter)}&$top=500";
  while (!string.IsNullOrEmpty(msgUrl) && total < 100_000)
  {
    using var mreq = new HttpRequestMessage(HttpMethod.Get, msgUrl);
    mreq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    mreq.Headers.TryAddWithoutValidation("ConsistencyLevel", "eventual");
    var mres = await client.SendAsync(mreq);
    if (!mres.IsSuccessStatusCode)
      return Results.Json(new { count = 0, _error = "Graph sentItems: " + mres.StatusCode }, statusCode: 502);
    using var doc = JsonDocument.Parse(await mres.Content.ReadAsStringAsync());
    var root = doc.RootElement;
    if (root.TryGetProperty("value", out var vals) && vals.ValueKind == JsonValueKind.Array)
      total += vals.GetArrayLength();
    msgUrl = root.TryGetProperty("@odata.nextLink", out var nl) ? nl.GetString() ?? "" : "";
  }
  return Results.Json(new { count = total });
});

app.MapGet("/ms365/emails/daily", async (HttpContext ctx, IHttpClientFactory f) =>
{
  var user = (ctx.Request.Query["user"].ToString() ?? "").Trim();
  var period = (ctx.Request.Query["period"].ToString() ?? "").Trim();
  if (!graphIsConfigured)
    return Results.Json(new { days = Array.Empty<object>(), _note = "MicrosoftGraph niet geconfigureerd." });
  if (string.IsNullOrEmpty(user) || !TryParseGraphYearMonth(period, out var start, out var endEx))
    return Results.Json(new { days = Array.Empty<object>(), _error = "Query ?user= en ?period=YYYY-MM verplicht." }, statusCode: 400);

  var token = await GetGraphAppTokenAsync(f);
  if (string.IsNullOrEmpty(token))
    return Results.Json(new { days = Array.Empty<object>(), _error = "Graph-token mislukt." }, statusCode: 502);
  var userId = await GraphResolveUserIdAsync(f, token, user);
  if (string.IsNullOrEmpty(userId))
    return Results.Json(new { days = Array.Empty<object>(), _error = "Gebruiker niet gevonden." }, statusCode: 404);

  var startIso = start.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
  var endIso = endEx.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
  var filter = $"sentDateTime ge {startIso} and sentDateTime lt {endIso}";
  var byDay = new Dictionary<string, int>(StringComparer.Ordinal);
  var client = f.CreateClient();
  var msgUrl =
    $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(userId)}/mailFolders/sentItems/messages?$select=sentDateTime&$filter={Uri.EscapeDataString(filter)}&$top=500";
  var pages = 0;
  while (!string.IsNullOrEmpty(msgUrl) && pages < 200)
  {
    pages++;
    using var mreq = new HttpRequestMessage(HttpMethod.Get, msgUrl);
    mreq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    mreq.Headers.TryAddWithoutValidation("ConsistencyLevel", "eventual");
    var mres = await client.SendAsync(mreq);
    if (!mres.IsSuccessStatusCode)
      return Results.Json(new { days = Array.Empty<object>(), _error = "Graph: " + mres.StatusCode }, statusCode: 502);
    using var doc = JsonDocument.Parse(await mres.Content.ReadAsStringAsync());
    var root = doc.RootElement;
    if (root.TryGetProperty("value", out var values) && values.ValueKind == JsonValueKind.Array)
    {
      foreach (var msg in values.EnumerateArray())
      {
        if (!msg.TryGetProperty("sentDateTime", out var sd)) continue;
        var s = sd.GetString();
        if (string.IsNullOrEmpty(s) || s.Length < 10) continue;
        var day = s[..10];
        byDay[day] = (byDay.TryGetValue(day, out var c) ? c : 0) + 1;
      }
    }
    msgUrl = root.TryGetProperty("@odata.nextLink", out var nl) ? nl.GetString() ?? "" : "";
  }

  var days = byDay.OrderBy(kv => kv.Key).Select(kv => new { date = kv.Key, count = kv.Value }).ToArray();
  return Results.Json(new { days });
});

app.MapFallback(async ctx =>
{
  if (ctx.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/auth", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/ms365", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/users", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/deals", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/deals-with-companies", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/contacts", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/companies", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/tasks", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/calls", StringComparison.OrdinalIgnoreCase) ||
      ctx.Request.Path.StartsWithSegments("/integrations", StringComparison.OrdinalIgnoreCase))
  {
    ctx.Response.StatusCode = 404;
    await ctx.Response.WriteAsync("Not Found");
    return;
  }

  if (string.IsNullOrWhiteSpace(frontendRootPath))
  {
    ctx.Response.StatusCode = 503;
    await ctx.Response.WriteAsync("Frontend files missing");
    return;
  }

  ctx.Response.ContentType = "text/html; charset=utf-8";
  await ctx.Response.SendFileAsync(Path.Combine(frontendRootPath, "index.html"));
});

app.Run();

file class TokenFile { public string? AccessToken { get; set; } public string? RefreshToken { get; set; } }
file class TokenResponse { [JsonPropertyName("access_token")] public string? AccessToken { get; set; } [JsonPropertyName("refresh_token")] public string? RefreshToken { get; set; } }
file class ListResponse { [JsonPropertyName("data")] public object[]? Data { get; set; } }
file class CallEvent
{
  public string Id { get; set; } = "";
  public string Direction { get; set; } = ""; // incoming | outgoing
  public DateTimeOffset StartedAtUtc { get; set; }
  public DateTimeOffset? EndedAtUtc { get; set; }
  public int? DurationSeconds { get; set; }
  public string? RecordingUrl { get; set; }
  public string? SellerId { get; set; }
  public string? SellerName { get; set; }
  public string Source { get; set; } = "zapier";
  public bool IsMobile { get; set; }
  public JsonObject? Raw { get; set; }
}
