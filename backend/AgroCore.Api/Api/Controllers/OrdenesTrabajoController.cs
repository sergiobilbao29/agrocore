using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/ordenes-trabajo")]
public class OrdenesTrabajoController : ControllerBase
{
    private readonly IOrdenTrabajoService _svc;
    public OrdenesTrabajoController(IOrdenTrabajoService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.OrdenesRead)]
    public async Task<ActionResult<PagedResult<OrdenTrabajoDto>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] int? loteId = null, [FromQuery] int? campanaId = null,
        [FromQuery] string? estado = null,
        [FromQuery] DateTime? desde = null, [FromQuery] DateTime? hasta = null,
        CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(page, pageSize, loteId, campanaId, estado, desde, hasta, ct));

    [HttpGet("{id:int}")]
    [RequirePermiso(Permisos.OrdenesRead)]
    public async Task<ActionResult<OrdenTrabajoDetalleDto>> Obtener(int id, CancellationToken ct)
    {
        var ot = await _svc.ObtenerAsync(id, ct);
        return ot is null ? NotFound() : Ok(ot);
    }

    [HttpPost]
    [RequirePermiso(Permisos.OrdenesWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] OrdenTrabajoCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));

    /// <summary>Registra la ejecución real (consumos, horas, traza GPS).</summary>
    [HttpPost("{id:int}/ejecutar")]
    [RequirePermiso(Permisos.OrdenesWrite)]
    public async Task<IActionResult> Ejecutar(int id, [FromBody] OrdenTrabajoEjecutarDto dto, CancellationToken ct)
    {
        await _svc.EjecutarAsync(id, dto, ct);
        return NoContent();
    }

    [HttpPost("{id:int}/finalizar")]
    [RequirePermiso(Permisos.OrdenesAprobar)]
    public async Task<IActionResult> Finalizar(int id, CancellationToken ct)
    {
        await _svc.FinalizarAsync(id, ct);
        return NoContent();
    }

    [HttpPost("{id:int}/cancelar")]
    [RequirePermiso(Permisos.OrdenesAprobar)]
    public async Task<IActionResult> Cancelar(int id, [FromQuery] string motivo, CancellationToken ct)
    {
        await _svc.CancelarAsync(id, motivo, ct);
        return NoContent();
    }
}
