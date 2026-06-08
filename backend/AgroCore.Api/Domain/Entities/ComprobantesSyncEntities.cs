namespace AgroCore.Domain.Entities;

public class PuntoVenta : TenantEntityBase
{
    public int PuntoVentaId { get; set; }
    public int Numero { get; set; }
    public string Descripcion { get; set; } = null!;
    public string Tipo { get; set; } = "Fiscal"; // Fiscal/Interno
    public bool Activo { get; set; } = true;
}

public class ComprobanteTipo
{
    public byte ComprobanteTipoId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Nombre { get; set; } = null!;
    public string Letra { get; set; } = null!;
    public short? AfipCodigo { get; set; }
    public short Signo { get; set; } = 1;
}

public class Comprobante : TenantEntityBase
{
    public int ComprobanteId { get; set; }
    public byte ComprobanteTipoId { get; set; }
    public int PuntoVentaId { get; set; }
    public long Numero { get; set; }
    public DateTime Fecha { get; set; }
    public int? ClienteId { get; set; }
    public int? ProveedorId { get; set; }
    public string? CuitContraparte { get; set; }
    public string? CondicionIvaContraparte { get; set; }
    public byte MonedaId { get; set; } = 1;
    public decimal TipoCambio { get; set; } = 1;
    public decimal Neto { get; set; }
    public decimal Iva105 { get; set; }
    public decimal Iva21 { get; set; }
    public decimal Iva27 { get; set; }
    public decimal OtrosImpuestos { get; set; }
    public decimal Percepciones { get; set; }
    public decimal Total { get; set; }
    public string? Cae { get; set; }
    public DateTime? CaeVencimiento { get; set; }
    public string Estado { get; set; } = "Pendiente"; // Pendiente/Autorizado/Rechazado/Anulado
    public DateTime? AutorizadoAt { get; set; }
    public string? ObservacionesArca { get; set; }
    public string? EnlacePdf { get; set; }
    public int? AdjuntoId { get; set; }
    public string? Observaciones { get; set; }

    public ComprobanteTipo Tipo { get; set; } = null!;
    public PuntoVenta PuntoVenta { get; set; } = null!;
    public ICollection<ComprobanteDetalle> Detalles { get; set; } = new List<ComprobanteDetalle>();
}

public class ComprobanteDetalle
{
    public int ComprobanteDetalleId { get; set; }
    public int ComprobanteId { get; set; }
    public string Descripcion { get; set; } = null!;
    public decimal Cantidad { get; set; }
    public decimal PrecioUnitario { get; set; }
    public decimal AlicuotaIva { get; set; }
    public decimal Subtotal { get; set; }
    public decimal ImporteIva { get; set; }

    public Comprobante Comprobante { get; set; } = null!;
}

public class Adjunto : TenantEntityBase
{
    public int AdjuntoId { get; set; }
    public string NombreOriginal { get; set; } = null!;
    public string? ContentType { get; set; }
    public long TamanoBytes { get; set; }
    public string? Hash { get; set; }
    public string Almacenamiento { get; set; } = "Filesystem"; // Filesystem/S3/Azure
    public string Url { get; set; } = null!;
    public string? Entidad { get; set; }
    public string? EntidadId { get; set; }
    public int? SubidoPor { get; set; }
}

/// <summary>Cliente offline registrado (celular/notebook). Cada uno tiene su UUID.</summary>
public class SyncClient
{
    public Guid SyncClientId { get; set; } = Guid.NewGuid();
    public int UsuarioId { get; set; }
    public string Nombre { get; set; } = null!;
    public string? Plataforma { get; set; }
    public DateTime? UltimaSincronizacionAt { get; set; }
    public byte[]? UltimoCursor { get; set; } // ROWVERSION
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Usuario Usuario { get; set; } = null!;
}

/// <summary>Cambios locales pendientes de enviar al servidor desde un cliente offline.</summary>
public class SyncOutbox
{
    public long SyncOutboxId { get; set; }
    public Guid SyncClientId { get; set; }
    public string Entidad { get; set; } = null!;
    public Guid SyncUuid { get; set; }
    public string Operacion { get; set; } = null!; // insert/update/delete
    public string Payload { get; set; } = null!;   // JSON
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? AplicadoAt { get; set; }
    public string Estado { get; set; } = "Pendiente"; // Pendiente/Aplicado/Conflicto/Error
    public string? Error { get; set; }
}

/// <summary>Conflictos detectados al sincronizar (la versión del servidor ya había cambiado).</summary>
public class SyncConflict
{
    public long SyncConflictId { get; set; }
    public Guid SyncClientId { get; set; }
    public string Entidad { get; set; } = null!;
    public Guid SyncUuid { get; set; }
    public string PayloadCliente { get; set; } = null!;
    public string PayloadServidor { get; set; } = null!;
    public string Resolucion { get; set; } = "Pendiente"; // ServerWins/ClientWins/Manual/Pendiente
    public int? ResueltoPor { get; set; }
    public DateTime? ResueltoAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
