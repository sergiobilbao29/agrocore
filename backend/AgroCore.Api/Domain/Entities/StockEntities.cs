using AgroCore.Domain.Enums;

namespace AgroCore.Domain.Entities;

public class Insumo : TenantEntityBase
{
    public int InsumoId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Nombre { get; set; } = null!;
    public string TipoInsumo { get; set; } = null!; // Semilla/Fertilizante/Herbicida/...
    public string UnidadMedida { get; set; } = null!; // kg, lt, un, bolsa
    public string? Marca { get; set; }
    public decimal? PrincipioActivoPorcentaje { get; set; }
    public decimal StockMinimo { get; set; }
    public decimal StockActual { get; set; }
    public byte MonedaCostoId { get; set; } = 1;
    public decimal? CostoUltimo { get; set; }
    public decimal? CostoPromedio { get; set; }
    public string? Observaciones { get; set; }
    public bool Activo { get; set; } = true;
}

public class Proveedor : TenantEntityBase
{
    public int ProveedorId { get; set; }
    public string Codigo { get; set; } = null!;
    public string RazonSocial { get; set; } = null!;
    public string? Cuit { get; set; }
    public string? CondicionIva { get; set; }
    public string? Direccion { get; set; }
    public string? Localidad { get; set; }
    public string? Provincia { get; set; }
    public string? Telefono { get; set; }
    public string? Email { get; set; }
    public string? Rubro { get; set; }
    public string? Observaciones { get; set; }
    public bool Activo { get; set; } = true;
}

public class Cliente : TenantEntityBase
{
    public int ClienteId { get; set; }
    public string Codigo { get; set; } = null!;
    public string RazonSocial { get; set; } = null!;
    public string? Cuit { get; set; }
    public string? CondicionIva { get; set; }
    public string? Direccion { get; set; }
    public string? Localidad { get; set; }
    public string? Provincia { get; set; }
    public string? Telefono { get; set; }
    public string? Email { get; set; }
    public string? Observaciones { get; set; }
    public bool Activo { get; set; } = true;
}

public class CompraInsumo : TenantEntityBase
{
    public int CompraInsumoId { get; set; }
    public int ProveedorId { get; set; }
    public DateTime Fecha { get; set; }
    public string? NumeroComprobante { get; set; }
    public string? TipoComprobante { get; set; }
    public byte MonedaId { get; set; }
    public decimal TipoCambio { get; set; } = 1;
    public decimal Subtotal { get; set; }
    public decimal Iva { get; set; }
    public decimal Percepciones { get; set; }
    public decimal Total { get; set; }
    public string? MedioPago { get; set; }
    public string? Observaciones { get; set; }
    public int? AdjuntoId { get; set; } // factura/remito escaneado

    public Proveedor Proveedor { get; set; } = null!;
    public ICollection<CompraInsumoDetalle> Detalles { get; set; } = new List<CompraInsumoDetalle>();
}

public class CompraInsumoDetalle
{
    public int CompraInsumoDetalleId { get; set; }
    public int CompraInsumoId { get; set; }
    public int InsumoId { get; set; }
    public decimal Cantidad { get; set; }
    public decimal PrecioUnitario { get; set; }
    public decimal Descuento { get; set; }
    public decimal Subtotal { get; set; }

    public CompraInsumo CompraInsumo { get; set; } = null!;
    public Insumo Insumo { get; set; } = null!;
}

public class MovimientoStockInsumo : TenantEntityBase
{
    public int MovimientoStockInsumoId { get; set; }
    public int InsumoId { get; set; }
    public DateTime Fecha { get; set; }
    public int Tipo { get; set; } // TipoMovimientoStock: 1 ingreso, -1 egreso, 0 ajuste
    public decimal Cantidad { get; set; } // siempre positivo; el signo lo da Tipo
    public decimal CostoUnitario { get; set; }
    public string? Motivo { get; set; } // Compra, Consumo OT, Ajuste inventario, Traslado
    public int? CompraInsumoId { get; set; }
    public int? OrdenTrabajoId { get; set; }
    public string? Observaciones { get; set; }

    public Insumo Insumo { get; set; } = null!;
}
