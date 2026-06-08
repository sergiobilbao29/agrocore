using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/stock-grano")]
public class StockGranoController : ControllerBase
{
    private readonly IStockGranoService _svc;
    public StockGranoController(IStockGranoService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.GranosRead)]
    public async Task<ActionResult<IReadOnlyList<StockGranoDto>>> Stock(CancellationToken ct)
        => Ok(await _svc.StockActualAsync(ct));

    [HttpPost("movimientos")]
    [RequirePermiso(Permisos.GranosWrite)]
    public async Task<ActionResult<IdResponse>> Registrar([FromBody] MovimientoGranoCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.RegistrarMovimientoAsync(dto, ct)));
}

[ApiController]
[Authorize]
[Route("api/hacienda")]
public class HaciendaController : ControllerBase
{
    private readonly IHaciendaService _svc;
    public HaciendaController(IHaciendaService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.HaciendaRead)]
    public async Task<ActionResult<PagedResult<HaciendaDto>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] string? categoria = null, [FromQuery] string? estado = null, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(page, pageSize, categoria, estado, ct));

    [HttpPost("movimientos")]
    [RequirePermiso(Permisos.HaciendaWrite)]
    public async Task<ActionResult<IdResponse>> Registrar([FromBody] MovimientoHaciendaCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.RegistrarMovimientoAsync(dto, ct)));
}

[ApiController]
[Authorize]
[Route("api/ventas")]
public class VentasController : ControllerBase
{
    private readonly IVentaService _svc;
    public VentasController(IVentaService svc) { _svc = svc; }

    [HttpPost("granos")]
    [RequirePermiso(Permisos.VentasWrite)]
    public async Task<ActionResult<IdResponse>> Granos([FromBody] VentaGranoCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearVentaGranoAsync(dto, ct)));

    [HttpPost("hacienda")]
    [RequirePermiso(Permisos.VentasWrite)]
    public async Task<ActionResult<IdResponse>> Hacienda([FromBody] VentaHaciendaCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearVentaHaciendaAsync(dto, ct)));

    [HttpPost("pyme")]
    [RequirePermiso(Permisos.VentasWrite)]
    public async Task<ActionResult<IdResponse>> Pyme([FromBody] VentaPymeCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearVentaPymeAsync(dto, ct)));
}
