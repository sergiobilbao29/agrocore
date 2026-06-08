using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

/// <summary>
/// Endpoint de lectura para el banner de cotizaciones (BCR Rosario + dólar).
/// Cualquier usuario autenticado puede consumirlo.
/// </summary>
[ApiController]
[Authorize]
[Route("api/cotizaciones")]
public class CotizacionesController : ControllerBase
{
    private readonly ICotizacionesService _svc;
    public CotizacionesController(ICotizacionesService svc) { _svc = svc; }

    /// <summary>
    /// GET /api/cotizaciones/bolsa — últimas cotizaciones de granos (BCR) y dólar.
    /// Cacheado 10 min en el servidor. Clientes ofrecen stale-while-revalidate.
    /// </summary>
    [HttpGet("bolsa")]
    public async Task<ActionResult<CotizacionesResponseDto>> Bolsa(CancellationToken ct)
    {
        var data = await _svc.GetAsync(ct);
        Response.Headers.CacheControl = "public, max-age=300"; // 5 min en cliente
        return Ok(data);
    }
}
