using Serilog.Context;

namespace AgroCore.Api.Middleware;

public class CorrelationIdMiddleware
{
    private const string Header = "X-Correlation-Id";
    private readonly RequestDelegate _next;
    public CorrelationIdMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx)
    {
        var id = ctx.Request.Headers.TryGetValue(Header, out var v) && !string.IsNullOrEmpty(v)
            ? v.ToString()
            : Guid.NewGuid().ToString("N");
        ctx.Response.Headers[Header] = id;
        using (LogContext.PushProperty("CorrelationId", id))
        {
            await _next(ctx);
        }
    }
}
