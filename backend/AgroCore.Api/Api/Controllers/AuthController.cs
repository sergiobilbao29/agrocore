using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AgroCore.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _auth;
    public AuthController(IAuthService auth) { _auth = auth; }

    /// <summary>Login con usuario/email + password. Devuelve access + refresh.</summary>
    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest req, CancellationToken ct)
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var ua = Request.Headers.UserAgent.ToString();
        return await _auth.LoginAsync(req, ip, ua, ct);
    }

    /// <summary>Rotación de refresh token.</summary>
    [AllowAnonymous]
    [HttpPost("refresh")]
    public async Task<ActionResult<LoginResponse>> Refresh([FromBody] RefreshRequest req, CancellationToken ct)
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var ua = Request.Headers.UserAgent.ToString();
        return await _auth.RefreshAsync(req, ip, ua, ct);
    }

    /// <summary>Revoca el refresh token para forzar nuevo login.</summary>
    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout([FromBody] RefreshRequest req, CancellationToken ct)
    {
        await _auth.LogoutAsync(req.RefreshToken, ct);
        return NoContent();
    }

    /// <summary>Cambio de contraseña del usuario autenticado.</summary>
    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest req, CancellationToken ct)
    {
        await _auth.ChangePasswordAsync(req, ct);
        return NoContent();
    }

    /// <summary>Cambia la empresa activa del usuario (reissue del JWT).</summary>
    [Authorize]
    [HttpPost("cambiar-empresa")]
    public async Task<ActionResult<LoginResponse>> CambiarEmpresa([FromBody] CambiarEmpresaRequest req, CancellationToken ct)
    {
        var deviceId = Request.Headers["X-Device-Id"].ToString();
        return await _auth.CambiarEmpresaAsync(req, deviceId, ct);
    }
}
