using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/comprobantes")]
public class ComprobantesController : ControllerBase
{
    private readonly IComprobanteService _svc;
    public ComprobantesController(IComprobanteService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.ComprobantesRead)]
    public async Task<ActionResult<PagedResult<ComprobanteDto>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] DateTime? desde = null, [FromQuery] DateTime? hasta = null,
        [FromQuery] byte? tipoId = null, [FromQuery] int? puntoVentaId = null, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(page, pageSize, desde, hasta, tipoId, puntoVentaId, ct));

    [HttpPost]
    [RequirePermiso(Permisos.ComprobantesWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] ComprobanteCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));

    /// <summary>Solicita el CAE a ARCA (AFIP WSFE). Devuelve 501 si el módulo no está configurado.</summary>
    [HttpPost("{id:int}/solicitar-cae")]
    [RequirePermiso(Permisos.ComprobantesArca)]
    public async Task<IActionResult> SolicitarCae(int id, CancellationToken ct)
    {
        await _svc.SolicitarCaeAsync(id, ct);
        return NoContent();
    }
}

[ApiController]
[Authorize]
[Route("api/adjuntos")]
public class AdjuntosController : ControllerBase
{
    private readonly IAdjuntoService _svc;
    public AdjuntosController(IAdjuntoService svc) { _svc = svc; }

    /// <summary>Sube un archivo (multipart/form-data) y lo vincula a una entidad.</summary>
    [HttpPost]
    [RequestSizeLimit(50_000_000)] // 50 MB
    public async Task<ActionResult<IdResponse>> Subir(
        [FromForm] IFormFile file,
        [FromForm] string entidad,
        [FromForm] string entidadId,
        CancellationToken ct)
    {
        if (file == null || file.Length == 0) return BadRequest("Archivo vacío.");
        using var stream = file.OpenReadStream();
        var id = await _svc.SubirAsync(stream, file.FileName, file.ContentType, entidad, entidadId, ct);
        return Ok(new IdResponse(id));
    }

    /// <summary>Descarga un adjunto por id.</summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Descargar(int id, CancellationToken ct)
    {
        var (stream, ct2, name) = await _svc.DescargarAsync(id, ct);
        return File(stream, ct2 ?? "application/octet-stream", name);
    }
}

[ApiController]
[Authorize]
[Route("api/dashboard")]
public class DashboardController : ControllerBase
{
    private readonly IDashboardService _svc;
    private readonly IMargenBrutoService _mb;
    public DashboardController(IDashboardService svc, IMargenBrutoService mb) { _svc = svc; _mb = mb; }

    [HttpGet]
    [RequirePermiso(Permisos.DashboardRead)]
    public async Task<ActionResult<DashboardDto>> Get(CancellationToken ct) => Ok(await _svc.GetAsync(ct));

    [HttpGet("margen-bruto/top")]
    [RequirePermiso(Permisos.AnalyticsRead)]
    public async Task<ActionResult<IReadOnlyList<MargenBrutoDto>>> Top([FromQuery] int top = 5, CancellationToken ct = default)
        => Ok(await _mb.TopCampanasAsync(top, ct));
}
