using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Application.Services;

/// <summary>
/// Agrega indicadores clave para la pantalla principal del productor/administrador.
/// Todas las consultas respetan los filtros multi-tenant del DbContext.
/// </summary>
public class DashboardService : IDashboardService
{
    private readonly AgroCoreDbContext _db;
    private readonly IMargenBrutoService _margen;

    public DashboardService(AgroCoreDbContext db, IMargenBrutoService margen)
    {
        _db = db; _margen = margen;
    }

    public async Task<DashboardDto> GetAsync(CancellationToken ct)
    {
        var campanasActivas = await _db.Campanas
            .CountAsync(c => c.Estado != "Cosechada" && c.Estado != "Cancelada", ct);

        var superficieHa = await _db.Lotes.Where(l => l.Activo).SumAsync(l => (decimal?)l.SuperficieHa, ct) ?? 0m;

        var stockGranoKg = await _db.StocksGrano.SumAsync(s => (decimal?)s.Kilogramos, ct) ?? 0m;

        var cabezasHacienda = await _db.Haciendas
            .Where(h => h.Estado == "Activo")
            .CountAsync(ct);

        // Saldos de caja: sumatoria de flujos en cada moneda (1=ARS, 2=USD)
        var saldosPorMoneda = await _db.MovimientosCaja
            .GroupBy(m => m.MonedaId)
            .Select(g => new
            {
                MonedaId = g.Key,
                Saldo = g.Sum(m => (m.Tipo == "Ingreso" ? m.Importe : 0m)
                                 - (m.Tipo == "Egreso" ? m.Importe : 0m))
            })
            .ToListAsync(ct);
        var saldoArs = saldosPorMoneda.FirstOrDefault(s => s.MonedaId == 1)?.Saldo ?? 0m;
        var saldoUsd = saldosPorMoneda.FirstOrDefault(s => s.MonedaId == 2)?.Saldo ?? 0m;

        // Cheques a cobrar (tercero, en cartera / depositado)
        var chequesPorMoneda = await _db.Cheques
            .Where(c => c.Tipo == "Tercero" && (c.Estado == "EnCartera" || c.Estado == "Depositado"))
            .GroupBy(c => c.MonedaId)
            .Select(g => new { MonedaId = g.Key, Total = g.Sum(c => c.Importe) })
            .ToListAsync(ct);
        var chequesArs = chequesPorMoneda.FirstOrDefault(x => x.MonedaId == 1)?.Total ?? 0m;
        var chequesUsd = chequesPorMoneda.FirstOrDefault(x => x.MonedaId == 2)?.Total ?? 0m;

        // Deuda con proveedores = saldo positivo a pagar en ctacte Proveedor (ARS)
        var deudaProv = await _db.CuentasCorrientes
            .Where(cc => cc.Tipo == "Proveedor" && cc.MonedaId == 1)
            .SumAsync(cc => (decimal?)cc.Saldo, ct) ?? 0m;
        if (deudaProv < 0) deudaProv = Math.Abs(deudaProv);

        var alertasStockBajo = await _db.Insumos
            .CountAsync(i => i.Activo && i.StockActual <= i.StockMinimo, ct);

        var topCampanas = await _margen.TopCampanasAsync(5, ct);

        return new DashboardDto(
            campanasActivas,
            superficieHa,
            stockGranoKg,
            cabezasHacienda,
            saldoArs,
            saldoUsd,
            chequesArs,
            chequesUsd,
            deudaProv,
            alertasStockBajo,
            topCampanas.ToList());
    }
}
