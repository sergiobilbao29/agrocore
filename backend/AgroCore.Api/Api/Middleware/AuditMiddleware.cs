using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Security;

namespace AgroCore.Api.Middleware;

/// <summary>
/// Audita mutaciones (POST/PUT/PATCH/DELETE) a endpoints de negocio.
/// La auditoría fina por entidad se hace dentro de cada Service con IAuditService.
/// Aquí sólo dejamos rastro del endpoint tocado.
/// </summary>
public class AuditMiddleware
{
    private static readonly string[] MutationMethods = { "POST", "PUT", "PATCH", "DELETE" };
    private readonly RequestDelegate _next;

    public AuditMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx, ITenantContext tenant, IAuditService audit)
    {
        await _next(ctx);
        try
        {
            if (!MutationMethods.Contains(ctx.Request.Method)) return;
            if (ctx.User.Identity?.IsAuthenticated != true) return;
            if (ctx.Response.StatusCode >= 400) return;

            await audit.LogEndpointAsync(
                grupoId: tenant.GrupoId ?? 0,
                empresaId: tenant.EmpresaId,
                usuarioId: tenant.UsuarioId,
                path: ctx.Request.Path.Value ?? "",
                method: ctx.Request.Method,
                ip: ctx.Connection.RemoteIpAddress?.ToString(),
                userAgent: ctx.Request.Headers.UserAgent.ToString());
        }
        catch { /* nunca romper la request por la bitácora */ }
    }
}
