using AgroCore.Domain.Entities;
using AgroCore.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Infrastructure.Security;

public interface ICurrentUserService
{
    Task<Usuario?> GetAsync(CancellationToken ct = default);
    int? UsuarioId { get; }
    int? EmpresaId { get; }
    int? GrupoId { get; }
}

public class CurrentUserService : ICurrentUserService
{
    private readonly ITenantContext _tenant;
    private readonly AgroCoreDbContext _db;

    public CurrentUserService(ITenantContext tenant, AgroCoreDbContext db)
    {
        _tenant = tenant;
        _db = db;
    }

    public int? UsuarioId => _tenant.UsuarioId;
    public int? EmpresaId => _tenant.EmpresaId;
    public int? GrupoId   => _tenant.GrupoId;

    public Task<Usuario?> GetAsync(CancellationToken ct = default)
    {
        if (!_tenant.UsuarioId.HasValue) return Task.FromResult<Usuario?>(null);
        return _db.Usuarios.FirstOrDefaultAsync(u => u.UsuarioId == _tenant.UsuarioId.Value, ct);
    }
}

public interface IPermissionService
{
    Task<IReadOnlyList<string>> GetPermisosAsync(int usuarioId, int empresaId, CancellationToken ct = default);
    Task<IReadOnlyList<string>> GetRolesAsync(int usuarioId, int empresaId, CancellationToken ct = default);
}

public class PermissionService : IPermissionService
{
    private readonly AgroCoreDbContext _db;
    public PermissionService(AgroCoreDbContext db) => _db = db;

    public async Task<IReadOnlyList<string>> GetPermisosAsync(int usuarioId, int empresaId, CancellationToken ct = default)
    {
        return await (from uer in _db.UsuarioEmpresaRoles
                      join rp in _db.RolPermisos on uer.RolId equals rp.RolId
                      join p  in _db.Permisos    on rp.PermisoId equals p.PermisoId
                      where uer.UsuarioId == usuarioId && uer.EmpresaId == empresaId
                      select p.Codigo)
                     .Distinct()
                     .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<string>> GetRolesAsync(int usuarioId, int empresaId, CancellationToken ct = default)
    {
        return await (from uer in _db.UsuarioEmpresaRoles
                      join r in _db.Roles on uer.RolId equals r.RolId
                      where uer.UsuarioId == usuarioId && uer.EmpresaId == empresaId
                      select r.Codigo)
                     .Distinct()
                     .ToListAsync(ct);
    }
}
