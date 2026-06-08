using AgroCore.Api.Middleware;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Domain.Entities;
using AgroCore.Domain.Enums;
using AgroCore.Infrastructure.Persistence;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Application.Services;

/// <summary>
/// Corazón del MVP: planificación + ejecución de labor + consumo real de insumos + costeo.
/// </summary>
public class OrdenTrabajoService : IOrdenTrabajoService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public OrdenTrabajoService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<PagedResult<OrdenTrabajoDto>> ListarAsync(int page, int pageSize, int? loteId, int? campanaId, string? estado, DateTime? desde, DateTime? hasta, CancellationToken ct)
    {
        var q = _db.OrdenesTrabajo
            .Include(o => o.Lote)
            .Include(o => o.Campana)
            .Include(o => o.Maquinaria)
            .Include(o => o.Operario)
            .AsQueryable();
        if (loteId.HasValue)    q = q.Where(o => o.LoteId == loteId);
        if (campanaId.HasValue) q = q.Where(o => o.CampanaId == campanaId);
        if (!string.IsNullOrWhiteSpace(estado)) q = q.Where(o => o.Estado == estado);
        if (desde.HasValue) q = q.Where(o => o.FechaPlanificada >= desde.Value);
        if (hasta.HasValue) q = q.Where(o => o.FechaPlanificada <= hasta.Value);

        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(o => o.FechaPlanificada)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(o => new OrdenTrabajoDto(
                o.OrdenTrabajoId, o.Numero, o.LoteId, o.Lote.Nombre, o.CampanaId,
                o.Campana != null ? o.Campana.Nombre : null,
                o.TipoLabor, o.FechaPlanificada, o.FechaInicio, o.FechaFin, o.SuperficieHa, o.Estado,
                o.MaquinariaId, o.Maquinaria != null ? o.Maquinaria.Descripcion : null,
                o.OperarioId, o.Operario != null ? (o.Operario.Apellido + ", " + o.Operario.Nombre) : null,
                o.CostoTotalArs, o.CostoTotalUsd))
            .ToListAsync(ct);
        return new PagedResult<OrdenTrabajoDto>(items, total, page, pageSize);
    }

    public async Task<OrdenTrabajoDetalleDto?> ObtenerAsync(int id, CancellationToken ct)
    {
        var o = await _db.OrdenesTrabajo
            .Include(x => x.Lote)
            .Include(x => x.Campana)
            .Include(x => x.Maquinaria)
            .Include(x => x.Operario)
            .Include(x => x.Insumos).ThenInclude(i => i.Insumo)
            .Include(x => x.Costos)
            .FirstOrDefaultAsync(x => x.OrdenTrabajoId == id, ct);
        if (o is null) return null;

        var cabecera = new OrdenTrabajoDto(
            o.OrdenTrabajoId, o.Numero, o.LoteId, o.Lote.Nombre, o.CampanaId,
            o.Campana?.Nombre, o.TipoLabor, o.FechaPlanificada, o.FechaInicio, o.FechaFin,
            o.SuperficieHa, o.Estado,
            o.MaquinariaId, o.Maquinaria?.Descripcion,
            o.OperarioId, o.Operario != null ? $"{o.Operario.Apellido}, {o.Operario.Nombre}" : null,
            o.CostoTotalArs, o.CostoTotalUsd);

        var insumos = o.Insumos.Select(i => new OrdenTrabajoInsumoDto(
            i.OrdenTrabajoInsumoId, i.InsumoId, i.Insumo.Nombre, i.Insumo.UnidadMedida,
            i.PlanCantidad, i.RealCantidad, i.PlanCostoUnitario, i.RealCostoUnitario, i.MonedaId)).ToList();

        var costos = o.Costos.Select(c => new OrdenTrabajoCostoDto(
            c.OrdenTrabajoCostoId, c.Concepto, c.Cantidad, c.PrecioUnitario,
            c.MonedaId, c.TipoCambio, c.ImporteTotal)).ToList();

        return new OrdenTrabajoDetalleDto(cabecera, insumos, costos);
    }

    public async Task<int> CrearAsync(OrdenTrabajoCreateDto dto, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("No autenticado.");
        var empresaId = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");

        var lote = await _db.Lotes.FirstOrDefaultAsync(l => l.LoteId == dto.LoteId, ct)
                   ?? throw ApiException.NotFound("Lote no existe.");
        if (dto.SuperficieHa > lote.SuperficieHa)
            throw ApiException.BadRequest("Superficie mayor a la del lote.");

        var numero = await GenerarNumeroOtAsync(empresaId, dto.FechaPlanificada.Year, ct);

        var ot = new OrdenTrabajo
        {
            GrupoId = grupoId, EmpresaId = empresaId,
            CampanaId = dto.CampanaId, LoteId = dto.LoteId,
            MaquinariaId = dto.MaquinariaId, OperarioId = dto.OperarioId,
            Numero = numero, TipoLabor = dto.TipoLabor,
            FechaPlanificada = dto.FechaPlanificada,
            SuperficieHa = dto.SuperficieHa,
            Estado = EstadoOrden.Planificada.ToString(),
            ObservacionesPlan = dto.ObservacionesPlan,
            Insumos = dto.Insumos.Select(i => new OrdenTrabajoInsumo
            {
                InsumoId = i.InsumoId, PlanCantidad = i.PlanCantidad,
                PlanCostoUnitario = i.PlanCostoUnitario, MonedaId = i.MonedaId
            }).ToList(),
            Costos = dto.Costos.Select(c => new OrdenTrabajoCosto
            {
                Concepto = c.Concepto, Cantidad = c.Cantidad,
                PrecioUnitario = c.PrecioUnitario, MonedaId = c.MonedaId,
                TipoCambio = c.TipoCambio,
                ImporteTotal = Math.Round(c.Cantidad * c.PrecioUnitario, 4)
            }).ToList()
        };
        _db.OrdenesTrabajo.Add(ot);
        await _db.SaveChangesAsync(ct);
        return ot.OrdenTrabajoId;
    }

    public async Task EjecutarAsync(int id, OrdenTrabajoEjecutarDto dto, CancellationToken ct)
    {
        var ot = await _db.OrdenesTrabajo
            .Include(x => x.Insumos).ThenInclude(i => i.Insumo)
            .Include(x => x.Costos)
            .FirstOrDefaultAsync(x => x.OrdenTrabajoId == id, ct)
            ?? throw ApiException.NotFound("Orden no encontrada.");

        if (ot.Estado == EstadoOrden.Cancelada.ToString())
            throw ApiException.BadRequest("La orden está cancelada.");

        ot.FechaInicio = dto.FechaInicio;
        ot.FechaFin = dto.FechaFin;
        ot.HorasMaquina = dto.HorasMaquina;
        ot.LitrosCombustible = dto.LitrosCombustible;
        ot.VelocidadKmH = dto.VelocidadKmH;
        ot.DosisPorHa = dto.DosisPorHa;
        ot.CondicionesClimaticas = dto.CondicionesClimaticas;
        ot.ObservacionesReal = dto.ObservacionesReal;
        ot.GeoJsonTraza = dto.GeoJsonTraza;
        ot.Estado = dto.FechaFin.HasValue ? EstadoOrden.Finalizada.ToString() : EstadoOrden.EnEjecucion.ToString();

        // Consumo real de insumos: descuenta stock y registra movimiento
        foreach (var det in dto.InsumosReales)
        {
            var link = ot.Insumos.FirstOrDefault(i => i.OrdenTrabajoInsumoId == det.OrdenTrabajoInsumoId)
                       ?? throw ApiException.BadRequest($"Insumo de OT {det.OrdenTrabajoInsumoId} no pertenece a la orden.");
            link.RealCantidad = det.RealCantidad;
            link.RealCostoUnitario = det.RealCostoUnitario ?? link.Insumo.CostoPromedio;

            if (link.Insumo.StockActual < det.RealCantidad)
                throw ApiException.BadRequest($"Stock insuficiente para {link.Insumo.Nombre}. Disponible {link.Insumo.StockActual} {link.Insumo.UnidadMedida}.");

            link.Insumo.StockActual -= det.RealCantidad;

            _db.MovimientosStockInsumo.Add(new MovimientoStockInsumo
            {
                GrupoId = ot.GrupoId, EmpresaId = ot.EmpresaId,
                InsumoId = link.InsumoId, Fecha = dto.FechaInicio,
                Tipo = (int)TipoMovimientoStock.Egreso,
                Cantidad = det.RealCantidad,
                CostoUnitario = link.RealCostoUnitario ?? 0m,
                Motivo = $"Consumo OT {ot.Numero}",
                OrdenTrabajoId = ot.OrdenTrabajoId
            });
        }

        // Costos adicionales (labor contratada, combustible extra, etc.)
        if (dto.CostosAdicionales != null)
        {
            foreach (var c in dto.CostosAdicionales)
            {
                ot.Costos.Add(new OrdenTrabajoCosto
                {
                    OrdenTrabajoId = ot.OrdenTrabajoId,
                    Concepto = c.Concepto, Cantidad = c.Cantidad,
                    PrecioUnitario = c.PrecioUnitario, MonedaId = c.MonedaId,
                    TipoCambio = c.TipoCambio,
                    ImporteTotal = Math.Round(c.Cantidad * c.PrecioUnitario, 4)
                });
            }
        }

        // Calcular costo total de la OT (insumos reales + costos)
        var insumosCostoArs = ot.Insumos
            .Where(i => i.RealCantidad.HasValue && i.RealCostoUnitario.HasValue)
            .Sum(i => (i.RealCantidad!.Value * i.RealCostoUnitario!.Value) * (i.MonedaId == 1 ? 1 : GetTcOr1(i.MonedaId)));
        var costosArs = ot.Costos.Sum(c => c.ImporteTotal * (c.MonedaId == 1 ? 1 : c.TipoCambio == 0 ? 1 : c.TipoCambio));
        ot.CostoTotalArs = Math.Round(insumosCostoArs + costosArs, 4);

        // Acumular a la campaña
        if (ot.CampanaId.HasValue)
        {
            var camp = await _db.Campanas.FirstOrDefaultAsync(c => c.CampanaId == ot.CampanaId.Value, ct);
            if (camp != null) camp.CostoAcumuladoArs += ot.CostoTotalArs!.Value;
        }

        await _db.SaveChangesAsync(ct);
    }

    public async Task FinalizarAsync(int id, CancellationToken ct)
    {
        var ot = await _db.OrdenesTrabajo.FirstOrDefaultAsync(x => x.OrdenTrabajoId == id, ct)
                 ?? throw ApiException.NotFound("Orden no encontrada.");
        if (!ot.FechaInicio.HasValue) throw ApiException.BadRequest("La orden no fue iniciada.");
        ot.FechaFin ??= DateTime.UtcNow;
        ot.Estado = EstadoOrden.Finalizada.ToString();
        await _db.SaveChangesAsync(ct);
    }

    public async Task CancelarAsync(int id, string motivo, CancellationToken ct)
    {
        var ot = await _db.OrdenesTrabajo.FirstOrDefaultAsync(x => x.OrdenTrabajoId == id, ct)
                 ?? throw ApiException.NotFound("Orden no encontrada.");
        if (ot.Estado == EstadoOrden.Finalizada.ToString())
            throw ApiException.BadRequest("No se puede cancelar una OT finalizada.");
        ot.Estado = EstadoOrden.Cancelada.ToString();
        ot.ObservacionesReal = $"[CANCELADA] {motivo} — {ot.ObservacionesReal}";
        await _db.SaveChangesAsync(ct);
    }

    private async Task<string> GenerarNumeroOtAsync(int empresaId, int anio, CancellationToken ct)
    {
        var prefix = $"OT-{anio:0000}-";
        var max = await _db.OrdenesTrabajo.IgnoreQueryFilters()
            .Where(o => o.EmpresaId == empresaId && o.Numero.StartsWith(prefix))
            .Select(o => o.Numero).ToListAsync(ct);
        var next = max.Select(n => int.TryParse(n[prefix.Length..], out var i) ? i : 0).DefaultIfEmpty(0).Max() + 1;
        return $"{prefix}{next:0000}";
    }

    private decimal GetTcOr1(byte monedaId)
    {
        // Tomar el último tipo de cambio oficial de la moneda; por simplicidad, 1 si no hay.
        return _db.TiposCambio.Where(t => t.MonedaId == monedaId)
            .OrderByDescending(t => t.Fecha)
            .Select(t => t.CotizacionOficial ?? 1m).FirstOrDefault() is var v && v > 0 ? v : 1m;
    }
}
