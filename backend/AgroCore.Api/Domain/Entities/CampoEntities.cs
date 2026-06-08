using AgroCore.Domain.Enums;

namespace AgroCore.Domain.Entities;

public class Campo : TenantEntityBase
{
    public int CampoId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Nombre { get; set; } = null!;
    public decimal SuperficieTotalHa { get; set; }
    public string? Localidad { get; set; }
    public string? Provincia { get; set; }
    public string? Renspa { get; set; }
    public string? GeoJson { get; set; }
    public bool Propio { get; set; } = true;
    public string? Observaciones { get; set; }
    public bool Activo { get; set; } = true;

    public Empresa Empresa { get; set; } = null!;
    public ICollection<Lote> Lotes { get; set; } = new List<Lote>();
}

public class Lote : TenantEntityBase
{
    public int LoteId { get; set; }
    public int CampoId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Nombre { get; set; } = null!;
    public decimal SuperficieHa { get; set; }
    public string? GeoJson { get; set; }
    public string? TipoSuelo { get; set; }
    public string? Aptitud { get; set; }
    public string? Observaciones { get; set; }
    public bool Activo { get; set; } = true;

    public Campo Campo { get; set; } = null!;
    public ICollection<Campana> Campanas { get; set; } = new List<Campana>();
}

public class Cultivo
{
    public int CultivoId { get; set; }
    public int GrupoId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Nombre { get; set; } = null!;
    public string? Especie { get; set; }
    public string? CicloDefault { get; set; }
    public bool Activo { get; set; } = true;
}

public class Campana : TenantEntityBase
{
    public int CampanaId { get; set; }
    public int LoteId { get; set; }
    public int CultivoId { get; set; }
    public string Nombre { get; set; } = null!; // ej: "Soja 2024/25"
    public DateTime? FechaSiembra { get; set; }
    public DateTime? FechaCosechaEstimada { get; set; }
    public DateTime? FechaCosechaReal { get; set; }
    public decimal SuperficieSembradaHa { get; set; }
    public decimal? RendimientoEstimadoKgHa { get; set; }
    public decimal? RendimientoRealKgHa { get; set; }
    public decimal? KgCosechadosTotales { get; set; }
    public decimal? HumedadPromedio { get; set; }
    public string Estado { get; set; } = EstadoCampana.Planificada.ToString();
    public decimal CostoAcumuladoArs { get; set; }
    public decimal CostoAcumuladoUsd { get; set; }
    public string? Observaciones { get; set; }

    public Lote Lote { get; set; } = null!;
    public Cultivo Cultivo { get; set; } = null!;
    public ICollection<OrdenTrabajo> OrdenesTrabajo { get; set; } = new List<OrdenTrabajo>();
}

public class Maquinaria : TenantEntityBase
{
    public int MaquinariaId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Descripcion { get; set; } = null!;
    public string? Tipo { get; set; } // Tractor, Pulverizadora, Cosechadora, Camion
    public string? Marca { get; set; }
    public string? Modelo { get; set; }
    public int? Anio { get; set; }
    public string? Patente { get; set; }
    public decimal? HorasTrabajo { get; set; }
    public bool Propia { get; set; } = true;
    public bool Activo { get; set; } = true;
}
