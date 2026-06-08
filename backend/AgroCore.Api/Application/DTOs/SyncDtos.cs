namespace AgroCore.Application.DTOs;

/// <summary>
/// Protocolo de sincronización:
///   1) Cliente envía /sync/push con lista de cambios locales (outbox).
///   2) Servidor responde con resultados (aplicado/conflicto/error) y sirve el nuevo cursor.
///   3) Cliente hace /sync/pull?since=cursor para recibir deltas del servidor.
///   4) El cliente persiste el cursor devuelto.
/// El cursor es el valor máximo de ROWVERSION visto por el cliente, codificado en base64.
/// </summary>
public record SyncClientRegisterDto(string Nombre, string? Plataforma);
public record SyncClientDto(Guid SyncClientId, string Nombre, DateTime? UltimaSincronizacionAt);

public record SyncPushItem(
    string Entidad,          // ej: "Lote", "OrdenTrabajo"
    string Operacion,        // insert | update | delete
    Guid SyncUuid,           // identificador idempotente del cliente
    string PayloadJson,      // JSON del registro
    string? ClientRowVersionB64 // opcional: rowversion que el cliente tenía al editar
);

public record SyncPushRequest(Guid SyncClientId, string? CursorB64, List<SyncPushItem> Items);

public record SyncPushItemResult(
    string Entidad, Guid SyncUuid, string Estado,  // aplicado | conflicto | error
    int? ServerId, string? NewRowVersionB64, string? Error);

public record SyncPushResponse(List<SyncPushItemResult> Results, string NextCursorB64);

public record SyncPullResponse(
    List<SyncEntityDelta> Deltas,
    string NextCursorB64,
    bool HasMore);

public record SyncEntityDelta(string Entidad, List<SyncRecord> Records);
public record SyncRecord(Guid? SyncUuid, int ServerId, string PayloadJson, string RowVersionB64, bool IsDeleted);
