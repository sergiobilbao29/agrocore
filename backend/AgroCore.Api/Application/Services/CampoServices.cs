using AgroCore.Api.Middleware;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Domain.Entities;
using AgroCore.Infrastructure.Persistence;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Application.Services;

public class EmpresaService : IEmpresaService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public EmpresaService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<IReadOnlyList<EmpresaResumen>> ListarMisEmpresasAsync(CancellationToken ct)
    {
        var uid = _tenant.UsuarioId ?? throw ApiException.Unauthorized("No autenticado.");
        return await _db.UsuarioEmpresaRoles.IgnoreQueryFilters()
            .Where(uer => uer.UsuarioId == uid)
            .Select(uer => uer.Empresa)
            .Distinct()
            .Select(e => new EmpresaResumen(e.EmpresaId, e.RazonSocial, e.Cuit, e.EsPyme, e.CondicionIva))
            .ToListAsync(ct);
    }
}

public class CampoService : ICampoService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public CampoService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<IReadOnlyList<CampoDto>> ListarAsync(CancellationToken ct) =>
        await _db.Campos
            .Select(c => new CampoDto(c.CampoId, c.Codigo, c.Nombre, c.SuperficieTotalHa, c.Localidad, c.Provincia, c.Renspa, c.Propio, c.Activo))
            .ToListAsync(ct);

    public async Task<CampoDto?> ObtenerAsync(int id, CancellationToken ct) =>
        await _db.Campos
            .Where(c => c.CampoId == id)
            .Select(c => new CampoDto(c.CampoId, c.Codigo, c.Nombre, c.SuperficieTotalHa, c.Localidad, c.Provincia, c.Renspa, c.Propio, c.Activo))
            .FirstOrDefaultAsync(ct);

    public async Task<int> CrearAsync(CampoCreateDto dto, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("No autenticado.");
        var empresaId = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");
        if (await _db.Campos.AnyAsync(x => x.Codigo == dto.Codigo && x.EmpresaId == empresaId, ct))
            throw ApiException.Conflict("Ya existe un campo con ese código.");

        var c = new Campo
        {
            GrupoId = grupoId, EmpresaId = empresaId,
            Codigo = dto.Codigo, Nombre = dto.Nombre,
            SuperficieTotalHa = dto.SuperficieTotalHa,
            Localidad = dto.Localidad, Provincia = dto.Provincia, Renspa = dto.Renspa,
            GeoJson = dto.GeoJson, Propio = dto.Propio
        };
        _db.Campos.Add(c);
        await _db.SaveChangesAsync(ct);
        return c.CampoId;
    }

    public async Task ActualizarAsync(int id, CampoUpdateDto dto, CancellationToken ct)
    {
        var c = await _db.Campos.FirstOrDefaultAsync(x => x.CampoId == id, ct)
                ?? throw ApiException.NotFound("Campo no encontrado.");
        c.Nombre = dto.Nombre; c.SuperficieTotalHa = dto.SuperficieTotalHa;
        c.Localidad = dto.Localidad; c.Provincia = dto.Provincia; c.Renspa = dto.Renspa;
        c.GeoJson = dto.GeoJson; c.Propio = dto.Propio; c.Activo = dto.Activo;
        await _db.SaveChangesAsync(ct);
    }

    public async Task EliminarAsync(int id, CancellationToken ct)
    {
        var c = await _db.Campos.FirstOrDefaultAsync(x => x.CampoId == id, ct)
                ?? throw ApiException.NotFound("Campo no encontrado.");
        _db.Campos.Remove(c); // soft-delete via SaveChanges
        await _db.SaveChangesAsync(ct);
    }
}

public class LoteService : ILoteService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public LoteService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<IReadOnlyList<LoteDto>> ListarAsync(int? campoId, CancellationToken ct) =>
        await _db.Lotes
            .Where(l => campoId == null || l.CampoId == campoId)
            .OrderBy(l => l.Codigo)
            .Select(l => new LoteDto(l.LoteId, l.CampoId, l.Codigo, l.Nombre, l.SuperficieHa, l.TipoSuelo, l.Aptitud, l.Activo,
                _db.Campanas.Where(c => c.LoteId == l.LoteId && c.Estado != "Cerrada")
                            .OrderByDescending(c => c.FechaSiembra)
                            .Select(c => c.Nombre).FirstOrDefault()))
            .ToListAsync(ct);

    public async Task<LoteDto?> ObtenerAsync(int id, CancellationToken ct) =>
        await _db.Lotes.Where(l => l.LoteId == id)
            .Select(l => new LoteDto(l.LoteId, l.CampoId, l.Codigo, l.Nombre, l.SuperficieHa, l.TipoSuelo, l.Aptitud, l.Activo, null))
            .FirstOrDefaultAsync(ct);

    public async Task<int> CrearAsync(LoteCreateDto dto, CancellationToken ct)
    {
        var campo = await _db.Campos.FirstOrDefaultAsync(c => c.CampoId == dto.CampoId, ct)
                    ?? throw ApiException.NotFound("Campo no existe.");
        var l = new Lote
        {
            GrupoId = campo.GrupoId, EmpresaId = campo.EmpresaId, CampoId = campo.CampoId,
            Codigo = dto.Codigo, Nombre = dto.Nombre, SuperficieHa = dto.SuperficieHa,
            GeoJson = dto.GeoJson, TipoSuelo = dto.TipoSuelo, Aptitud = dto.Aptitud
        };
        _db.Lotes.Add(l);
        await _db.SaveChangesAsync(ct);
        return l.LoteId;
    }

    public async Task ActualizarAsync(int id, LoteUpdateDto dto, CancellationToken ct)
    {
        var l = await _db.Lotes.FirstOrDefaultAsync(x => x.LoteId == id, ct)
                ?? throw ApiException.NotFound("Lote no encontrado.");
        l.Nombre = dto.Nombre; l.SuperficieHa = dto.SuperficieHa;
        l.GeoJson = dto.GeoJson; l.TipoSuelo = dto.TipoSuelo; l.Aptitud = dto.Aptitud;
        l.Activo = dto.Activo;
        await _db.SaveChangesAsync(ct);
    }

    public async Task EliminarAsync(int id, CancellationToken ct)
    {
        var l = await _db.Lotes.FirstOrDefaultAsync(x => x.LoteId == id, ct)
                ?? throw ApiException.NotFound("Lote no encontrado.");
        _db.Lotes.Remove(l);
        await _db.SaveChangesAsync(ct);
    }
}
