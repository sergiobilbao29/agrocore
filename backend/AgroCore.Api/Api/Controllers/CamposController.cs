using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/campos")]
public class CamposController : ControllerBase
{
    private readonly ICampoService _svc;
    public CamposController(ICampoService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.CampoRead)]
    public async Task<ActionResult<IReadOnlyList<CampoDto>>> Listar(CancellationToken ct)
        => Ok(await _svc.ListarAsync(ct));

    [HttpGet("{id:int}")]
    [RequirePermiso(Permisos.CampoRead)]
    public async Task<ActionResult<CampoDto>> Obtener(int id, CancellationToken ct)
    {
        var c = await _svc.ObtenerAsync(id, ct);
        return c is null ? NotFound() : Ok(c);
    }

    [HttpPost]
    [RequirePermiso(Permisos.CampoWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] CampoCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));

    [HttpPut("{id:int}")]
    [RequirePermiso(Permisos.CampoWrite)]
    public async Task<IActionResult> Actualizar(int id, [FromBody] CampoUpdateDto dto, CancellationToken ct)
    {
        await _svc.ActualizarAsync(id, dto, ct);
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    [RequirePermiso(Permisos.CampoWrite)]
    public async Task<IActionResult> Eliminar(int id, CancellationToken ct)
    {
        await _svc.EliminarAsync(id, ct);
        return NoContent();
    }
}

[ApiController]
[Authorize]
[Route("api/lotes")]
public class LotesController : ControllerBase
{
    private readonly ILoteService _svc;
    public LotesController(ILoteService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.CampoRead)]
    public async Task<ActionResult<IReadOnlyList<LoteDto>>> Listar([FromQuery] int? campoId, CancellationToken ct)
        => Ok(await _svc.ListarAsync(campoId, ct));

    [HttpGet("{id:int}")]
    [RequirePermiso(Permisos.CampoRead)]
    public async Task<ActionResult<LoteDto>> Obtener(int id, CancellationToken ct)
    {
        var l = await _svc.ObtenerAsync(id, ct);
        return l is null ? NotFound() : Ok(l);
    }

    [HttpPost]
    [RequirePermiso(Permisos.LoteWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] LoteCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));

    [HttpPut("{id:int}")]
    [RequirePermiso(Permisos.LoteWrite)]
    public async Task<IActionResult> Actualizar(int id, [FromBody] LoteUpdateDto dto, CancellationToken ct)
    {
        await _svc.ActualizarAsync(id, dto, ct);
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    [RequirePermiso(Permisos.LoteWrite)]
    public async Task<IActionResult> Eliminar(int id, CancellationToken ct)
    {
        await _svc.EliminarAsync(id, ct);
        return NoContent();
    }
}

[ApiController]
[Authorize]
[Route("api/campanas")]
public class CampanasController : ControllerBase
{
    private readonly ICampanaService _svc;
    public CampanasController(ICampanaService svc) { _svc = svc; }

    [HttpGet]
    [RequirePermiso(Permisos.CampoRead)]
    public async Task<ActionResult<PagedResult<CampanaDto>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        [FromQuery] int? loteId = null, [FromQuery] string? estado = null, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(page, pageSize, loteId, estado, ct));

    [HttpGet("{id:int}")]
    [RequirePermiso(Permisos.CampoRead)]
    public async Task<ActionResult<CampanaDto>> Obtener(int id, CancellationToken ct)
    {
        var c = await _svc.ObtenerAsync(id, ct);
        return c is null ? NotFound() : Ok(c);
    }

    [HttpPost]
    [RequirePermiso(Permisos.CampanaWrite)]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] CampanaCreateDto dto, CancellationToken ct)
        => Ok(new IdResponse(await _svc.CrearAsync(dto, ct)));

    [HttpPut("{id:int}")]
    [RequirePermiso(Permisos.CampanaWrite)]
    public async Task<IActionResult> Actualizar(int id, [FromBody] CampanaUpdateDto dto, CancellationToken ct)
    {
        await _svc.ActualizarAsync(id, dto, ct);
        return NoContent();
    }

    [HttpPost("{id:int}/cerrar")]
    [RequirePermiso(Permisos.CampanaWrite)]
    public async Task<IActionResult> Cerrar(int id, CancellationToken ct)
    {
        await _svc.CerrarAsync(id, ct);
        return NoContent();
    }

    [HttpGet("{id:int}/margen-bruto")]
    [RequirePermiso(Permisos.AnalyticsRead)]
    public async Task<ActionResult<MargenBrutoDto>> MargenBruto(int id, CancellationToken ct)
    {
        var mb = await _svc.MargenBrutoAsync(id, ct);
        return mb is null ? NotFound() : Ok(mb);
    }
}
