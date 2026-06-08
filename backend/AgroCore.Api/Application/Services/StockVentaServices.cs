using AgroCore.Api.Middleware;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Domain.Entities;
using AgroCore.Infrastructure.Persistence;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Application.Services;

public class StockGranoService : IStockGranoService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public StockGranoService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<IReadOnlyList<StockGranoDto>> StockActualAsync(CancellationToken ct) =>
        await _db.StocksGrano
            .Include(s => s.Silo!).Include(s => s.Cultivo!)
            .Join(_db.Silos, s => s.SiloId, si => si.SiloId, (s, si) => new { s, si })
            .Join(_db.Cultivos, x => x.s.CultivoId, cu => cu.CultivoId, (x, cu) => new { x.s, x.si, cu })
            .Select(x => new StockGranoDto(x.s.StockGranoId, x.s.SiloId, x.si.Descripcion,
                x.s.CultivoId, x.cu.Nombre, x.s.CampanaId, x.s.Kilogramos, x.s.HumedadPromedio))
            .ToListAsync(ct);

    public async Task<int> RegistrarMovimientoAsync(MovimientoGranoCreateDto dto, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("No autenticado.");
        var empresaId = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");

        var m = new MovimientoGrano
        {
            GrupoId = grupoId, EmpresaId = empresaId,
            SiloId = dto.SiloId, CultivoId = dto.CultivoId, CampanaId = dto.CampanaId,
            Fecha = dto.Fecha, Tipo = dto.Tipo, Kilogramos = dto.Kilogramos,
            Humedad = dto.Humedad, Impureza = dto.Impureza,
            NumeroCartaPorte = dto.NumeroCartaPorte, ClienteId = dto.ClienteId,
            SiloDestinoId = dto.SiloDestinoId, ViajeCamionId = dto.ViajeCamionId,
            Observaciones = dto.Observaciones
        };
        _db.MovimientosGrano.Add(m);

        var stock = await _db.StocksGrano.FirstOrDefaultAsync(s =>
            s.SiloId == dto.SiloId && s.CultivoId == dto.CultivoId && s.CampanaId == dto.CampanaId, ct);
        if (stock == null)
        {
            stock = new StockGrano
            {
                GrupoId = grupoId, EmpresaId = empresaId,
                SiloId = dto.SiloId, CultivoId = dto.CultivoId, CampanaId = dto.CampanaId
            };
            _db.StocksGrano.Add(stock);
        }

        var signo = dto.Tipo switch
        {
            "Ingreso" or "TrasladoEntrada" or "Ajuste" => 1,
            "Egreso" or "TrasladoSalida" => -1,
            _ => 1
        };
        stock.Kilogramos += signo * dto.Kilogramos;
        stock.UltimaActualizacion = DateTime.UtcNow;

        // Traslado: contrapartida en silo destino
        if (dto.Tipo == "TrasladoSalida" && dto.SiloDestinoId.HasValue)
        {
            var destino = await _db.StocksGrano.FirstOrDefaultAsync(s =>
                s.SiloId == dto.SiloDestinoId.Value && s.CultivoId == dto.CultivoId && s.CampanaId == dto.CampanaId, ct);
            if (destino == null)
            {
                destino = new StockGrano
                {
                    GrupoId = grupoId, EmpresaId = empresaId,
                    SiloId = dto.SiloDestinoId.Value, CultivoId = dto.CultivoId, CampanaId = dto.CampanaId
                };
                _db.StocksGrano.Add(destino);
            }
            destino.Kilogramos += dto.Kilogramos;
            destino.UltimaActualizacion = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        return m.MovimientoGranoId;
    }
}

public class HaciendaService : IHaciendaService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public HaciendaService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<PagedResult<HaciendaDto>> ListarAsync(int page, int pageSize, string? categoria, string? estado, CancellationToken ct)
    {
        var q = _db.Haciendas.AsQueryable();
        if (!string.IsNullOrWhiteSpace(categoria)) q = q.Where(h => h.Categoria == categoria);
        if (!string.IsNullOrWhiteSpace(estado)) q = q.Where(h => h.Estado == estado);

        var total = await q.CountAsync(ct);
        var items = await q.OrderBy(h => h.CaravanaSenasa)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(h => new HaciendaDto(h.HaciendaId, h.CaravanaSenasa, h.Categoria, h.Raza, h.PesoActualKg, h.Estado))
            .ToListAsync(ct);
        return new PagedResult<HaciendaDto>(items, total, page, pageSize);
    }

    public async Task<int> RegistrarMovimientoAsync(MovimientoHaciendaCreateDto dto, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("No autenticado.");
        var empresaId = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");
        var m = new MovimientoHacienda
        {
            GrupoId = grupoId, EmpresaId = empresaId,
            Fecha = dto.Fecha, Tipo = dto.Tipo, Categoria = dto.Categoria,
            Cantidad = dto.Cantidad, PesoTotalKg = dto.PesoTotalKg,
            CampoOrigenId = dto.CampoOrigenId, CampoDestinoId = dto.CampoDestinoId,
            ClienteId = dto.ClienteId, ProveedorId = dto.ProveedorId,
            Dte = dto.Dte, Observaciones = dto.Observaciones
        };
        _db.MovimientosHacienda.Add(m);
        await _db.SaveChangesAsync(ct);
        return m.MovimientoHaciendaId;
    }
}

public class VentaService : IVentaService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public VentaService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<int> CrearVentaGranoAsync(VentaGranoCreateDto dto, CancellationToken ct)
    {
        var gid = _tenant.GrupoId!.Value;
        var eid = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");
        var subtotal = Math.Round(dto.Kilogramos / 1000m * dto.PrecioUnitarioPorTn, 4);
        var total = subtotal - dto.Comisiones - dto.Fletes - dto.Retenciones + dto.Iva;
        var v = new VentaGrano
        {
            GrupoId = gid, EmpresaId = eid,
            ClienteId = dto.ClienteId, CultivoId = dto.CultivoId, SiloId = dto.SiloId,
            Fecha = dto.Fecha, NumeroContrato = dto.NumeroContrato,
            Kilogramos = dto.Kilogramos, PrecioUnitarioPorTn = dto.PrecioUnitarioPorTn,
            MonedaId = dto.MonedaId, TipoCambio = dto.TipoCambio,
            Subtotal = subtotal, Comisiones = dto.Comisiones, Fletes = dto.Fletes,
            Retenciones = dto.Retenciones, Iva = dto.Iva, Total = total,
            MedioPago = dto.MedioPago, Observaciones = dto.Observaciones
        };
        _db.VentasGrano.Add(v);

        // Egreso de stock grano (si hay silo)
        if (dto.SiloId.HasValue)
        {
            var stock = await _db.StocksGrano.FirstOrDefaultAsync(s =>
                s.SiloId == dto.SiloId && s.CultivoId == dto.CultivoId, ct);
            if (stock != null)
            {
                if (stock.Kilogramos < dto.Kilogramos)
                    throw ApiException.BadRequest("Stock insuficiente para la venta.");
                stock.Kilogramos -= dto.Kilogramos;
                stock.UltimaActualizacion = DateTime.UtcNow;
                _db.MovimientosGrano.Add(new MovimientoGrano
                {
                    GrupoId = gid, EmpresaId = eid,
                    SiloId = dto.SiloId.Value, CultivoId = dto.CultivoId,
                    Fecha = dto.Fecha, Tipo = "Egreso",
                    Kilogramos = dto.Kilogramos, ClienteId = dto.ClienteId,
                    Observaciones = $"Venta #{dto.NumeroContrato}"
                });
            }
        }
        await _db.SaveChangesAsync(ct);
        return v.VentaGranoId;
    }

    public async Task<int> CrearVentaHaciendaAsync(VentaHaciendaCreateDto dto, CancellationToken ct)
    {
        var gid = _tenant.GrupoId!.Value;
        var eid = _tenant.EmpresaId!.Value;
        var subtotal = Math.Round(dto.PesoTotalKg * dto.PrecioUnitarioPorKg, 4);
        var total = subtotal - dto.Comisiones - dto.Fletes;
        var v = new VentaHacienda
        {
            GrupoId = gid, EmpresaId = eid,
            ClienteId = dto.ClienteId, Fecha = dto.Fecha, NumeroRemito = dto.NumeroRemito,
            Cantidad = dto.Cantidad, Categoria = dto.Categoria,
            PesoTotalKg = dto.PesoTotalKg, PrecioUnitarioPorKg = dto.PrecioUnitarioPorKg,
            MonedaId = dto.MonedaId, TipoCambio = dto.TipoCambio,
            Subtotal = subtotal, Comisiones = dto.Comisiones, Fletes = dto.Fletes, Total = total,
            MedioPago = dto.MedioPago, Observaciones = dto.Observaciones
        };
        _db.VentasHacienda.Add(v);
        await _db.SaveChangesAsync(ct);
        return v.VentaHaciendaId;
    }

    public async Task<int> CrearVentaPymeAsync(VentaPymeCreateDto dto, CancellationToken ct)
    {
        var gid = _tenant.GrupoId!.Value;
        var eid = _tenant.EmpresaId!.Value;
        var subtotal = Math.Round(dto.Cantidad * dto.PrecioUnitario, 4);
        var v = new VentaPyme
        {
            GrupoId = gid, EmpresaId = eid,
            ClienteId = dto.ClienteId, Fecha = dto.Fecha, Concepto = dto.Concepto,
            Cantidad = dto.Cantidad, PrecioUnitario = dto.PrecioUnitario,
            MonedaId = dto.MonedaId, TipoCambio = dto.TipoCambio,
            Subtotal = subtotal, Iva = dto.Iva, Total = subtotal + dto.Iva,
            MedioPago = dto.MedioPago, Observaciones = dto.Observaciones
        };
        _db.VentasPyme.Add(v);
        await _db.SaveChangesAsync(ct);
        return v.VentaPymeId;
    }
}
