using AgroCore.Api.Middleware;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Domain.Entities;
using AgroCore.Infrastructure.Persistence;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AgroCore.Application.Services;

public class AuthService : IAuthService
{
    private readonly AgroCoreDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly IJwtTokenService _jwt;
    private readonly IPermissionService _perms;
    private readonly ITenantContext _tenant;
    private readonly SecurityOptions _sec;
    private readonly ILogger<AuthService> _log;

    public AuthService(
        AgroCoreDbContext db,
        IPasswordHasher hasher,
        IJwtTokenService jwt,
        IPermissionService perms,
        ITenantContext tenant,
        IOptions<SecurityOptions> secOpts,
        ILogger<AuthService> log)
    {
        _db = db; _hasher = hasher; _jwt = jwt; _perms = perms; _tenant = tenant;
        _sec = secOpts.Value; _log = log;
    }

    public async Task<LoginResponse> LoginAsync(LoginRequest req, string? ip, string? userAgent, CancellationToken ct)
    {
        // IgnoreQueryFilters para poder loguear con cualquier grupo.
        var u = await _db.Usuarios.IgnoreQueryFilters()
            .FirstOrDefaultAsync(x =>
                (x.Username == req.UsernameOrEmail || x.Email == req.UsernameOrEmail) &&
                x.DeletedAt == null, ct)
            ?? throw ApiException.Unauthorized("Usuario o contraseña incorrectos.");

        if (!u.Activo) throw ApiException.Unauthorized("Usuario inactivo.");
        if (u.BloqueadoHasta.HasValue && u.BloqueadoHasta.Value > DateTime.UtcNow)
            throw ApiException.Unauthorized($"Cuenta bloqueada hasta {u.BloqueadoHasta:yyyy-MM-dd HH:mm} UTC.");

        if (!_hasher.Verify(req.Password, u.PasswordHash, u.PasswordSalt))
        {
            u.IntentosFallidos++;
            if (u.IntentosFallidos >= _sec.MaxFailedLoginAttempts)
            {
                u.BloqueadoHasta = DateTime.UtcNow.AddMinutes(_sec.LockoutMinutes);
                u.IntentosFallidos = 0;
            }
            await _db.SaveChangesAsync(ct);
            _log.LogWarning("Login fallido para {User} desde {Ip}", req.UsernameOrEmail, ip);
            throw ApiException.Unauthorized("Usuario o contraseña incorrectos.");
        }

        u.IntentosFallidos = 0;
        u.BloqueadoHasta = null;
        u.UltimoLoginAt = DateTime.UtcNow;

        // Cargar empresas asignadas
        var asignaciones = await _db.UsuarioEmpresaRoles
            .IgnoreQueryFilters()
            .Include(uer => uer.Empresa)
            .Where(uer => uer.UsuarioId == u.UsuarioId)
            .ToListAsync(ct);

        var empresasIds = asignaciones.Select(a => a.EmpresaId).Distinct().ToList();
        if (empresasIds.Count == 0)
            throw ApiException.Forbidden("El usuario no tiene empresas asignadas.");

        var empresaActiva = req.EmpresaId.HasValue && empresasIds.Contains(req.EmpresaId.Value)
            ? req.EmpresaId.Value
            : empresasIds.First();

        return await EmitirRespuestaAsync(u, empresaActiva, empresasIds, asignaciones, req.DeviceId, ip, userAgent, ct);
    }

    public async Task<LoginResponse> RefreshAsync(RefreshRequest req, string? ip, string? userAgent, CancellationToken ct)
    {
        var hash = _jwt.HashRefresh(req.RefreshToken);
        var rt = await _db.RefreshTokens.IgnoreQueryFilters()
            .Include(x => x.Usuario)
            .FirstOrDefaultAsync(x => x.TokenHash == hash, ct)
            ?? throw ApiException.Unauthorized("Refresh token inválido.");

        if (rt.RevocadoAt.HasValue) throw ApiException.Unauthorized("Refresh token revocado.");
        if (rt.ExpiraAt < DateTime.UtcNow) throw ApiException.Unauthorized("Refresh token expirado.");

        var u = rt.Usuario;
        if (!u.Activo) throw ApiException.Unauthorized("Usuario inactivo.");

        // Rotación: revocar el anterior
        rt.RevocadoAt = DateTime.UtcNow;

        var asignaciones = await _db.UsuarioEmpresaRoles.IgnoreQueryFilters()
            .Include(a => a.Empresa)
            .Where(a => a.UsuarioId == u.UsuarioId)
            .ToListAsync(ct);

        var empresasIds = asignaciones.Select(a => a.EmpresaId).Distinct().ToList();
        var empresaActiva = req.EmpresaId.HasValue && empresasIds.Contains(req.EmpresaId.Value)
            ? req.EmpresaId.Value : empresasIds.First();

        return await EmitirRespuestaAsync(u, empresaActiva, empresasIds, asignaciones, null, ip, userAgent, ct);
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken ct)
    {
        var hash = _jwt.HashRefresh(refreshToken);
        var rt = await _db.RefreshTokens.IgnoreQueryFilters()
            .FirstOrDefaultAsync(x => x.TokenHash == hash, ct);
        if (rt != null && rt.RevocadoAt == null)
        {
            rt.RevocadoAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
    }

    public async Task ChangePasswordAsync(ChangePasswordRequest req, CancellationToken ct)
    {
        if (req.PasswordNueva.Length < _sec.PasswordMinLength)
            throw ApiException.BadRequest($"La contraseña debe tener al menos {_sec.PasswordMinLength} caracteres.");

        var uid = _tenant.UsuarioId ?? throw ApiException.Unauthorized("No autenticado.");
        var u = await _db.Usuarios.IgnoreQueryFilters().FirstAsync(x => x.UsuarioId == uid, ct);
        if (!_hasher.Verify(req.PasswordActual, u.PasswordHash, u.PasswordSalt))
            throw ApiException.BadRequest("La contraseña actual es incorrecta.");
        (u.PasswordHash, u.PasswordSalt) = _hasher.Hash(req.PasswordNueva);
        await _db.SaveChangesAsync(ct);
    }

    public async Task<LoginResponse> CambiarEmpresaAsync(CambiarEmpresaRequest req, string? deviceId, CancellationToken ct)
    {
        var uid = _tenant.UsuarioId ?? throw ApiException.Unauthorized("No autenticado.");
        var u = await _db.Usuarios.IgnoreQueryFilters().FirstAsync(x => x.UsuarioId == uid, ct);
        var asignaciones = await _db.UsuarioEmpresaRoles.IgnoreQueryFilters()
            .Include(a => a.Empresa)
            .Where(a => a.UsuarioId == uid)
            .ToListAsync(ct);

        var empresasIds = asignaciones.Select(a => a.EmpresaId).Distinct().ToList();
        if (!empresasIds.Contains(req.EmpresaId))
            throw ApiException.Forbidden("El usuario no tiene acceso a esa empresa.");

        return await EmitirRespuestaAsync(u, req.EmpresaId, empresasIds, asignaciones, deviceId, null, null, ct);
    }

    private async Task<LoginResponse> EmitirRespuestaAsync(
        Usuario u, int empresaActiva, List<int> empresasIds,
        List<UsuarioEmpresaRol> asignaciones, string? deviceId,
        string? ip, string? userAgent, CancellationToken ct)
    {
        var roles = await _perms.GetRolesAsync(u.UsuarioId, empresaActiva, ct);
        var permisos = await _perms.GetPermisosAsync(u.UsuarioId, empresaActiva, ct);

        var emitido = _jwt.Issue(u, empresaActiva, empresasIds, roles, permisos, deviceId);

        _db.RefreshTokens.Add(new RefreshToken
        {
            UsuarioId = u.UsuarioId,
            TokenHash = _jwt.HashRefresh(emitido.RefreshToken),
            DeviceInfo = deviceId ?? userAgent,
            ExpiraAt = emitido.RefreshExpiresAt
        });
        await _db.SaveChangesAsync(ct);

        var empresasResumen = asignaciones
            .Select(a => a.Empresa)
            .DistinctBy(e => e.EmpresaId)
            .Select(e => new EmpresaResumen(e.EmpresaId, e.RazonSocial, e.Cuit, e.EsPyme, e.CondicionIva))
            .ToList();

        return new LoginResponse(
            emitido.AccessToken,
            emitido.AccessExpiresAt,
            emitido.RefreshToken,
            emitido.RefreshExpiresAt,
            new UsuarioResumen(u.UsuarioId, u.Username, u.NombreCompleto, u.Email),
            empresasResumen,
            roles.ToList(),
            permisos.ToList(),
            empresaActiva);
    }
}
