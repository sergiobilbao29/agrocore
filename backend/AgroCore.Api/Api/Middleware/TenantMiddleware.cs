using AgroCore.Infrastructure.Security;

namespace AgroCore.Api.Middleware;

/// <summary>
/// Garantiza que la empresa activa (X-Empresa-Id o claim emp) esté dentro de la lista
/// autorizada en el JWT. Si no, devuelve 403.
/// Endpoints marcados como [AllowAnonymous] o las rutas de auth se saltan.
/// </summary>
public class TenantMiddleware
{
    private static readonly string[] BypassPaths =
    {
        "/api/auth/login",
        "/api/auth/refresh",
        "/api/auth/logout",
        "/api/auth/ping",
        "/health",
        "/swagger"
    };

    private readonly RequestDelegate _next;
    public TenantMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx, ITenantContext tenant)
    {
        var path = ctx.Request.Path.Value ?? "";
        if (BypassPaths.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
        {
            await _next(ctx);
            return;
        }
        if (ctx.User.Identity?.IsAuthenticated != true)
        {
            await _next(ctx);
            return;
        }
        var empresaId = tenant.EmpresaId;
        if (empresaId is null)
        {
            ctx.Response.StatusCode = 400;
            await ctx.Response.WriteAsync("Falta cabecera X-Empresa-Id o claim empresa.");
            return;
        }
        if (!tenant.AccedeEmpresa(empresaId.Value))
        {
            ctx.Response.StatusCode = 403;
            await ctx.Response.WriteAsync("El usuario no tiene acceso a esta empresa.");
            return;
        }
        await _next(ctx);
    }
}
