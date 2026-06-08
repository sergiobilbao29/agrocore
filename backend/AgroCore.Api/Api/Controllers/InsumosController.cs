using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/insumos")]
public class InsumosController : ControllerBase
{
    private readonly IInsumoService _svc;
    public InsumosController(IInsumoService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.InsumosRead)]
    public async Task<ActionResult<PagedResult<InsumoDto>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] string? q = null, [FromQuery] string? tipo = null,
        [FromQuery] bool bajoMinimo = false, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(page, pageSize, q, tipo, bajoMinimo, ct));

    [HttpGet("{id:int}")]
    [RequirePermiso(Permisos.InsumosRead)]
    public async Task<ActionResult<InsumoDto>> Obtener(int id, CancellationToken ct)
    {
        var i = await _svc.ObtenerAsync(id, ct);
        return i is null ? NotFound() : Ok(i);
    }

    [HttpPost]
    [RequirePermiso(Permisos.InsumosWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] InsumoCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));

    [HttpPut("{id:int}")]
    [RequirePermiso(Permisos.InsumosWrite)]
    public async Task<IActionResult> Actualizar(int id, [FromBody] InsumoUpdateDto dto, CancellationToken ct)
    {
        await _svc.ActualizarAsync(id, dto, ct);
        return NoContent();
    }

    [HttpGet("alertas")]
    [RequirePermiso(Permisos.InsumosRead)]
    public async Task<ActionResult<IReadOnlyList<InsumoDto>>> Alertas(CancellationToken ct)
        => Ok(await _svc.AlertasStockBajoAsync(ct));
}

[ApiController]
[Authorize]
[Route("api/compras")]
public class ComprasController : ControllerBase
{
    private readonly ICompraService _svc;
    public ComprasController(ICompraService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.ComprasRead)]
    public async Task<ActionResult<PagedResult<CompraInsumoDto>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] DateTime? desde = null, [FromQuery] DateTime? hasta = null,
        [FromQuery] int? proveedorId = null, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(page, pageSize, desde, hasta, proveedorId, ct));

    [HttpGet("{id:int}")]
    [RequirePermiso(Permisos.ComprasRead)]
    public async Task<ActionResult<CompraInsumoDto>> Obtener(int id, CancellationToken ct)
    {
        var c = await _svc.ObtenerAsync(id, ct);
        return c is null ? NotFound() : Ok(c);
    }

    [HttpPost]
    [RequirePermiso(Permisos.ComprasWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] CompraInsumoCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));
}
