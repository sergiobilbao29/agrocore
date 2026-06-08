using System.Text.Json.Serialization;

namespace AgroCore.Application.DTOs;

/// <summary>
/// Cotización de un grano (pizarra FOB Rosario).
/// </summary>
public record CotizacionGranoDto(
    string Codigo,         // SOJA / MAIZ / TRIGO / SORGO / GIRASOL
    string Nombre,         // "Soja", "Maíz", ...
    decimal? PrecioArs,    // $/ton pizarra Rosario
    decimal? PrecioUsd,    // USD/ton (FOB) si está disponible
    decimal? VariacionPct, // % vs día anterior (puede ser negativo)
    DateTime? FechaDato,   // fecha del dato
    string Fuente          // "BCR", "Matba", "Manual", "Fallback"
);

/// <summary>Cotización de una variante de dólar (oficial, blue, MEP, exportación).</summary>
public record CotizacionDolarDto(
    string Codigo,      // OFICIAL / BLUE / MEP / CCL / EXPORTACION / TARJETA
    string Nombre,
    decimal Compra,
    decimal Venta,
    DateTime? FechaDato,
    string Fuente       // "BNA", "DolarApi", "Manual", "Fallback"
);

/// <summary>Respuesta del endpoint /api/cotizaciones/bolsa.</summary>
public record CotizacionesResponseDto(
    List<CotizacionGranoDto> Granos,
    List<CotizacionDolarDto> Dolares,
    DateTime ActualizadoAt,
    bool EsStale,       // true si devolvemos valores de fallback/caché vencida
    string? MensajeFuente
);
