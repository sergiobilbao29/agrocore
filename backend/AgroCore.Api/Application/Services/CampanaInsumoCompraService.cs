using AgroCore.Api.Middleware;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Domain.Entities;
using AgroCore.Domain.Enums;
using AgroCore.Infrastructure.Persistence;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Application.Services;

public class CampanaService : ICampanaService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    private readonly IMargenBrutoService _margen;
    public CampanaService(AgroCoreDbContext db, ITenantContext tenant, IMargenBrutoService margen)
    { _db = db; _tenant = tenant; _margen = margen; }

    public async Task<PagedResult<CampanaDto>> ListarAsync(int page, int pageSize, int? loteId, string? estado, CancellationToken ct)
    {
        var q = _db.Campanas
            .Include(c => c.Lote)
            .Include(c => c.Cultivo)
            .AsQueryable();
        if (loteId.HasValue) q = q.Where(c => c.LoteId == loteId.Value);
        if (!string.IsNullOrWhiteSpace(estado)) q = q.Where(c => c.Estado == estado);

        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(c => c.FechaSiembra ?? DateTime.MinValue)
                           .Skip((page - 1) * pageSize).Take(pageSize)
                           .Select(c => new CampanaDto(
                               c.CampanaId, c.LoteId, c.Lote.Nombre, c.CultivoId, c.Cultivo.Nombre,
                               c.Nombre, c.FechaSiembra, c.FechaCosechaEstimada, c.FechaCosechaReal,
                               c.SuperficieSembradaHa, c.RendimientoEstimadoKgHa, c.RendimientoRealKgHa,
                               c.KgCosechadosTotales, c.Estado, c.CostoAcumuladoArs, c.CostoAcumuladoUsd))
                           .ToListAsync(ct);
        return new PagedResult<CampanaDto>(items, total, page, pageSize);
    }

    public async Task<CampanaDto?> ObtenerAsync(int id, CancellationToken ct) =>
        await _db.Campanas.Include(c => c.Lote).Include(c => c.Cultivo)
            .Where(c => c.CampanaId == id)
            .Select(c => new CampanaDto(c.CampanaId, c.LoteId, c.Lote.Nombre, c.CultivoId, c.Cultivo.Nombre,
                c.Nombre, c.FechaSiembra, c.FechaCosechaEstimada, c.FechaCosechaReal,
                c.SuperficieSembradaHa, c.RendimientoEstimadoKgHa, c.RendimientoRealKgHa,
                c.KgCosechadosTotales, c.Estado, c.CostoAcumuladoArs, c.CostoAcumuladoUsd))
            .FirstOrDefaultAsync(ct);

    public async Task<int> CrearAsync(CampanaCreateDto dto, CancellationToken ct)
    {
        var lote = await _db.Lotes.FirstOrDefaultAsync(l => l.LoteId == dto.LoteId, ct)
                   ?? throw ApiException.NotFound("Lote no encontrado.");
        if (dto.SuperficieSembradaHa > lote.SuperficieHa)
            throw ApiException.BadRequest($"La superficie sembrada ({dto.SuperficieSembradaHa} ha) no puede superar la del lote ({lote.SuperficieHa} ha).");

        var c = new Campana
        {
            GrupoId = lote.GrupoId, EmpresaId = lote.EmpresaId,
            LoteId = lote.LoteId, CultivoId = dto.CultivoId, Nombre = dto.Nombre,
            FechaSiembra = dto.FechaSiembra, FechaCosechaEstimada = dto.FechaCosechaEstimada,
            SuperficieSembradaHa = dto.SuperficieSembradaHa,
            RendimientoEstimadoKgHa = dto.RendimientoEstimadoKgHa,
            Observaciones = dto.Observaciones,
            Estado = dto.FechaSiembra.HasValue ? EstadoCampana.EnCurso.ToString() : EstadoCampana.Planificada.ToString()
        };
        _db.Campanas.Add(c);
        await _db.SaveChangesAsync(ct);
        return c.CampanaId;
    }

    public async Task ActualizarAsync(int id, CampanaUpdateDto dto, CancellationToken ct)
    {
        var c = await _db.Campanas.FirstOrDefaultAsync(x => x.CampanaId == id, ct)
                ?? throw ApiException.NotFound("Campaña no encontrada.");
        c.Nombre = dto.Nombre;
        c.FechaSiembra = dto.FechaSiembra;
        c.FechaCosechaEstimada = dto.FechaCosechaEstimada;
        c.FechaCosechaReal = dto.FechaCosechaReal;
        c.SuperficieSembradaHa = dto.SuperficieSembradaHa;
        c.RendimientoEstimadoKgHa = dto.RendimientoEstimadoKgHa;
        c.RendimientoRealKgHa = dto.RendimientoRealKgHa;
        c.KgCosechadosTotales = dto.KgCosechadosTotales;
        c.HumedadPromedio = dto.HumedadPromedio;
        c.Estado = dto.Estado;
        c.Observaciones = dto.Observaciones;
        await _db.SaveChangesAsync(ct);
    }

    public async Task CerrarAsync(int id, CancellationToken ct)
    {
        var c = await _db.Campanas.FirstOrDefaultAsync(x => x.CampanaId == id, ct)
                ?? throw ApiException.NotFound("Campaña no encontrada.");
        c.Estado = EstadoCampana.Cerrada.ToString();
        await _db.SaveChangesAsync(ct);
    }

    public Task<MargenBrutoDto?> MargenBrutoAsync(int id, CancellationToken ct) =>
        _margen.CalcularCampanaAsync(id, ct);
}

public class InsumoService : IInsumoService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public InsumoService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<PagedResult<InsumoDto>> ListarAsync(int page, int pageSize, string? busqueda, string? tipo, bool soloBajoMinimo, CancellationToken ct)
    {
        var q = _db.Insumos.AsQueryable();
        if (!string.IsNullOrWhiteSpace(busqueda))
            q = q.Where(i => EF.Functions.Like(i.Nombre, $"%{busqueda}%") || EF.Functions.Like(i.Codigo, $"%{busqueda}%"));
        if (!string.IsNullOrWhiteSpace(tipo)) q = q.Where(i => i.TipoInsumo == tipo);
        if (soloBajoMinimo) q = q.Where(i => i.StockActual <= i.StockMinimo);

        var total = await q.CountAsync(ct);
        var items = await q.OrderBy(i => i.Codigo)
                           .Skip((page - 1) * pageSize).Take(pageSize)
                           .Select(i => new InsumoDto(i.InsumoId, i.Codigo, i.Nombre, i.TipoInsumo, i.UnidadMedida,
                               i.StockActual, i.StockMinimo, i.CostoPromedio, i.MonedaCostoId, i.Activo))
                           .ToListAsync(ct);
        return new PagedResult<InsumoDto>(items, total, page, pageSize);
    }

    public async Task<InsumoDto?> ObtenerAsync(int id, CancellationToken ct) =>
        await _db.Insumos.Where(i => i.InsumoId == id)
            .Select(i => new InsumoDto(i.InsumoId, i.Codigo, i.Nombre, i.TipoInsumo, i.UnidadMedida,
                i.StockActual, i.StockMinimo, i.CostoPromedio, i.MonedaCostoId, i.Activo))
            .FirstOrDefaultAsync(ct);

    public async Task<int> CrearAsync(InsumoCreateDto dto, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("No autenticado.");
        var empresaId = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");
        if (await _db.Insumos.AnyAsync(x => x.EmpresaId == empresaId && x.Codigo == dto.Codigo, ct))
            throw ApiException.Conflict("Código de insumo duplicado.");

        var i = new Insumo
        {
            GrupoId = grupoId, EmpresaId = empresaId,
            Codigo = dto.Codigo, Nombre = dto.Nombre, TipoInsumo = dto.TipoInsumo,
            UnidadMedida = dto.UnidadMedida, Marca = dto.Marca, StockMinimo = dto.StockMinimo,
            MonedaCostoId = dto.MonedaCostoId
        };
        _db.Insumos.Add(i);
        await _db.SaveChangesAsync(ct);
        return i.InsumoId;
    }

    public async Task ActualizarAsync(int id, InsumoUpdateDto dto, CancellationToken ct)
    {
        var i = await _db.Insumos.FirstOrDefaultAsync(x => x.InsumoId == id, ct)
                ?? throw ApiException.NotFound("Insumo no encontrado.");
        i.Nombre = dto.Nombre; i.UnidadMedida = dto.UnidadMedida; i.Marca = dto.Marca;
        i.StockMinimo = dto.StockMinimo; i.MonedaCostoId = dto.MonedaCostoId; i.Activo = dto.Activo;
        await _db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<InsumoDto>> AlertasStockBajoAsync(CancellationToken ct) =>
        await _db.Insumos.Where(i => i.Activo && i.StockActual <= i.StockMinimo)
            .Select(i => new InsumoDto(i.InsumoId, i.Codigo, i.Nombre, i.TipoInsumo, i.UnidadMedida,
                i.StockActual, i.StockMinimo, i.CostoPromedio, i.MonedaCostoId, i.Activo))
            .ToListAsync(ct);
}

public class CompraService : ICompraService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public CompraService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<PagedResult<CompraInsumoDto>> ListarAsync(int page, int pageSize, DateTime? desde, DateTime? hasta, int? proveedorId, CancellationToken ct)
    {
        var q = _db.ComprasInsumo.Include(x => x.Proveedor).Include(x => x.Detalles).ThenInclude(d => d.Insumo).AsQueryable();
        if (desde.HasValue)  q = q.Where(c => c.Fecha >= desde.Value);
        if (hasta.HasValue)  q = q.Where(c => c.Fecha <= hasta.Value);
        if (proveedorId.HasValue) q = q.Where(c => c.ProveedorId == proveedorId);

        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(c => c.Fecha)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(c => new CompraInsumoDto(
                c.CompraInsumoId, c.ProveedorId, c.Proveedor.RazonSocial, c.Fecha, c.NumeroComprobante,
                c.MonedaId, c.TipoCambio, c.Total,
                c.Detalles.Select(d => new CompraInsumoDetalleDto(d.CompraInsumoDetalleId, d.InsumoId, d.Insumo.Nombre,
                    d.Cantidad, d.PrecioUnitario, d.Descuento, d.Subtotal)).ToList()))
            .ToListAsync(ct);
        return new PagedResult<CompraInsumoDto>(items, total, page, pageSize);
    }

    public async Task<CompraInsumoDto?> ObtenerAsync(int id, CancellationToken ct) =>
        await _db.ComprasInsumo.Include(x => x.Proveedor).Include(x => x.Detalles).ThenInclude(d => d.Insumo)
            .Where(c => c.CompraInsumoId == id)
            .Select(c => new CompraInsumoDto(c.CompraInsumoId, c.ProveedorId, c.Proveedor.RazonSocial, c.Fecha,
                c.NumeroComprobante, c.MonedaId, c.TipoCambio, c.Total,
                c.Detalles.Select(d => new CompraInsumoDetalleDto(d.CompraInsumoDetalleId, d.InsumoId, d.Insumo.Nombre,
                    d.Cantidad, d.PrecioUnitario, d.Descuento, d.Subtotal)).ToList()))
            .FirstOrDefaultAsync(ct);

    public async Task<int> CrearAsync(CompraInsumoCreateDto dto, CancellationToken ct)
    {
        if (dto.Detalles.Count == 0) throw ApiException.BadRequest("La compra no tiene detalle.");
        var grupoId = _tenant.GrupoId!.Value;
        var empresaId = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");

        // Cargar insumos referenciados en lote
        var insumoIds = dto.Detalles.Select(d => d.InsumoId).Distinct().ToList();
        var insumos = await _db.Insumos.Where(i => insumoIds.Contains(i.InsumoId)).ToListAsync(ct);
        if (insumos.Count != insumoIds.Count)
            throw ApiException.BadRequest("Alguno de los insumos no existe.");

        var detalles = dto.Detalles.Select(d => new CompraInsumoDetalle
        {
            InsumoId = d.InsumoId,
            Cantidad = d.Cantidad,
            PrecioUnitario = d.PrecioUnitario,
            Descuento = d.Descuento,
            Subtotal = Math.Round(d.Cantidad * d.PrecioUnitario - d.Descuento, 4)
        }).ToList();

        var subtotal = detalles.Sum(d => d.Subtotal);
        var iva = Math.Round(subtotal * 0.21m, 4);
        var total = subtotal + iva + dto.Percepciones;

        var compra = new CompraInsumo
        {
            GrupoId = grupoId, EmpresaId = empresaId,
            ProveedorId = dto.ProveedorId, Fecha = dto.Fecha,
            NumeroComprobante = dto.NumeroComprobante, TipoComprobante = dto.TipoComprobante,
            MonedaId = dto.MonedaId, TipoCambio = dto.TipoCambio,
            Subtotal = subtotal, Iva = iva, Percepciones = dto.Percepciones, Total = total,
            MedioPago = dto.MedioPago, Observaciones = dto.Observaciones,
            Detalles = detalles
        };
        _db.ComprasInsumo.Add(compra);

        // Actualizar stock y costo promedio + movimiento de stock
        foreach (var det in detalles)
        {
            var ins = insumos.First(i => i.InsumoId == det.InsumoId);
            // CPP ponderado: (stockActual*costoProm + cantidad*costoUnitario) / (stockActual + cantidad)
            var costoUnitarioArs = det.PrecioUnitario * (dto.MonedaId == 1 ? 1 : dto.TipoCambio);
            var stockPrev = ins.StockActual;
            var costoPrev = ins.CostoPromedio ?? 0m;
            var stockNuevo = stockPrev + det.Cantidad;
            if (stockNuevo > 0)
                ins.CostoPromedio = Math.Round((stockPrev * costoPrev + det.Cantidad * costoUnitarioArs) / stockNuevo, 4);
            ins.CostoUltimo = costoUnitarioArs;
            ins.StockActual = stockNuevo;

            _db.MovimientosStockInsumo.Add(new MovimientoStockInsumo
            {
                GrupoId = grupoId, EmpresaId = empresaId,
                InsumoId = ins.InsumoId, Fecha = dto.Fecha,
                Tipo = (int)TipoMovimientoStock.Ingreso,
                Cantidad = det.Cantidad, CostoUnitario = costoUnitarioArs,
                Motivo = "Compra a proveedor"
            });
        }

        await _db.SaveChangesAsync(ct);
        return compra.CompraInsumoId;
    }
}
