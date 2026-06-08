namespace AgroCore.Domain.Entities;

public class ContratoArrendamiento : TenantEntityBase
{
    public int ContratoArrendamientoId { get; set; }
    public int CampoId { get; set; }
    public string NumeroContrato { get; set; } = null!;
    public string ArrendadorNombre { get; set; } = null!;
    public string? ArrendadorCuit { get; set; }
    public string TipoContrato { get; set; } = null!; // Fijo/PorQuintales/Porcentaje/Mixto
    public DateTime FechaInicio { get; set; }
    public DateTime FechaFin { get; set; }
    public decimal SuperficieHa { get; set; }
    public decimal? ValorHa { get; set; }
    public decimal? QuintalesPorHa { get; set; }
    public int? CultivoReferenciaId { get; set; }
    public decimal? PorcentajeGanancia { get; set; }
    public byte MonedaId { get; set; } = 1;
    public string? FrecuenciaPago { get; set; } // Mensual, Anual, Cosecha
    public string? Observaciones { get; set; }
    public int? AdjuntoId { get; set; }
    public bool Activo { get; set; } = true;
}

public class MovimientoArrendamiento : TenantEntityBase
{
    public int MovimientoArrendamientoId { get; set; }
    public int ContratoArrendamientoId { get; set; }
    public DateTime Fecha { get; set; }
    public string Concepto { get; set; } = null!;
    public decimal Importe { get; set; }
    public byte MonedaId { get; set; } = 1;
    public decimal TipoCambio { get; set; } = 1;
    public string? MedioPago { get; set; }
    public int? MovimientoCajaId { get; set; }
    public string? Observaciones { get; set; }
}

public class Empleado : TenantEntityBase
{
    public int EmpleadoId { get; set; }
    public string Legajo { get; set; } = null!;
    public string Apellido { get; set; } = null!;
    public string Nombre { get; set; } = null!;
    public string? Dni { get; set; }
    public string? Cuil { get; set; }
    public DateTime? FechaIngreso { get; set; }
    public DateTime? FechaBaja { get; set; }
    public string? Puesto { get; set; }
    public string? Categoria { get; set; }
    public decimal? SueldoBasico { get; set; }
    public byte MonedaId { get; set; } = 1;
    public string? Telefono { get; set; }
    public string? Email { get; set; }
    public string? Direccion { get; set; }
    public string? Observaciones { get; set; }
    public bool Activo { get; set; } = true;
}

public class Liquidacion : TenantEntityBase
{
    public int LiquidacionId { get; set; }
    public int EmpleadoId { get; set; }
    public int Anio { get; set; }
    public int Mes { get; set; }
    public string? Concepto { get; set; } // Sueldo, Aguinaldo, Vacaciones, Bonus
    public decimal SueldoBruto { get; set; }
    public decimal Descuentos { get; set; }
    public decimal Aportes { get; set; }
    public decimal SueldoNeto { get; set; }
    public byte MonedaId { get; set; } = 1;
    public DateTime? FechaPago { get; set; }
    public string? MedioPago { get; set; }
    public int? MovimientoCajaId { get; set; }
    public string? Observaciones { get; set; }
    public int? AdjuntoId { get; set; }
}

public class ViajeCamion : TenantEntityBase
{
    public int ViajeCamionId { get; set; }
    public DateTime Fecha { get; set; }
    public string? NumeroCartaPorte { get; set; }
    public string? DominioTractor { get; set; }
    public string? DominioAcoplado { get; set; }
    public string? ChoferNombre { get; set; }
    public string? ChoferCuil { get; set; }
    public string? TransportistaRazonSocial { get; set; }
    public string? TransportistaCuit { get; set; }
    public int? OrigenCampoId { get; set; }
    public string? DestinoRazonSocial { get; set; }
    public string? DestinoPlanta { get; set; }
    public int? ClienteId { get; set; }
    public int? CultivoId { get; set; }
    public decimal? KgOrigen { get; set; }
    public decimal? KgDestino { get; set; }
    public decimal? Merma { get; set; }
    public decimal? HumedadOrigen { get; set; }
    public decimal? HumedadDestino { get; set; }
    public decimal? TarifaKm { get; set; }
    public decimal? TarifaTn { get; set; }
    public decimal? FleteTotal { get; set; }
    public byte MonedaId { get; set; } = 1;
    public string Estado { get; set; } = "EnTransito"; // EnTransito/Entregado/Descargado/Liquidado
    public string? Observaciones { get; set; }
    public int? AdjuntoId { get; set; }
}
