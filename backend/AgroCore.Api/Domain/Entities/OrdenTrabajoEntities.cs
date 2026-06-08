namespace AgroCore.Domain.Entities;

public class OrdenTrabajo : TenantEntityBase
{
    public int OrdenTrabajoId { get; set; }
    public int? CampanaId { get; set; }
    public int LoteId { get; set; }
    public int? MaquinariaId { get; set; }
    public int? OperarioId { get; set; }
    public string Numero { get; set; } = null!;           // OT-2025-0001
    public string TipoLabor { get; set; } = null!;        // Siembra/Pulverizacion/...
    public DateTime FechaPlanificada { get; set; }
    public DateTime? FechaInicio { get; set; }
    public DateTime? FechaFin { get; set; }
    public decimal SuperficieHa { get; set; }
    public string Estado { get; set; } = "Planificada";
    public decimal? HorasMaquina { get; set; }
    public decimal? LitrosCombustible { get; set; }
    public decimal? VelocidadKmH { get; set; }
    public decimal? DosisPorHa { get; set; }
    public string? CondicionesClimaticas { get; set; }    // temperatura, humedad, viento
    public decimal? CostoTotalArs { get; set; }
    public decimal? CostoTotalUsd { get; set; }
    public string? ObservacionesPlan { get; set; }
    public string? ObservacionesReal { get; set; }
    public string? GeoJsonTraza { get; set; }             // ruta del tractor/pulverizadora

    public Campana? Campana { get; set; }
    public Lote Lote { get; set; } = null!;
    public Maquinaria? Maquinaria { get; set; }
    public Empleado? Operario { get; set; }

    public ICollection<OrdenTrabajoInsumo> Insumos { get; set; } = new List<OrdenTrabajoInsumo>();
    public ICollection<OrdenTrabajoCosto> Costos { get; set; } = new List<OrdenTrabajoCosto>();
}

/// <summary>
/// Receta planificada (PlanCantidad) vs aplicación real (RealCantidad).
/// </summary>
public class OrdenTrabajoInsumo
{
    public int OrdenTrabajoInsumoId { get; set; }
    public int OrdenTrabajoId { get; set; }
    public int InsumoId { get; set; }
    public decimal PlanCantidad { get; set; }
    public decimal? RealCantidad { get; set; }
    public decimal? PlanCostoUnitario { get; set; }
    public decimal? RealCostoUnitario { get; set; }
    public byte MonedaId { get; set; } = 1;
    public string? Observaciones { get; set; }

    public OrdenTrabajo OrdenTrabajo { get; set; } = null!;
    public Insumo Insumo { get; set; } = null!;
}

/// <summary>
/// Costos no-insumo (mano de obra, labor contratada, combustible, otros).
/// </summary>
public class OrdenTrabajoCosto
{
    public int OrdenTrabajoCostoId { get; set; }
    public int OrdenTrabajoId { get; set; }
    public string Concepto { get; set; } = null!;
    public decimal Cantidad { get; set; }
    public decimal PrecioUnitario { get; set; }
    public byte MonedaId { get; set; } = 1;
    public decimal TipoCambio { get; set; } = 1;
    public decimal ImporteTotal { get; set; }
    public string? Observaciones { get; set; }

    public OrdenTrabajo OrdenTrabajo { get; set; } = null!;
}
