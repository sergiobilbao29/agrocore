using Microsoft.AspNetCore.Authorization;

namespace AgroCore.Infrastructure.Security;

/// <summary>
/// Catálogo centralizado de códigos de permisos. Igual que en la tabla dbo.Permiso.
/// </summary>
public static class Permisos
{
    // Seguridad
    public const string UsuariosRead    = "seguridad:usuarios:read";
    public const string UsuariosWrite   = "seguridad:usuarios:write";
    public const string RolesWrite      = "seguridad:roles:write";
    public const string EmpresasWrite   = "seguridad:empresas:write";
    public const string AuditoriaRead   = "seguridad:auditoria:read";

    // Producción
    public const string CampoRead       = "campo:read";
    public const string CampoWrite      = "campo:write";
    public const string LoteWrite       = "lote:write";
    public const string CampanaWrite    = "campana:write";

    // Stock / Insumos
    public const string InsumosRead     = "insumos:read";
    public const string InsumosWrite    = "insumos:write";
    public const string ComprasRead     = "compras:read";
    public const string ComprasWrite    = "compras:write";

    // Órdenes de trabajo
    public const string OrdenesRead     = "ordenes:read";
    public const string OrdenesWrite    = "ordenes:write";
    public const string OrdenesAprobar  = "ordenes:approve";

    // Ventas
    public const string VentasRead      = "ventas:read";
    public const string VentasWrite     = "ventas:write";

    // Grano / Hacienda
    public const string GranosRead      = "granos:read";
    public const string GranosWrite     = "granos:write";
    public const string HaciendaRead    = "hacienda:read";
    public const string HaciendaWrite   = "hacienda:write";

    // Tesorería
    public const string TesoreriaRead   = "tesoreria:read";
    public const string TesoreriaWrite  = "tesoreria:write";
    public const string ChequesWrite    = "tesoreria:cheques:write";
    public const string CuentasRead     = "tesoreria:ctacte:read";
    public const string CuentasWrite    = "tesoreria:ctacte:write";

    // Contratos / RRHH
    public const string ContratosWrite  = "contratos:write";
    public const string EmpleadosRead   = "empleados:read";
    public const string EmpleadosWrite  = "empleados:write";

    // Transporte
    public const string ViajesRead      = "viajes:read";
    public const string ViajesWrite     = "viajes:write";

    // Comprobantes / ARCA
    public const string ComprobantesRead  = "comprobantes:read";
    public const string ComprobantesWrite = "comprobantes:write";
    public const string ComprobantesArca  = "comprobantes:arca";

    // Dashboard / análisis
    public const string DashboardRead   = "dashboard:read";
    public const string AnalyticsRead   = "analytics:read";
}

public static class AuthorizationPolicies
{
    public static void Configure(AuthorizationOptions o)
    {
        foreach (var field in typeof(Permisos).GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static))
        {
            if (field.GetValue(null) is string code)
            {
                o.AddPolicy(code, b => b.RequireClaim(AgroClaims.Permission, code));
            }
        }
        // Rol SuperAdmin bypass
        o.AddPolicy("SuperAdmin", b => b.RequireClaim(AgroClaims.Role, "SUPERADMIN"));
    }
}

/// <summary>Sugar atributo: [RequirePermiso(Permisos.OrdenesWrite)].</summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public class RequirePermisoAttribute : Microsoft.AspNetCore.Authorization.AuthorizeAttribute
{
    public RequirePermisoAttribute(string permiso) { Policy = permiso; }
}
