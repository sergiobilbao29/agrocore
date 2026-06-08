using AgroCore.Api.Middleware;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Domain.Entities;
using AgroCore.Infrastructure.Persistence;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Application.Services;

public class ContratoService : IContratoService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public ContratoService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<IReadOnlyList<ContratoDto>> ListarAsync(bool soloActivos, CancellationToken ct)
    {
        var q = _db.Contratos.AsQueryable();
        if (soloActivos) q = q.Where(c => c.Activo && c.FechaFin >= DateTime.UtcNow.Date);
        return await q
            .Join(_db.Campos, c => c.CampoId, ca => ca.CampoId, (c, ca) => new { c, ca })
            .Select(x => new ContratoDto(
                x.c.ContratoArrendamientoId, x.c.CampoId, x.ca.Nombre,
                x.c.NumeroContrato, x.c.ArrendadorNombre, x.c.TipoContrato,
                x.c.FechaInicio, x.c.FechaFin, x.c.SuperficieHa, x.c.MonedaId, x.c.Activo))
            .ToListAsync(ct);
    }

    public async Task<int> CrearAsync(ContratoCreateDto dto, CancellationToken ct)
    {
        var gid = _tenant.GrupoId!.Value;
        var eid = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");
        var c = new ContratoArrendamiento
        {
            GrupoId = gid, EmpresaId = eid,
            CampoId = dto.CampoId, NumeroContrato = dto.NumeroContrato,
            ArrendadorNombre = dto.ArrendadorNombre, ArrendadorCuit = dto.ArrendadorCuit,
            TipoContrato = dto.TipoContrato, FechaInicio = dto.FechaInicio, FechaFin = dto.FechaFin,
            SuperficieHa = dto.SuperficieHa, ValorHa = dto.ValorHa, QuintalesPorHa = dto.QuintalesPorHa,
            CultivoReferenciaId = dto.CultivoReferenciaId, PorcentajeGanancia = dto.PorcentajeGanancia,
            MonedaId = dto.MonedaId, FrecuenciaPago = dto.FrecuenciaPago, Observaciones = dto.Observaciones
        };
        _db.Contratos.Add(c);
        await _db.SaveChangesAsync(ct);
        return c.ContratoArrendamientoId;
    }
}

public class ViajeCamionService : IViajeCamionService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public ViajeCamionService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<PagedResult<ViajeCamionDto>> ListarAsync(int page, int pageSize, DateTime? desde, DateTime? hasta, string? estado, CancellationToken ct)
    {
        var q = _db.ViajesCamion.AsQueryable();
        if (desde.HasValue) q = q.Where(v => v.Fecha >= desde);
        if (hasta.HasValue) q = q.Where(v => v.Fecha <= hasta);
        if (!string.IsNullOrWhiteSpace(estado)) q = q.Where(v => v.Estado == estado);

        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(v => v.Fecha)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(v => new ViajeCamionDto(
                v.ViajeCamionId, v.Fecha, v.NumeroCartaPorte, v.DominioTractor,
                v.ChoferNombre, v.TransportistaRazonSocial,
                v.ClienteId, v.ClienteId.HasValue ? _db.Clientes.Where(c => c.ClienteId == v.ClienteId).Select(c => c.RazonSocial).FirstOrDefault() : null,
                v.CultivoId, v.CultivoId.HasValue ? _db.Cultivos.Where(c => c.CultivoId == v.CultivoId).Select(c => c.Nombre).FirstOrDefault() : null,
                v.KgOrigen, v.KgDestino, v.Merma, v.Estado))
            .ToListAsync(ct);
        return new PagedResult<ViajeCamionDto>(items, total, page, pageSize);
    }

    public async Task<int> CrearAsync(ViajeCamionCreateDto dto, CancellationToken ct)
    {
        var gid = _tenant.GrupoId!.Value;
        var eid = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");
        var v = new ViajeCamion
        {
            GrupoId = gid, EmpresaId = eid,
            Fecha = dto.Fecha, NumeroCartaPorte = dto.NumeroCartaPorte,
            DominioTractor = dto.DominioTractor, DominioAcoplado = dto.DominioAcoplado,
            ChoferNombre = dto.ChoferNombre, ChoferCuil = dto.ChoferCuil,
            TransportistaRazonSocial = dto.TransportistaRazonSocial, TransportistaCuit = dto.TransportistaCuit,
            OrigenCampoId = dto.OrigenCampoId, DestinoRazonSocial = dto.DestinoRazonSocial,
            DestinoPlanta = dto.DestinoPlanta, ClienteId = dto.ClienteId, CultivoId = dto.CultivoId,
            KgOrigen = dto.KgOrigen, TarifaKm = dto.TarifaKm, TarifaTn = dto.TarifaTn,
            MonedaId = dto.MonedaId, Observaciones = dto.Observaciones
        };
        _db.ViajesCamion.Add(v);
        await _db.SaveChangesAsync(ct);
        return v.ViajeCamionId;
    }

    public async Task CambiarEstadoAsync(int id, string estado, decimal? kgDestino, decimal? merma, CancellationToken ct)
    {
        var v = await _db.ViajesCamion.FirstOrDefaultAsync(x => x.ViajeCamionId == id, ct)
                ?? throw ApiException.NotFound("Viaje no existe.");
        v.Estado = estado;
        if (kgDestino.HasValue) v.KgDestino = kgDestino;
        if (merma.HasValue) v.Merma = merma;
        if (v.KgOrigen.HasValue && v.KgDestino.HasValue && !v.Merma.HasValue)
            v.Merma = v.KgOrigen - v.KgDestino;
        if (v.KgDestino.HasValue && v.TarifaTn.HasValue)
            v.FleteTotal = Math.Round((v.KgDestino!.Value / 1000m) * v.TarifaTn!.Value, 4);
        await _db.SaveChangesAsync(ct);
    }
}

public class EmpleadoService : IEmpleadoService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public EmpleadoService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<IReadOnlyList<EmpleadoDto>> ListarAsync(bool soloActivos, CancellationToken ct)
    {
        var q = _db.Empleados.AsQueryable();
        if (soloActivos) q = q.Where(e => e.Activo);
        return await q.OrderBy(e => e.Apellido).ThenBy(e => e.Nombre)
            .Select(e => new EmpleadoDto(e.EmpleadoId, e.Legajo, e.Apellido, e.Nombre, e.Puesto, e.SueldoBasico, e.MonedaId, e.Activo))
            .ToListAsync(ct);
    }

    public async Task<int> CrearAsync(EmpleadoCreateDto dto, CancellationToken ct)
    {
        var gid = _tenant.GrupoId!.Value;
        var eid = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");
        var e = new Empleado
        {
            GrupoId = gid, EmpresaId = eid,
            Legajo = dto.Legajo, Apellido = dto.Apellido, Nombre = dto.Nombre,
            Dni = dto.Dni, Cuil = dto.Cuil, FechaIngreso = dto.FechaIngreso,
            Puesto = dto.Puesto, Categoria = dto.Categoria, SueldoBasico = dto.SueldoBasico,
            MonedaId = dto.MonedaId, Telefono = dto.Telefono, Email = dto.Email,
            Direccion = dto.Direccion
        };
        _db.Empleados.Add(e);
        await _db.SaveChangesAsync(ct);
        return e.EmpleadoId;
    }
}

public class ComprobanteService : IComprobanteService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    private readonly ILogger<ComprobanteService> _log;
    public ComprobanteService(AgroCoreDbContext db, ITenantContext tenant, ILogger<ComprobanteService> log)
    { _db = db; _tenant = tenant; _log = log; }

    public async Task<PagedResult<ComprobanteDto>> ListarAsync(int page, int pageSize, DateTime? desde, DateTime? hasta, byte? tipoId, int? puntoVentaId, CancellationToken ct)
    {
        var q = _db.Comprobantes.Include(c => c.Tipo).Include(c => c.PuntoVenta).AsQueryable();
        if (desde.HasValue) q = q.Where(c => c.Fecha >= desde);
        if (hasta.HasValue) q = q.Where(c => c.Fecha <= hasta);
        if (tipoId.HasValue) q = q.Where(c => c.ComprobanteTipoId == tipoId);
        if (puntoVentaId.HasValue) q = q.Where(c => c.PuntoVentaId == puntoVentaId);

        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(c => c.Fecha)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(c => new ComprobanteDto(c.ComprobanteId, c.ComprobanteTipoId, c.Tipo.Nombre,
                c.PuntoVentaId, c.PuntoVenta.Numero, c.Numero, c.Fecha, c.ClienteId, c.ProveedorId,
                c.MonedaId, c.Total, c.Estado, c.Cae))
            .ToListAsync(ct);
        return new PagedResult<ComprobanteDto>(items, total, page, pageSize);
    }

    public async Task<int> CrearAsync(ComprobanteCreateDto dto, CancellationToken ct)
    {
        if (dto.Detalles.Count == 0) throw ApiException.BadRequest("El comprobante no tiene detalles.");
        var gid = _tenant.GrupoId!.Value;
        var eid = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");

        var proximoNumero = (await _db.Comprobantes.IgnoreQueryFilters()
            .Where(c => c.EmpresaId == eid && c.ComprobanteTipoId == dto.ComprobanteTipoId && c.PuntoVentaId == dto.PuntoVentaId)
            .Select(c => (long?)c.Numero).MaxAsync(ct) ?? 0L) + 1L;

        var detalles = dto.Detalles.Select(d => new ComprobanteDetalle
        {
            Descripcion = d.Descripcion,
            Cantidad = d.Cantidad, PrecioUnitario = d.PrecioUnitario,
            AlicuotaIva = d.AlicuotaIva,
            Subtotal = Math.Round(d.Cantidad * d.PrecioUnitario, 4),
            ImporteIva = Math.Round(d.Cantidad * d.PrecioUnitario * d.AlicuotaIva / 100m, 4)
        }).ToList();

        var neto = detalles.Sum(d => d.Subtotal);
        var iva105 = detalles.Where(d => d.AlicuotaIva == 10.5m).Sum(d => d.ImporteIva);
        var iva21  = detalles.Where(d => d.AlicuotaIva == 21m).Sum(d => d.ImporteIva);
        var iva27  = detalles.Where(d => d.AlicuotaIva == 27m).Sum(d => d.ImporteIva);
        var total  = neto + iva105 + iva21 + iva27;

        var c = new Comprobante
        {
            GrupoId = gid, EmpresaId = eid,
            ComprobanteTipoId = dto.ComprobanteTipoId, PuntoVentaId = dto.PuntoVentaId,
            Numero = proximoNumero, Fecha = dto.Fecha,
            ClienteId = dto.ClienteId, ProveedorId = dto.ProveedorId,
            CuitContraparte = dto.CuitContraparte, CondicionIvaContraparte = dto.CondicionIvaContraparte,
            MonedaId = dto.MonedaId, TipoCambio = dto.TipoCambio,
            Neto = neto, Iva105 = iva105, Iva21 = iva21, Iva27 = iva27, Total = total,
            Observaciones = dto.Observaciones, Detalles = detalles, Estado = "Pendiente"
        };
        _db.Comprobantes.Add(c);
        await _db.SaveChangesAsync(ct);
        return c.ComprobanteId;
    }

    public Task SolicitarCaeAsync(int id, CancellationToken ct)
    {
        // Stub: aquí se integraría con WSAA/WSFE de ARCA (AFIP).
        // El cliente ARCA usaría Arca:CertPath, Arca:WsaaUrl y firmaría el TRA XML con pkcs7.
        _log.LogInformation("Solicitud CAE para Comprobante {Id} — stub. Configurar cliente ARCA.", id);
        throw ApiException.BadRequest("La integración ARCA (AFIP) está pendiente de configurar (Arca:Enabled=true y certificado pfx).");
    }
}

public class AdjuntoService : IAdjuntoService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    private readonly IWebHostEnvironment _env;
    public AdjuntoService(AgroCoreDbContext db, ITenantContext tenant, IWebHostEnvironment env)
    { _db = db; _tenant = tenant; _env = env; }

    public async Task<int> SubirAsync(Stream fileStream, string fileName, string? contentType, string entidad, string entidadId, CancellationToken ct)
    {
        var gid = _tenant.GrupoId!.Value;
        var eid = _tenant.EmpresaId!.Value;
        var dir = Path.Combine(_env.ContentRootPath, "App_Data", "uploads", gid.ToString(), eid.ToString());
        Directory.CreateDirectory(dir);
        var safeName = $"{DateTime.UtcNow:yyyyMMddHHmmssfff}_{Path.GetFileName(fileName)}";
        var fullPath = Path.Combine(dir, safeName);
        await using (var fs = File.Create(fullPath))
            await fileStream.CopyToAsync(fs, ct);
        var fi = new FileInfo(fullPath);
        var a = new Adjunto
        {
            GrupoId = gid, EmpresaId = eid,
            NombreOriginal = fileName, ContentType = contentType,
            TamanoBytes = fi.Length, Url = fullPath,
            Entidad = entidad, EntidadId = entidadId,
            SubidoPor = _tenant.UsuarioId
        };
        _db.Adjuntos.Add(a);
        await _db.SaveChangesAsync(ct);
        return a.AdjuntoId;
    }

    public async Task<(Stream stream, string contentType, string name)> DescargarAsync(int id, CancellationToken ct)
    {
        var a = await _db.Adjuntos.FirstOrDefaultAsync(x => x.AdjuntoId == id, ct)
                ?? throw ApiException.NotFound("Adjunto no encontrado.");
        if (!File.Exists(a.Url)) throw ApiException.NotFound("Archivo físico no existe.");
        return (File.OpenRead(a.Url), a.ContentType ?? "application/octet-stream", a.NombreOriginal);
    }
}

public class AuditService : IAuditService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public AuditService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task LogAsync(string entidad, string? entidadId, string accion, object? antes, object? despues, CancellationToken ct = default)
    {
        _db.AuditLogs.Add(new AuditLog
        {
            GrupoId = _tenant.GrupoId ?? 0,
            EmpresaId = _tenant.EmpresaId,
            UsuarioId = _tenant.UsuarioId,
            Entidad = entidad, EntidadId = entidadId, Accion = accion,
            DatosAntes = antes is null ? null : System.Text.Json.JsonSerializer.Serialize(antes),
            DatosDespues = despues is null ? null : System.Text.Json.JsonSerializer.Serialize(despues)
        });
        await _db.SaveChangesAsync(ct);
    }

    public async Task LogEndpointAsync(int grupoId, int? empresaId, int? usuarioId, string path, string method, string? ip, string? userAgent)
    {
        _db.AuditLogs.Add(new AuditLog
        {
            GrupoId = grupoId, EmpresaId = empresaId, UsuarioId = usuarioId,
            Entidad = "Http", EntidadId = path, Accion = method,
            Ip = ip, UserAgent = userAgent
        });
        await _db.SaveChangesAsync();
    }
}

public class UsuarioService : IUsuarioService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    private readonly IPasswordHasher _hasher;
    public UsuarioService(AgroCoreDbContext db, ITenantContext tenant, IPasswordHasher hasher)
    { _db = db; _tenant = tenant; _hasher = hasher; }

    public async Task<PagedResult<UsuarioResumen>> ListarAsync(int page, int pageSize, string? busqueda, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("No autenticado.");
        var q = _db.Usuarios.IgnoreQueryFilters().Where(u => u.GrupoId == grupoId && u.DeletedAt == null);
        if (!string.IsNullOrWhiteSpace(busqueda))
            q = q.Where(u => EF.Functions.Like(u.Username, $"%{busqueda}%") ||
                             EF.Functions.Like(u.Email, $"%{busqueda}%") ||
                             EF.Functions.Like(u.NombreCompleto, $"%{busqueda}%"));
        var total = await q.CountAsync(ct);
        var items = await q.OrderBy(u => u.Username)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(u => new UsuarioResumen(u.UsuarioId, u.Username, u.NombreCompleto, u.Email))
            .ToListAsync(ct);
        return new PagedResult<UsuarioResumen>(items, total, page, pageSize);
    }

    public async Task<int> CrearAsync(CrearUsuarioRequest req, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("No autenticado.");
        if (await _db.Usuarios.IgnoreQueryFilters().AnyAsync(u => u.GrupoId == grupoId && (u.Username == req.Username || u.Email == req.Email), ct))
            throw ApiException.Conflict("Username o email ya existe.");

        var (hash, salt) = _hasher.Hash(req.Password);
        var u = new Usuario
        {
            GrupoId = grupoId, Username = req.Username, Email = req.Email,
            NombreCompleto = req.NombreCompleto, PasswordHash = hash, PasswordSalt = salt,
            Telefono = req.Telefono, Activo = true
        };
        _db.Usuarios.Add(u);
        await _db.SaveChangesAsync(ct);

        foreach (var a in req.Asignaciones.Distinct())
            _db.UsuarioEmpresaRoles.Add(new UsuarioEmpresaRol { UsuarioId = u.UsuarioId, EmpresaId = a.EmpresaId, RolId = a.RolId });
        await _db.SaveChangesAsync(ct);
        return u.UsuarioId;
    }

    public async Task ActualizarAsync(int id, EditarUsuarioRequest req, CancellationToken ct)
    {
        var u = await _db.Usuarios.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.UsuarioId == id, ct)
                ?? throw ApiException.NotFound("Usuario no encontrado.");
        u.NombreCompleto = req.NombreCompleto; u.Email = req.Email;
        u.Telefono = req.Telefono; u.Activo = req.Activo;
        await _db.SaveChangesAsync(ct);
    }

    public async Task ActivarAsync(int id, bool activo, CancellationToken ct)
    {
        var u = await _db.Usuarios.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.UsuarioId == id, ct)
                ?? throw ApiException.NotFound("Usuario no encontrado.");
        u.Activo = activo;
        await _db.SaveChangesAsync(ct);
    }

    public async Task AsignarRolesAsync(int usuarioId, List<AsignacionRol> asignaciones, CancellationToken ct)
    {
        var actuales = await _db.UsuarioEmpresaRoles.Where(x => x.UsuarioId == usuarioId).ToListAsync(ct);
        _db.UsuarioEmpresaRoles.RemoveRange(actuales);
        foreach (var a in asignaciones.Distinct())
            _db.UsuarioEmpresaRoles.Add(new UsuarioEmpresaRol { UsuarioId = usuarioId, EmpresaId = a.EmpresaId, RolId = a.RolId });
        await _db.SaveChangesAsync(ct);
    }
}
