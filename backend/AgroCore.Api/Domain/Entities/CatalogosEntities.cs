namespace AgroCore.Domain.Entities;

public class Moneda
{
    public byte MonedaId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Nombre { get; set; } = null!;
    public string Simbolo { get; set; } = null!;
}

public class TipoCambio
{
    public int TipoCambioId { get; set; }
    public DateTime Fecha { get; set; }
    public byte MonedaId { get; set; }
    public decimal? CotizacionOficial { get; set; }
    public decimal? CotizacionBlue { get; set; }
    public decimal? CotizacionMep { get; set; }
    public decimal? CotizacionCcl { get; set; }
    public string? Fuente { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Moneda Moneda { get; set; } = null!;
}

public class Categoria
{
    public int CategoriaId { get; set; }
    public int GrupoId { get; set; }
    public string Tipo { get; set; } = null!;
    public string Codigo { get; set; } = null!;
    public string Nombre { get; set; } = null!;
    public string? Descripcion { get; set; }
    public bool Activo { get; set; } = true;
}
