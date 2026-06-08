using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/contratos")]
public class ContratosController : ControllerBase
{
    private readonly IContratoService _svc;
    public ContratosController(IContratoService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.ContratosWrite)]
    public async Task<ActionResult<IReadOnlyList<ContratoDto>>> Listar([FromQuery] bool soloActivos = true, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(soloActivos, ct));

    [HttpPost]
    [RequirePermiso(Permisos.ContratosWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] ContratoCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));
}

[ApiController]
[Authorize]
[Route("api/empleados")]
public class EmpleadosController : ControllerBase
{
    private readonly IEmpleadoService _svc;
    public EmpleadosController(IEmpleadoService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.EmpleadosRead)]
    public async Task<ActionResult<IReadOnlyList<EmpleadoDto>>> Listar([FromQuery] bool soloActivos = true, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(soloActivos, ct));

    [HttpPost]
    [RequirePermiso(Permisos.EmpleadosWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] EmpleadoCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));
}

[ApiController]
[Authorize]
[Route("api/viajes")]
public class ViajesController : ControllerBase
{
    private readonly IViajeCamionService _svc;
    public ViajesController(IViajeCamionService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.ViajesRead)]
    public async Task<ActionResult<PagedResult<ViajeCamionDto>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] DateTime? desde = null, [FromQuery] DateTime? hasta = null,
        [FromQuery] string? estado = null, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(page, pageSize, desde, hasta, estado, ct));

    [HttpPost]
    [RequirePermiso(Permisos.ViajesWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] ViajeCamionCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));

    [HttpPost("{id:int}/estado")]
    [RequirePermiso(Permisos.ViajesWrite)]
    public async Task<IActionResult> CambiarEstado(int id,
        [FromQuery] string estado, [FromQuery] decimal? kgDestino = null,
        [FromQuery] decimal? merma = null, CancellationToken ct = default)
    {
        await _svc.CambiarEstadoAsync(id, estado, kgDestino, merma, ct);
        return NoContent();
    }
}
