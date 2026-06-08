using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/empresas")]
public class EmpresasController : ControllerBase
{
    private readonly IEmpresaService _svc;
    public EmpresasController(IEmpresaService svc) { _svc = svc; }

    [HttpGet("mis-empresas")]
    public async Task<ActionResult<IReadOnlyList<EmpresaResumen>>> MisEmpresas(CancellationToken ct)
        => Ok(await _svc.ListarMisEmpresasAsync(ct));
}

[ApiController]
[Authorize]
[Route("api/usuarios")]
public class UsuariosController : ControllerBase
{
    private readonly IUsuarioService _svc;
    public UsuariosController(IUsuarioService svc) { _svc = svc; }

    [HttpGet]
    public async Task<ActionResult<PagedResult<UsuarioResumen>>> Listar(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, [FromQuery] string? q = null, CancellationToken ct = default)
        => Ok(await _svc.ListarAsync(page, pageSize, q, ct));

    [HttpPost]
    public async Task<ActionResult<IdResponse>> Crear([FromBody] CrearUsuarioRequest req, CancellationToken ct)
    {
        var id = await _svc.CrearAsync(req, ct);
        return CreatedAtAction(nameof(Listar), new IdResponse(id));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Actualizar(int id, [FromBody] EditarUsuarioRequest req, CancellationToken ct)
    {
        await _svc.ActualizarAsync(id, req, ct);
        return NoContent();
    }

    [HttpPost("{id:int}/activar")]
    public async Task<IActionResult> Activar(int id, [FromQuery] bool activo, CancellationToken ct)
    {
        await _svc.ActivarAsync(id, activo, ct);
        return NoContent();
    }

    [HttpPost("{id:int}/roles")]
    public async Task<IActionResult> Roles(int id, [FromBody] List<AsignacionRol> roles, CancellationToken ct)
    {
        await _svc.AsignarRolesAsync(id, roles, ct);
        return NoContent();
    }
}
