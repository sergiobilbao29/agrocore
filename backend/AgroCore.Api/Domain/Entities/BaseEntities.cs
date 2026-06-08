using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace AgroCore.Domain.Entities;

/// <summary>
/// Base con auditoría y soporte de sincronización offline.
/// </summary>
public abstract class EntityBase
{
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeletedAt { get; set; }
    public int? UpdatedBy { get; set; }
    [Timestamp] public byte[] RowVersion { get; set; } = Array.Empty<byte>();
}

/// <summary>
/// Base para entidades transaccionales que se sincronizan desde el cliente offline.
/// SyncClientId + SyncUuid componen la clave idempotente para conciliar filas creadas sin conexión.
/// </summary>
public abstract class TenantEntityBase : EntityBase
{
    public int GrupoId { get; set; }
    public int EmpresaId { get; set; }
    public Guid? SyncClientId { get; set; }
    public Guid? SyncUuid { get; set; }
}
