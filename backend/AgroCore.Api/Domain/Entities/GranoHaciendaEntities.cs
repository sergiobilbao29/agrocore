namespace AgroCore.Domain.Entities;

public class Silo : TenantEntityBase
{
    public int SiloId { get; set; }
    public int? CampoId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Descripcion { get; set; } = null!;
    public decimal CapacidadTn { get; set; }
    public string? TipoEstructura { get; set; } // Silo, SiloBolsa, CeldaPlanta
    public string? Ubicacion { get; set; }
    public bool Activo { get; set; } = true;
}

public class StockGrano : TenantEntityBase
{
    public int StockGranoId { get; set; }
    public int SiloId { get; set; }
    public int CultivoId { get; set; }
    public int? CampanaId { get; set; }
    public decimal Kilogramos { get; set; }
    public decimal? HumedadPromedio { get; set; }
    public decimal? ImpurezaPromedio { get; set; }
    public decimal? ProteinaPromedio { get; set; }
    public decimal? CostoTotalArs { get; set; }
    public decimal? CostoTotalUsd { get; set; }
    public DateTime UltimaActualizacion { get; set; } = DateTime.UtcNow;
}

public class MovimientoGrano : TenantEntityBase
{
    public int MovimientoGranoId { get; set; }
    public int SiloId { get; set; }
    public int CultivoId { get; set; }
    public int? CampanaId { get; set; }
    public DateTime Fecha { get; set; }
    public string Tipo { get; set; } = null!; // Ingreso, Egreso, Ajuste, TrasladoSalida, TrasladoEntrada
    public decimal Kilogramos { get; set; }
    public decimal? Humedad { get; set; }
    public decimal? Impureza { get; set; }
    public string? NumeroCartaPorte { get; set; }
    public string? NumeroRomaneo { get; set; }
    public int? ClienteId { get; set; }
    public int? SiloDestinoId { get; set; }
    public int? OrdenTrabajoId { get; set; }
    public int? ViajeCamionId { get; set; }
    public string? Observaciones { get; set; }
}

public class Hacienda : TenantEntityBase
{
    public int HaciendaId { get; set; }
    public int? CampoId { get; set; }
    public string? CaravanaSenasa { get; set; }
    public string Categoria { get; set; } = null!; // Vaca/Toro/Ternero/Novillo
    public string? Raza { get; set; }
    public DateTime? FechaNacimiento { get; set; }
    public decimal? PesoActualKg { get; set; }
    public string? Sexo { get; set; }
    public string Estado { get; set; } = "Activo";
    public string? Observaciones { get; set; }
}

public class MovimientoHacienda : TenantEntityBase
{
    public int MovimientoHaciendaId { get; set; }
    public DateTime Fecha { get; set; }
    public string Tipo { get; set; } = null!; // Ingreso, Egreso, Venta, Muerte, Traslado, Parto, Pesaje
    public int? HaciendaId { get; set; }
    public string? Categoria { get; set; }
    public int Cantidad { get; set; } = 1;
    public decimal? PesoTotalKg { get; set; }
    public int? CampoOrigenId { get; set; }
    public int? CampoDestinoId { get; set; }
    public int? ClienteId { get; set; }
    public int? ProveedorId { get; set; }
    public string? Dte { get; set; } // DTe/DTA
    public string? Observaciones { get; set; }
}
