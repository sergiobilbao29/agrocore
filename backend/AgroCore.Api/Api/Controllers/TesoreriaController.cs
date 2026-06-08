using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/tesoreria")]
public class TesoreriaController : ControllerBase
{
    private readonly ITesoreriaService _svc;
    public TesoreriaController(ITesoreriaService svc) { _svc = svc; }

    [HttpGet("movimientos")]
    [RequirePermiso(Permisos.TesoreriaRead)]
    public async Task<ActionResult<PagedResult<MovimientoCajaDto>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] DateTime? desde = null, [FromQuery] DateTime? hasta = null,
        [FromQuery] string? tipo = null, [FromQuery] byte? monedaId = null, CancellationToken ct = default)
        => Ok(await _svc.ListarMovimientosAsync(page, pageSize, desde, hasta, tipo, monedaId, ct));

    [HttpPost("movimientos")]
    [RequirePermiso(Permisos.TesoreriaWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] MovimientoCajaCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearMovimientoAsync(dto, ct)));

    [HttpGet("saldos")]
    [RequirePermiso(Permisos.TesoreriaRead)]
    public async Task<ActionResult<decimal[]>> Saldos(CancellationToken ct)
        => Ok(await _svc.SaldosAsync(ct));

    [HttpGet("flujo-fondos")]
    [RequirePermiso(Permisos.TesoreriaRead)]
    public async Task<ActionResult<object>> FlujoFondos([FromQuery] DateTime desde, [FromQuery] DateTime hasta, CancellationToken ct)
        => Ok(await _svc.FlujoFondosAsync(desde, hasta, ct));
}

[ApiController]
[Authorize]
[Route("api/cheques")]
public class ChequesController : ControllerBase
{
    private readonly IChequeService _svc;
    public ChequesController(IChequeService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.TesoreriaRead)]
    public async Task<ActionResult<PagedResult<ChequeDto>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] string? tipo = null, [FromQuery] string? estado = null,
        [FromQuery] DateTime? vtoDesde = null, [FromQuery] DateTime? vtoHasta = null, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(page, pageSize, tipo, estado, vtoDesde, vtoHasta, ct));

    [HttpPost]
    [RequirePermiso(Permisos.ChequesWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] ChequeCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));

    [HttpPost("{id:int}/estado")]
    [RequirePermiso(Permisos.ChequesWrite)]
    public async Task<IActionResult> CambiarEstado(int id, [FromBody] ChequeCambioEstadoDto dto, CancellationToken ct)
    {
        await _svc.CambiarEstadoAsync(id, dto, ct);
        return NoContent();
    }
}

[ApiController]
[Authorize]
[Route("api/cuentas-corrientes")]
public class CuentasCorrientesController : ControllerBase
{
    private readonly ICuentaCorrienteService _svc;
    public CuentasCorrientesController(ICuentaCorrienteService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.CuentasRead)]
    public async Task<ActionResult<IReadOnlyList<CuentaCorrienteDto>>> Listar([FromQuery] string? tipo, CancellationToken ct)
        => Ok(await _svc.ListarAsync(tipo, ct));

    [HttpGet("{id:int}/movimientos")]
    [RequirePermiso(Permisos.CuentasRead)]
    public async Task<ActionResult<IReadOnlyList<CuentaMovimientoDto>>> Movimientos(
        int id, [FromQuery] DateTime? desde = null, [FromQuery] DateTime? hasta = null, CancellationToken ct = default)
        => Ok(await _svc.MovimientosAsync(id, desde, hasta, ct));

    [HttpPost("movimientos")]
    [RequirePermiso(Permisos.CuentasWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] CuentaMovimientoCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearMovimientoAsync(dto, ct)));
}
