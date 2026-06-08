using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Api.Middleware;

public class ApiException : Exception
{
    public int StatusCode { get; }
    public ApiException(int statusCode, string message) : base(message) => StatusCode = statusCode;
    public static ApiException BadRequest(string msg)     => new(400, msg);
    public static ApiException Unauthorized(string msg)   => new(401, msg);
    public static ApiException Forbidden(string msg)      => new(403, msg);
    public static ApiException NotFound(string msg)       => new(404, msg);
    public static ApiException Conflict(string msg)       => new(409, msg);
    public static ApiException Precondition(string msg)   => new(412, msg);
}

public class ExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionMiddleware> _log;

    public ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> log)
    {
        _next = next;
        _log = log;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        try
        {
            await _next(ctx);
        }
        catch (ApiException apiEx)
        {
            await Write(ctx, apiEx.StatusCode, apiEx.Message, null);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            _log.LogWarning(ex, "Conflicto de concurrencia");
            await Write(ctx, 409, "El registro fue modificado por otro usuario. Recargá e intentá de nuevo.", null);
        }
        catch (UnauthorizedAccessException ex)
        {
            await Write(ctx, 401, ex.Message, null);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Error no controlado");
            await Write(ctx, 500, "Error interno. Se registró el incidente.", null);
        }
    }

    private static async Task Write(HttpContext ctx, int status, string msg, object? detail)
    {
        if (ctx.Response.HasStarted) return;
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/problem+json";
        var payload = new
        {
            type   = $"https://httpstatuses.io/{status}",
            title  = msg,
            status,
            detail,
            traceId = ctx.TraceIdentifier
        };
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(payload));
    }
}
