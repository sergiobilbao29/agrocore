using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

/// <summary>
/// Endpoints para la sincronización offline-first de la PWA.
///
/// Flujo típico del celular:
///   1) POST /api/sync/client  → obtiene SyncClientId (lo guarda en IndexedDB).
///   2) POST /api/sync/push    → envía la outbox de cambios locales, recibe resultados + cursor.
///   3) GET  /api/sync/pull    → recibe deltas desde el cursor conocido.
/// </summary>
[ApiController]
[Authorize]
[Route("api/sync")]
public class SyncController : ControllerBase
{
    private readonly ISyncService _svc;
    public SyncController(ISyncService svc) { _svc = svc; }

    /// <summary>Registra un nuevo cliente offline (un dispositivo por equipo).</summary>
    [HttpPost("client")]
    public async Task<ActionResult<SyncClientDto>> Registrar([FromBody] SyncClientRegisterDto dto, CancellationToken ct)
        => Ok(await _svc.RegistrarClienteAsync(dto, ct));

    /// <summary>Aplica los cambios que el cliente hizo sin conexión.</summary>
    [HttpPost("push")]
    public async Task<ActionResult<SyncPushResponse>> Push([FromBody] SyncPushRequest req, CancellationToken ct)
    {
        var resp = await _svc.PushAsync(req, ct);
        Response.Headers["X-Sync-Cursor"] = resp.NextCursorB64;
        return Ok(resp);
    }

    /// <summary>Devuelve los deltas del servidor desde el cursor indicado.</summary>
    [HttpGet("pull")]
    public async Task<ActionResult<SyncPullResponse>> Pull(
        [FromQuery] Guid clientId, [FromQuery] string? cursor = null, CancellationToken ct = default)
    {
        var resp = await _svc.PullAsync(clientId, cursor, ct);
        Response.Headers["X-Sync-Cursor"] = resp.NextCursorB64;
        return Ok(resp);
    }
}
