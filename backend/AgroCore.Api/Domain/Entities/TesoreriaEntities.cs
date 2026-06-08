namespace AgroCore.Domain.Entities;

public class MovimientoCaja : TenantEntityBase
{
    public int MovimientoCajaId { get; set; }
    public DateTime Fecha { get; set; }
    public string Tipo { get; set; } = null!; // Ingreso/Egreso/Transferencia
    public string? MedioPago { get; set; }
    public int? CuentaOrigenId { get; set; }
    public int? CuentaDestinoId { get; set; }
    public int? CategoriaId { get; set; }
    public byte MonedaId { get; set; } = 1;
    public decimal TipoCambio { get; set; } = 1;
    public decimal Importe { get; set; }
    public decimal ImporteArs { get; set; }
    public string? Concepto { get; set; }
    public int? ProveedorId { get; set; }
    public int? ClienteId { get; set; }
    public int? EmpleadoId { get; set; }
    public int? ChequeId { get; set; }
    public int? ComprobanteId { get; set; }
    public string? Observaciones { get; set; }
}

public class Cheque : TenantEntityBase
{
    public int ChequeId { get; set; }
    public string Tipo { get; set; } = null!; // Propio/Tercero
    public string Numero { get; set; } = null!;
    public string? Banco { get; set; }
    public string? Sucursal { get; set; }
    public string? Titular { get; set; }
    public string? CuitTitular { get; set; }
    public DateTime FechaEmision { get; set; }
    public DateTime FechaVencimiento { get; set; }
    public byte MonedaId { get; set; } = 1;
    public decimal Importe { get; set; }
    public string Estado { get; set; } = "EnCartera"; // EnCartera/Depositado/Acreditado/Rechazado/Endosado/Anulado
    public DateTime? FechaAcreditacion { get; set; }
    public int? CuentaBancariaId { get; set; }
    public int? ProveedorEndosadoId { get; set; }
    public int? ClienteOrigenId { get; set; }
    public int? ComprobanteId { get; set; }
    public string? Observaciones { get; set; }
    public int? AdjuntoId { get; set; }
}

public class CuentaCorriente : TenantEntityBase
{
    public int CuentaCorrienteId { get; set; }
    public string Tipo { get; set; } = null!; // Cliente/Proveedor
    public int? ClienteId { get; set; }
    public int? ProveedorId { get; set; }
    public byte MonedaId { get; set; } = 1;
    public decimal Saldo { get; set; }
    public DateTime? UltimaActualizacion { get; set; }
}

public class CuentaMovimiento : TenantEntityBase
{
    public int CuentaMovimientoId { get; set; }
    public int CuentaCorrienteId { get; set; }
    public DateTime Fecha { get; set; }
    public string Tipo { get; set; } = null!; // Debe/Haber
    public string Concepto { get; set; } = null!;
    public decimal Importe { get; set; }
    public string? NumeroComprobante { get; set; }
    public int? ComprobanteId { get; set; }
    public int? MovimientoCajaId { get; set; }
    public string? Observaciones { get; set; }
}

public class MovimientoEfectivo : TenantEntityBase
{
    public int MovimientoEfectivoId { get; set; }
    public DateTime Fecha { get; set; }
    public byte MonedaId { get; set; } = 1;
    public decimal Ingresos { get; set; }
    public decimal Egresos { get; set; }
    public decimal SaldoCierre { get; set; }
    public int? UsuarioCierreId { get; set; }
    public string? Observaciones { get; set; }
}
