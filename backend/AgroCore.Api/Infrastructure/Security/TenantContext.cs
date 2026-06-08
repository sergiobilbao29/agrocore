using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace AgroCore.Infrastructure.Security;

public interface ITenantContext
{
    bool Aplicar { get; }
    int? UsuarioId { get; }
    int? GrupoId { get; }
    int? EmpresaId { get; }
    IReadOnlyList<int> EmpresasPermitidas { get; }
    IReadOnlyList<string> Permisos { get; }
    bool TienePermiso(string codigo);
    bool AccedeEmpresa(int empresaId);
    void SetPermisos(IEnumerable<string> codigos);
}

/// <summary>
/// Lee las claims del JWT + cabecera X-Empresa-Id para determinar el scope de la request.
/// Se inyecta en el DbContext para aplicar filtros multi-tenant automáticamente.
/// </summary>
public class TenantContext : ITenantContext
{
    private readonly IHttpContextAccessor _http;
    private List<string>? _permisosOverride;
    private bool _aplicarOverride = true;

    public TenantContext(IHttpContextAccessor http) => _http = http;

    public bool Aplicar
    {
        get
        {
            if (!_aplicarOverride) return false;
            var user = _http.HttpContext?.User;
            return user?.Identity?.IsAuthenticated == true;
        }
    }

    public int? UsuarioId => TryGetInt(AgroClaims.UsuarioId);
    public int? GrupoId   => TryGetInt(AgroClaims.GrupoId);

    public int? EmpresaId
    {
        get
        {
            var ctx = _http.HttpContext;
            if (ctx == null) return null;
            // 1) header X-Empresa-Id (permite conmutar empresa dentro del grupo)
            if (ctx.Request.Headers.TryGetValue("X-Empresa-Id", out var h) &&
                int.TryParse(h.ToString(), out var empHeader))
            {
                return empHeader;
            }
            // 2) claim por defecto
            return TryGetInt(AgroClaims.EmpresaId);
        }
    }

    public IReadOnlyList<int> EmpresasPermitidas
    {
        get
        {
            var ctx = _http.HttpContext;
            if (ctx?.User == null) return Array.Empty<int>();
            var claim = ctx.User.FindFirst(AgroClaims.Empresas)?.Value;
            if (string.IsNullOrWhiteSpace(claim)) return Array.Empty<int>();
            return claim.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                        .Select(s => int.TryParse(s, out var i) ? i : -1)
                        .Where(i => i > 0)
                        .ToArray();
        }
    }

    public IReadOnlyList<string> Permisos
    {
        get
        {
            if (_permisosOverride != null) return _permisosOverride;
            var user = _http.HttpContext?.User;
            if (user == null) return Array.Empty<string>();
            return user.FindAll(AgroClaims.Permission).Select(c => c.Value).ToArray();
        }
    }

    public void SetPermisos(IEnumerable<string> codigos) => _permisosOverride = codigos.ToList();
    public bool TienePermiso(string codigo) => Permisos.Contains(codigo, StringComparer.OrdinalIgnoreCase);
    public bool AccedeEmpresa(int empresaId) => EmpresasPermitidas.Contains(empresaId);

    private int? TryGetInt(string claimType)
    {
        var user = _http.HttpContext?.User;
        var v = user?.FindFirst(claimType)?.Value;
        return int.TryParse(v, out var i) ? i : null;
    }
}
