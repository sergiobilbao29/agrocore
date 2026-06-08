namespace AgroCore.Domain.Entities;

public class VentaGrano : TenantEntityBase
{
    public int VentaGranoId { get; set; }
    public int ClienteId { get; set; }
    public int CultivoId { get; set; }
    public int? SiloId { get; set; }
    public DateTime Fecha { get; set; }
    public string? NumeroContrato { get; set; }
    public decimal Kilogramos { get; set; }
    public decimal PrecioUnitarioPorTn { get; set; }
    public byte MonedaId { get; set; }
    public decimal TipoCambio { get; set; } = 1;
    public decimal Subtotal { get; set; }
    public decimal Comisiones { get; set; }
    public decimal Fletes { get; set; }
    public decimal Retenciones { get; set; }
    public decimal Iva { get; set; }
    public decimal Total { get; set; }
    public string? MedioPago { get; set; }
    public string? Observaciones { get; set; }
    public int? AdjuntoId { get; set; }

    public Cliente Cliente { get; set; } = null!;
}

public class VentaHacienda : TenantEntityBase
{
    public int VentaHaciendaId { get; set; }
    public int ClienteId { get; set; }
    public DateTime Fecha { get; set; }
    public string? NumeroRemito { get; set; }
    public int Cantidad { get; set; }
    public string? Categoria { get; set; }
    public decimal PesoTotalKg { get; set; }
    public decimal PrecioUnitarioPorKg { get; set; }
    public byte MonedaId { get; set; }
    public decimal TipoCambio { get; set; } = 1;
    public decimal Subtotal { get; set; }
    public decimal Comisiones { get; set; }
    public decimal Fletes { get; set; }
    public decimal Total { get; set; }
    public string? MedioPago { get; set; }
    public string? Observaciones { get; set; }

    public Cliente Cliente { get; set; } = null!;
}

public class VentaPyme : TenantEntityBase
{
    public int VentaPymeId { get; set; }
    public int? ClienteId { get; set; }
    public DateTime Fecha { get; set; }
    public string Concepto { get; set; } = null!;
    public decimal Cantidad { get; set; } = 1;
    public decimal PrecioUnitario { get; set; }
    public byte MonedaId { get; set; } = 1;
    public decimal TipoCambio { get; set; } = 1;
    public decimal Subtotal { get; set; }
    public decimal Iva { get; set; }
    public decimal Total { get; set; }
    public string? MedioPago { get; set; }
    public int? ComprobanteId { get; set; }
    public string? Observaciones { get; set; }
}
