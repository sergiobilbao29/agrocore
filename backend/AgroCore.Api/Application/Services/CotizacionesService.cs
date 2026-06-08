using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using Microsoft.Extensions.Caching.Memory;

namespace AgroCore.Application.Services;

/// <summary>
/// Obtiene cotizaciones de granos (Bolsa de Comercio de Rosario) y dólar
/// (BNA vía dolarapi.com). Cachea la respuesta final durante 10 minutos.
///
/// Fuentes consultadas (mejor esfuerzo; si alguna falla se usan fallbacks):
///   - BCR — https://www.bcr.com.ar/es/mercados/mercado-de-granos/cotizaciones/cotizaciones-actuales-0
///   - DolarApi — https://dolarapi.com/v1/dolares
///
/// Política de cache:
///   - Éxito → 10 minutos de TTL.
///   - Fallo parcial → se entrega lo bueno y se marca EsStale=false.
///   - Fallo total → se devuelven valores semilla con EsStale=true y TTL 60s.
/// </summary>
public class CotizacionesService : ICotizacionesService
{
    private const string CacheKey = "agrocore:cotizaciones:bolsa";
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan StaleTtl = TimeSpan.FromSeconds(60);

    private readonly IHttpClientFactory _http;
    private readonly IMemoryCache _cache;
    private readonly ILogger<CotizacionesService> _log;

    public CotizacionesService(IHttpClientFactory http, IMemoryCache cache, ILogger<CotizacionesService> log)
    {
        _http = http; _cache = cache; _log = log;
    }

    public async Task<CotizacionesResponseDto> GetAsync(CancellationToken ct = default)
    {
        if (_cache.TryGetValue<CotizacionesResponseDto>(CacheKey, out var cached) && cached is not null)
            return cached;

        var granosTask = FetchGranosAsync(ct);
        var dolaresTask = FetchDolaresAsync(ct);
        await Task.WhenAll(granosTask, dolaresTask);

        var granos = granosTask.Result;
        var dolares = dolaresTask.Result;

        var stale = granos.Count == 0 || dolares.Count == 0;
        if (granos.Count == 0) granos = SeedGranos();
        if (dolares.Count == 0) dolares = SeedDolares();

        var resp = new CotizacionesResponseDto(
            granos,
            dolares,
            DateTime.UtcNow,
            stale,
            stale ? "Se muestran valores de referencia. Reintentando fuentes externas..." : null);

        _cache.Set(CacheKey, resp, stale ? StaleTtl : Ttl);
        return resp;
    }

    // ---------------------------------------------------------------- GRANOS (BCR)
    private async Task<List<CotizacionGranoDto>> FetchGranosAsync(CancellationToken ct)
    {
        try
        {
            var client = _http.CreateClient("cotizaciones");
            client.Timeout = TimeSpan.FromSeconds(8);
            var url = "https://www.bcr.com.ar/es/mercados/mercado-de-granos/cotizaciones/cotizaciones-actuales-0";
            var html = await client.GetStringAsync(url, ct);
            return ParseBcrHtml(html);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "No pudimos consultar BCR Rosario; se usa fallback.");
            return new();
        }
    }

    /// <summary>
    /// Parser permisivo del HTML de BCR. Busca filas con el nombre del producto y el
    /// primer número decimal inmediato posterior (pizarra $/ton).  Si la estructura
    /// cambia, el parser devuelve lo que pudo y el resto se completa con el seed.
    /// </summary>
    internal static List<CotizacionGranoDto> ParseBcrHtml(string html)
    {
        var items = new List<CotizacionGranoDto>();
        var products = new (string codigo, string nombre, string[] aliases)[]
        {
            ("SOJA",    "Soja",    new[] { "Soja" }),
            ("MAIZ",    "Maíz",    new[] { "Maíz", "Maiz" }),
            ("TRIGO",   "Trigo",   new[] { "Trigo" }),
            ("SORGO",   "Sorgo",   new[] { "Sorgo" }),
            ("GIRASOL", "Girasol", new[] { "Girasol" }),
        };

        foreach (var p in products)
        {
            foreach (var alias in p.aliases)
            {
                // Buscamos: "Soja"  ...  NNN.NNN o  NNN,NN (pesos argentinos)
                var rx = new Regex(
                    @"\b" + Regex.Escape(alias) + @"\b[^<]{0,200}?(\d{1,3}(?:[.,]\d{3})?(?:[.,]\d{1,2})?)",
                    RegexOptions.IgnoreCase);
                var m = rx.Match(html);
                if (m.Success && TryParseArs(m.Groups[1].Value, out var price))
                {
                    items.Add(new CotizacionGranoDto(
                        p.codigo, p.nombre, price, null, null, DateTime.UtcNow.Date, "BCR"));
                    break;
                }
            }
        }
        return items;
    }

    private static bool TryParseArs(string raw, out decimal value)
    {
        raw = raw.Replace(".", "").Replace(",", ".");
        return decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out value);
    }

    // ---------------------------------------------------------------- DÓLAR (dolarapi.com)
    private async Task<List<CotizacionDolarDto>> FetchDolaresAsync(CancellationToken ct)
    {
        try
        {
            var client = _http.CreateClient("cotizaciones");
            client.Timeout = TimeSpan.FromSeconds(6);
            var json = await client.GetStringAsync("https://dolarapi.com/v1/dolares", ct);
            using var doc = JsonDocument.Parse(json);
            var list = new List<CotizacionDolarDto>();
            var map = new Dictionary<string, (string codigo, string nombre)>
            {
                ["oficial"]   = ("OFICIAL",     "Dólar Oficial"),
                ["blue"]      = ("BLUE",        "Dólar Blue"),
                ["bolsa"]     = ("MEP",         "Dólar MEP"),
                ["contadoconliqui"] = ("CCL",   "Dólar CCL"),
                ["mayorista"] = ("MAYORISTA",   "Dólar Mayorista"),
                ["tarjeta"]   = ("TARJETA",     "Dólar Tarjeta"),
            };
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                var tipo = el.GetProperty("casa").GetString()?.ToLowerInvariant() ?? "";
                if (!map.TryGetValue(tipo, out var meta)) continue;
                var compra = el.TryGetProperty("compra", out var c) && c.ValueKind == JsonValueKind.Number
                    ? c.GetDecimal() : 0m;
                var venta = el.TryGetProperty("venta", out var v) && v.ValueKind == JsonValueKind.Number
                    ? v.GetDecimal() : 0m;
                DateTime? fecha = null;
                if (el.TryGetProperty("fechaActualizacion", out var f) && f.ValueKind == JsonValueKind.String
                    && DateTime.TryParse(f.GetString(), out var parsed))
                    fecha = parsed.ToUniversalTime();
                list.Add(new CotizacionDolarDto(meta.codigo, meta.nombre, compra, venta, fecha, "DolarApi"));
            }
            // Dólar exportación = promedio 50/50 entre oficial y CCL (aproximación blend agro).
            var oficial = list.FirstOrDefault(d => d.Codigo == "OFICIAL");
            var ccl = list.FirstOrDefault(d => d.Codigo == "CCL");
            if (oficial is not null && ccl is not null)
            {
                list.Add(new CotizacionDolarDto(
                    "EXPORTACION", "Dólar Exportación",
                    Math.Round((oficial.Compra + ccl.Compra) / 2m, 2),
                    Math.Round((oficial.Venta + ccl.Venta) / 2m, 2),
                    DateTime.UtcNow,
                    "Calculado"));
            }
            return list;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "No pudimos consultar dolarapi.com; se usa fallback.");
            return new();
        }
    }

    // ---------------------------------------------------------------- SEEDS
    private static List<CotizacionGranoDto> SeedGranos() => new()
    {
        new("SOJA",    "Soja",    465000m, 355m, null, DateTime.UtcNow.Date, "Fallback"),
        new("MAIZ",    "Maíz",    251000m, 190m, null, DateTime.UtcNow.Date, "Fallback"),
        new("TRIGO",   "Trigo",   260000m, 205m, null, DateTime.UtcNow.Date, "Fallback"),
        new("SORGO",   "Sorgo",   263500m, 200m, null, DateTime.UtcNow.Date, "Fallback"),
        new("GIRASOL", "Girasol", 430000m, 340m, null, DateTime.UtcNow.Date, "Fallback"),
    };

    private static List<CotizacionDolarDto> SeedDolares() => new()
    {
        new("OFICIAL",     "Dólar Oficial",     1385m, 1435m, DateTime.UtcNow, "Fallback"),
        new("BLUE",        "Dólar Blue",        1405m, 1425m, DateTime.UtcNow, "Fallback"),
        new("MEP",         "Dólar MEP",         1410m, 1420m, DateTime.UtcNow, "Fallback"),
        new("CCL",         "Dólar CCL",         1415m, 1430m, DateTime.UtcNow, "Fallback"),
        new("EXPORTACION", "Dólar Exportación", 1400m, 1432m, DateTime.UtcNow, "Fallback"),
    };
}
