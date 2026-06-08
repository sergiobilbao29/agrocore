using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace AgroCore.Api.Middleware;

/// <summary>
/// Unifica la salida de validaciones: siempre Problem Details con errores en 'errors'.
/// </summary>
public class ValidationFilter : IActionFilter
{
    public void OnActionExecuting(ActionExecutingContext ctx)
    {
        if (!ctx.ModelState.IsValid)
        {
            var errors = ctx.ModelState
                .Where(kv => kv.Value!.Errors.Count > 0)
                .ToDictionary(kv => kv.Key, kv => kv.Value!.Errors.Select(e => e.ErrorMessage).ToArray());

            ctx.Result = new BadRequestObjectResult(new
            {
                title = "Validación fallida",
                status = 400,
                errors,
                traceId = ctx.HttpContext.TraceIdentifier
            });
        }
    }

    public void OnActionExecuted(ActionExecutedContext ctx) { }
}
