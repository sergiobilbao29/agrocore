using System.Text;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using AgroCore.Api.Middleware;
using AgroCore.Application.Mapping;
using AgroCore.Application.Services;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Persistence;
using AgroCore.Infrastructure.Security;
using AgroCore.Infrastructure.Sync;
using Microsoft.Extensions.Hosting;
using FluentValidation;
using FluentValidation.AspNetCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// ------------------------------------------------------------------------
// Serilog
// ------------------------------------------------------------------------
builder.Host.UseSerilog((ctx, services, cfg) =>
    cfg.ReadFrom.Configuration(ctx.Configuration)
       .ReadFrom.Services(services)
       .Enrich.FromLogContext());

// ------------------------------------------------------------------------
// Configuración tipada
// ------------------------------------------------------------------------
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.Configure<SecurityOptions>(builder.Configuration.GetSection("Security"));
builder.Services.Configure<SyncOptions>(builder.Configuration.GetSection("Sync"));

// ------------------------------------------------------------------------
// DbContext (SQL Server) con retry transitorio
// ------------------------------------------------------------------------
builder.Services.AddDbContext<AgroCoreDbContext>((sp, opts) =>
{
    var cs = builder.Configuration.GetConnectionString("AgroCore");
    opts.UseSqlServer(cs, sql =>
    {
        sql.MigrationsAssembly(typeof(AgroCoreDbContext).Assembly.FullName);
        sql.CommandTimeout(60);
        sql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10), errorNumbersToAdd: null);
    });
    if (builder.Environment.IsDevelopment())
    {
        opts.EnableSensitiveDataLogging();
        opts.EnableDetailedErrors();
    }
});

// ------------------------------------------------------------------------
// Seguridad / JWT
// ------------------------------------------------------------------------
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()!;
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
        o.SaveToken = true;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SecretKey)),
            ClockSkew = TimeSpan.FromSeconds(jwt.ClockSkewSeconds),
            NameClaimType = AgroClaims.UsuarioId,
            RoleClaimType = AgroClaims.Role
        };
    });

builder.Services.AddAuthorization(AuthorizationPolicies.Configure);

builder.Services.AddScoped<ITenantContext, TenantContext>();
builder.Services.AddScoped<IPasswordHasher, BcryptPasswordHasher>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<ICurrentUserService, CurrentUserService>();
builder.Services.AddScoped<IPermissionService, PermissionService>();

// ------------------------------------------------------------------------
// Servicios de aplicación
// ------------------------------------------------------------------------
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IEmpresaService, EmpresaService>();
builder.Services.AddScoped<IUsuarioService, UsuarioService>();
builder.Services.AddScoped<ICampoService, CampoService>();
builder.Services.AddScoped<ILoteService, LoteService>();
builder.Services.AddScoped<ICampanaService, CampanaService>();
builder.Services.AddScoped<IInsumoService, InsumoService>();
builder.Services.AddScoped<ICompraService, CompraService>();
builder.Services.AddScoped<IOrdenTrabajoService, OrdenTrabajoService>();
builder.Services.AddScoped<IStockGranoService, StockGranoService>();
builder.Services.AddScoped<IHaciendaService, HaciendaService>();
builder.Services.AddScoped<IVentaService, VentaService>();
builder.Services.AddScoped<ITesoreriaService, TesoreriaService>();
builder.Services.AddScoped<IChequeService, ChequeService>();
builder.Services.AddScoped<ICuentaCorrienteService, CuentaCorrienteService>();
builder.Services.AddScoped<IContratoService, ContratoService>();
builder.Services.AddScoped<IViajeCamionService, ViajeCamionService>();
builder.Services.AddScoped<IEmpleadoService, EmpleadoService>();
builder.Services.AddScoped<IComprobanteService, ComprobanteService>();
builder.Services.AddScoped<IAdjuntoService, AdjuntoService>();
builder.Services.AddScoped<IDashboardService, DashboardService>();
builder.Services.AddScoped<IMargenBrutoService, MargenBrutoService>();
builder.Services.AddScoped<ISyncService, SyncService>();
builder.Services.AddScoped<IAuditService, AuditService>();
builder.Services.AddScoped<ICotizacionesService, CotizacionesService>();

// HttpClient usado por CotizacionesService (BCR + DolarApi)
builder.Services.AddHttpClient("cotizaciones", c =>
{
    c.DefaultRequestHeaders.UserAgent.ParseAdd("AgroCore/1.0 (+https://agrocore.ar)");
    c.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/json;q=0.9,*/*;q=0.8");
});

// AutoMapper + FluentValidation
builder.Services.AddAutoMapper(typeof(MappingProfile).Assembly);
builder.Services.AddValidatorsFromAssembly(typeof(MappingProfile).Assembly);
builder.Services.AddFluentValidationAutoValidation();
builder.Services.AddFluentValidationClientsideAdapters();

// ------------------------------------------------------------------------
// MVC + JSON
// ------------------------------------------------------------------------
builder.Services.AddControllers(opts =>
{
    opts.Filters.Add<ValidationFilter>();
})
.AddJsonOptions(opts =>
{
    opts.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    opts.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    opts.JsonSerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddHttpContextAccessor();
builder.Services.AddMemoryCache();

// ------------------------------------------------------------------------
// CORS (permite PWA online + offline)
// ------------------------------------------------------------------------
var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
builder.Services.AddCors(opts =>
{
    opts.AddPolicy("AgroCorePwa", p => p
        .WithOrigins(origins)
        .AllowAnyMethod()
        .AllowAnyHeader()
        .AllowCredentials()
        .WithExposedHeaders("X-RowVersion", "X-Sync-Cursor", "X-Total-Count"));
});

// ------------------------------------------------------------------------
// Rate limiting
// ------------------------------------------------------------------------
var rl = builder.Configuration.GetSection("RateLimit");
builder.Services.AddRateLimiter(opts =>
{
    opts.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.User?.Identity?.Name ?? httpContext.Connection.RemoteIpAddress?.ToString() ?? "anon",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = rl.GetValue<int>("PermitLimit", 120),
                Window = TimeSpan.FromSeconds(rl.GetValue<int>("WindowSeconds", 60)),
                QueueLimit = rl.GetValue<int>("QueueLimit", 20),
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst
            }));
    opts.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
});

// ------------------------------------------------------------------------
// Swagger
// ------------------------------------------------------------------------
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "AgroCore API",
        Version = "v1",
        Description = "API de gestión agropecuaria — multi-empresa, multi-usuario, offline-first",
        Contact = new OpenApiContact { Name = "AgroCore", Email = "soporte@agrocore.ar" }
    });
    var jwtScheme = new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Ingresá: Bearer {token}",
        Reference = new OpenApiReference { Id = JwtBearerDefaults.AuthenticationScheme, Type = ReferenceType.SecurityScheme }
    };
    c.AddSecurityDefinition(jwtScheme.Reference.Id, jwtScheme);
    c.AddSecurityRequirement(new OpenApiSecurityRequirement { { jwtScheme, Array.Empty<string>() } });
});

// ------------------------------------------------------------------------
// Health checks
// ------------------------------------------------------------------------
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AgroCoreDbContext>("sqlserver");

// ========================================================================
// PIPELINE
// ========================================================================
var app = builder.Build();

app.UseSerilogRequestLogging();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "AgroCore API v1");
        c.DocumentTitle = "AgroCore API";
    });
}
else
{
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseCors("AgroCorePwa");

app.UseMiddleware<ExceptionMiddleware>();
app.UseMiddleware<CorrelationIdMiddleware>();

app.UseAuthentication();
app.UseMiddleware<TenantMiddleware>();   // resuelve X-Empresa-Id
app.UseAuthorization();

app.UseRateLimiter();

app.UseMiddleware<AuditMiddleware>();    // bitácora post-autenticación

app.MapControllers();
app.MapHealthChecks("/health");

// Seed inicial (permisos, monedas, comprobante tipos, grupo/usuario demo)
using (var scope = app.Services.CreateScope())
{
    var env = scope.ServiceProvider.GetRequiredService<IWebHostEnvironment>();
    if (env.IsDevelopment())
    {
        var db = scope.ServiceProvider.GetRequiredService<AgroCoreDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
        var log = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
        try { await DatabaseSeeder.RunAsync(db, hasher, log); }
        catch (Exception ex) { log.LogError(ex, "Error ejecutando seed."); }
    }
}

app.Run();

public partial class Program { }
