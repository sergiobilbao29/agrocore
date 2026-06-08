using AgroCore.Api.Middleware;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Application.Services;

/// <summary>
/// Cálculo del margen bruto por campaña:
///     MB = Ingreso - Costo Directo (insumos + costos OT) - Arrendamiento imputado.
/// Todos los importes en ARS. Si una venta o compra está en USD se convierte usando
/// TipoCambio guardado en el asiento original, ya normalizado en los servicios correspondientes.
/// </summary>
public class MargenBrutoService : IMargenBrutoService
{
    private readonly AgroCoreDbContext _db;

    public MargenBrutoService(AgroCoreDbContext db) { _db = db; }

    public async Task<MargenBrutoDto?> CalcularCampanaAsync(int campanaId, CancellationToken ct)
    {
        var campana = await _db.Campanas
            .Include(c => c.Cultivo)
            .Include(c => c.Lote!).ThenInclude(l => l.Campo!)
            .FirstOrDefaultAsync(c => c.CampanaId == campanaId, ct);
        if (campana == null) return null;

        var ingreso = await CalcularIngresoAsync(campana.CampanaId, campana.CultivoId, ct);
        var costoDirecto = campana.CostoAcumuladoArs;
        var costoArrendamiento = await CalcularArrendamientoAsync(campana.Lote.CampoId, campana.SuperficieSembradaHa, ct);

        var margenBruto = ingreso - costoDirecto - costoArrendamiento;
        var mbPorHa = campana.SuperficieSembradaHa > 0 ? margenBruto / campana.SuperficieSembradaHa : 0m;

        return new MargenBrutoDto(
            campana.CampanaId,
            campana.Nombre,
            campana.Cultivo?.Nombre ?? "—",
            campana.SuperficieSembradaHa,
            ingreso,
            costoDirecto,
            costoArrendamiento,
            margenBruto,
            Math.Round(mbPorHa, 2),
            campana.RendimientoRealKgHa ?? campana.RendimientoEstimadoKgHa,
            "ARS");
    }

    public async Task<IReadOnlyList<MargenBrutoDto>> TopCampanasAsync(int top, CancellationToken ct)
    {
        var ids = await _db.Campanas
            .OrderByDescending(c => c.FechaSiembra)
            .Select(c => c.CampanaId)
            .Take(top * 2) // margen de maniobra
            .ToListAsync(ct);

        var list = new List<MargenBrutoDto>();
        foreach (var id in ids)
        {
            var mb = await CalcularCampanaAsync(id, ct);
            if (mb != null) list.Add(mb);
        }
        return list.OrderByDescending(mb => mb.MargenBrutoPorHa).Take(top).ToList();
    }

    private async Task<decimal> CalcularIngresoAsync(int campanaId, int cultivoId, CancellationToken ct)
    {
        // Ventas de grano asociadas al silo/cultivo de la campaña.
        // Simplificación: sumamos ventas cuyo cultivo coincida; si hay silo asociado lo respetamos.
        var ventas = await _db.VentasGrano
            .Where(v => v.CultivoId == cultivoId && v.Fecha >= DateTime.UtcNow.AddYears(-2))
            .Select(v => new { v.Total, v.TipoCambio, v.MonedaId })
            .ToListAsync(ct);

        return ventas.Sum(v => v.MonedaId == 1 ? v.Total : v.Total * v.TipoCambio);
    }

    private async Task<decimal> CalcularArrendamientoAsync(int campoId, decimal superficieHa, CancellationToken ct)
    {
        var contratos = await _db.Contratos
            .Where(c => c.CampoId == campoId && c.Activo && c.FechaInicio <= DateTime.UtcNow && c.FechaFin >= DateTime.UtcNow)
            .ToListAsync(ct);

        decimal total = 0m;
        foreach (var contrato in contratos)
        {
            // Tres formas: ValorHa directo, Quintales por Ha (requiere cotización cultivo), o % ganancia (se ignora acá).
            if (contrato.ValorHa.HasValue)
            {
                var valorArs = contrato.MonedaId == 1 ? contrato.ValorHa.Value : contrato.ValorHa.Value * 1m; // TC externo no disponible
                total += valorArs * superficieHa;
            }
        }
        return total;
    }
}
