using AgroCore.Api.Middleware;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Domain.Entities;
using AgroCore.Domain.Enums;
using AgroCore.Infrastructure.Persistence;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Application.Services;

public class TesoreriaService : ITesoreriaService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public TesoreriaService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<PagedResult<MovimientoCajaDto>> ListarMovimientosAsync(int page, int pageSize, DateTime? desde, DateTime? hasta, string? tipo, byte? monedaId, CancellationToken ct)
    {
        var q = _db.MovimientosCaja.AsQueryable();
        if (desde.HasValue) q = q.Where(m => m.Fecha >= desde.Value);
        if (hasta.HasValue) q = q.Where(m => m.Fecha <= hasta.Value);
        if (!string.IsNullOrWhiteSpace(tipo)) q = q.Where(m => m.Tipo == tipo);
        if (monedaId.HasValue) q = q.Where(m => m.MonedaId == monedaId);

        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(m => m.Fecha)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(m => new MovimientoCajaDto(m.MovimientoCajaId, m.Fecha, m.Tipo, m.MedioPago, m.Concepto,
                m.MonedaId, m.TipoCambio, m.Importe, m.ImporteArs))
            .ToListAsync(ct);
        return new PagedResult<MovimientoCajaDto>(items, total, page, pageSize);
    }

    public async Task<int> CrearMovimientoAsync(MovimientoCajaCreateDto dto, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("No autenticado.");
        var empresaId = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");

        var importeArs = dto.MonedaId == 1 ? dto.Importe : Math.Round(dto.Importe * dto.TipoCambio, 4);

        var m = new MovimientoCaja
        {
            GrupoId = grupoId, EmpresaId = empresaId,
            Fecha = dto.Fecha, Tipo = dto.Tipo, MedioPago = dto.MedioPago,
            CuentaOrigenId = dto.CuentaOrigenId, CuentaDestinoId = dto.CuentaDestinoId,
            CategoriaId = dto.CategoriaId,
            MonedaId = dto.MonedaId, TipoCambio = dto.TipoCambio,
            Importe = dto.Importe, ImporteArs = importeArs,
            Concepto = dto.Concepto,
            ProveedorId = dto.ProveedorId, ClienteId = dto.ClienteId,
            EmpleadoId = dto.EmpleadoId, ChequeId = dto.ChequeId,
            ComprobanteId = dto.ComprobanteId, Observaciones = dto.Observaciones
        };
        _db.MovimientosCaja.Add(m);

        // Actualizar saldo cuenta corriente si aplica
        if (dto.ClienteId.HasValue || dto.ProveedorId.HasValue)
        {
            var tipoCC = dto.ClienteId.HasValue ? "Cliente" : "Proveedor";
            var cta = await _db.CuentasCorrientes.FirstOrDefaultAsync(c =>
                c.Tipo == tipoCC &&
                c.ClienteId == dto.ClienteId && c.ProveedorId == dto.ProveedorId &&
                c.MonedaId == dto.MonedaId, ct);
            if (cta == null)
            {
                cta = new CuentaCorriente
                {
                    GrupoId = grupoId, EmpresaId = empresaId,
                    Tipo = tipoCC, ClienteId = dto.ClienteId, ProveedorId = dto.ProveedorId,
                    MonedaId = dto.MonedaId
                };
                _db.CuentasCorrientes.Add(cta);
            }
            // Ingreso = cobro (cliente) / Egreso = pago (proveedor)
            var signo = (dto.Tipo == "Ingreso" && dto.ClienteId.HasValue) ||
                         (dto.Tipo == "Egreso" && dto.ProveedorId.HasValue) ? -1 : 1;
            cta.Saldo += signo * dto.Importe;
            cta.UltimaActualizacion = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        return m.MovimientoCajaId;
    }

    public async Task<decimal[]> SaldosAsync(CancellationToken ct)
    {
        var ars = await _db.MovimientosCaja.Where(m => m.MonedaId == 1)
            .SumAsync(m => m.Tipo == "Ingreso" ? m.Importe : -m.Importe, ct);
        var usd = await _db.MovimientosCaja.Where(m => m.MonedaId == 2)
            .SumAsync(m => m.Tipo == "Ingreso" ? m.Importe : -m.Importe, ct);
        return new[] { ars, usd };
    }

    public async Task<object> FlujoFondosAsync(DateTime desde, DateTime hasta, CancellationToken ct)
    {
        var datos = await _db.MovimientosCaja
            .Where(m => m.Fecha >= desde && m.Fecha <= hasta)
            .GroupBy(m => new { Anio = m.Fecha.Year, Mes = m.Fecha.Month, m.MonedaId })
            .Select(g => new
            {
                g.Key.Anio, g.Key.Mes, g.Key.MonedaId,
                Ingresos = g.Where(x => x.Tipo == "Ingreso").Sum(x => x.Importe),
                Egresos  = g.Where(x => x.Tipo == "Egreso").Sum(x => x.Importe),
                Neto     = g.Sum(x => x.Tipo == "Ingreso" ? x.Importe : -x.Importe)
            })
            .OrderBy(x => x.Anio).ThenBy(x => x.Mes)
            .ToListAsync(ct);
        return new { desde, hasta, series = datos };
    }
}

public class ChequeService : IChequeService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public ChequeService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<PagedResult<ChequeDto>> ListarAsync(int page, int pageSize, string? tipo, string? estado, DateTime? vtoDesde, DateTime? vtoHasta, CancellationToken ct)
    {
        var q = _db.Cheques.AsQueryable();
        if (!string.IsNullOrWhiteSpace(tipo))   q = q.Where(c => c.Tipo == tipo);
        if (!string.IsNullOrWhiteSpace(estado)) q = q.Where(c => c.Estado == estado);
        if (vtoDesde.HasValue) q = q.Where(c => c.FechaVencimiento >= vtoDesde);
        if (vtoHasta.HasValue) q = q.Where(c => c.FechaVencimiento <= vtoHasta);

        var total = await q.CountAsync(ct);
        var items = await q.OrderBy(c => c.FechaVencimiento)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(c => new ChequeDto(c.ChequeId, c.Tipo, c.Numero, c.Banco, c.Titular,
                c.FechaEmision, c.FechaVencimiento, c.MonedaId, c.Importe, c.Estado))
            .ToListAsync(ct);
        return new PagedResult<ChequeDto>(items, total, page, pageSize);
    }

    public async Task<int> CrearAsync(ChequeCreateDto dto, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("No autenticado.");
        var empresaId = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");
        var c = new Cheque
        {
            GrupoId = grupoId, EmpresaId = empresaId,
            Tipo = dto.Tipo, Numero = dto.Numero, Banco = dto.Banco, Sucursal = dto.Sucursal,
            Titular = dto.Titular, CuitTitular = dto.CuitTitular,
            FechaEmision = dto.FechaEmision, FechaVencimiento = dto.FechaVencimiento,
            MonedaId = dto.MonedaId, Importe = dto.Importe,
            ClienteOrigenId = dto.ClienteOrigenId, Observaciones = dto.Observaciones
        };
        _db.Cheques.Add(c);
        await _db.SaveChangesAsync(ct);
        return c.ChequeId;
    }

    public async Task CambiarEstadoAsync(int id, ChequeCambioEstadoDto dto, CancellationToken ct)
    {
        var c = await _db.Cheques.FirstOrDefaultAsync(x => x.ChequeId == id, ct)
                ?? throw ApiException.NotFound("Cheque no encontrado.");
        c.Estado = dto.NuevoEstado;
        if (dto.NuevoEstado == EstadoCheque.Acreditado.ToString())
            c.FechaAcreditacion = dto.Fecha ?? DateTime.UtcNow;
        if (dto.NuevoEstado == EstadoCheque.Endosado.ToString())
            c.ProveedorEndosadoId = dto.ProveedorEndosadoId;
        if (!string.IsNullOrWhiteSpace(dto.Observaciones))
            c.Observaciones = (c.Observaciones ?? "") + $" | {DateTime.UtcNow:u}: {dto.Observaciones}";
        await _db.SaveChangesAsync(ct);
    }
}

public class CuentaCorrienteService : ICuentaCorrienteService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    public CuentaCorrienteService(AgroCoreDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    public async Task<IReadOnlyList<CuentaCorrienteDto>> ListarAsync(string? tipo, CancellationToken ct)
    {
        var q = _db.CuentasCorrientes.AsQueryable();
        if (!string.IsNullOrWhiteSpace(tipo)) q = q.Where(c => c.Tipo == tipo);

        return await q
            .Select(c => new CuentaCorrienteDto(
                c.CuentaCorrienteId, c.Tipo, c.ClienteId, c.ProveedorId,
                c.ClienteId.HasValue ? _db.Clientes.Where(cl => cl.ClienteId == c.ClienteId).Select(cl => cl.RazonSocial).FirstOrDefault()!
                                      : _db.Proveedores.Where(p => p.ProveedorId == c.ProveedorId).Select(p => p.RazonSocial).FirstOrDefault()!,
                c.MonedaId, c.Saldo))
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<CuentaMovimientoDto>> MovimientosAsync(int cuentaCorrienteId, DateTime? desde, DateTime? hasta, CancellationToken ct)
    {
        var q = _db.CuentasMovimiento.Where(m => m.CuentaCorrienteId == cuentaCorrienteId);
        if (desde.HasValue) q = q.Where(m => m.Fecha >= desde);
        if (hasta.HasValue) q = q.Where(m => m.Fecha <= hasta);
        return await q.OrderBy(m => m.Fecha)
            .Select(m => new CuentaMovimientoDto(m.CuentaMovimientoId, m.Fecha, m.Tipo, m.Concepto, m.Importe, m.NumeroComprobante))
            .ToListAsync(ct);
    }

    public async Task<int> CrearMovimientoAsync(CuentaMovimientoCreateDto dto, CancellationToken ct)
    {
        var cta = await _db.CuentasCorrientes.FirstOrDefaultAsync(c => c.CuentaCorrienteId == dto.CuentaCorrienteId, ct)
                  ?? throw ApiException.NotFound("Cuenta corriente no existe.");
        var m = new CuentaMovimiento
        {
            GrupoId = cta.GrupoId, EmpresaId = cta.EmpresaId,
            CuentaCorrienteId = cta.CuentaCorrienteId,
            Fecha = dto.Fecha, Tipo = dto.Tipo, Concepto = dto.Concepto,
            Importe = dto.Importe, NumeroComprobante = dto.NumeroComprobante,
            ComprobanteId = dto.ComprobanteId, MovimientoCajaId = dto.MovimientoCajaId
        };
        _db.CuentasMovimiento.Add(m);
        cta.Saldo += dto.Tipo == "Debe" ? dto.Importe : -dto.Importe;
        cta.UltimaActualizacion = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return m.CuentaMovimientoId;
    }
}
