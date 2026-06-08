using System.Text;
using System.Text.Json;
using AgroCore.Api.Middleware;
using AgroCore.Application.DTOs;
using AgroCore.Application.Services.Interfaces;
using AgroCore.Domain.Entities;
using AgroCore.Infrastructure.Persistence;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AgroCore.Infrastructure.Sync;

/// <summary>
/// Servicio de sincronización offline-first.
///
/// Contrato:
///   PUSH: recibe una lista de cambios que el cliente realizó sin conexión.
///         Cada item identificado por (SyncClientId, Entidad, SyncUuid) se aplica idempotentemente.
///   PULL: devuelve todas las filas creadas/actualizadas desde el cursor anterior.
///         El cursor es el UpdatedAt máximo observado (ISO 8601 en base64).
///
/// Convenciones:
///   - Entidades soportadas por PUSH: MovimientoCaja, MovimientoGrano.
///     (Se pueden agregar más extendiendo ApplyAsync.)
///   - El payload es JSON con los campos del DTO de creación.
/// </summary>
public class SyncService : ISyncService
{
    private readonly AgroCoreDbContext _db;
    private readonly ITenantContext _tenant;
    private readonly SyncOptions _opts;

    public SyncService(AgroCoreDbContext db, ITenantContext tenant, IOptions<SyncOptions> opts)
    {
        _db = db; _tenant = tenant; _opts = opts.Value;
    }

    // -------------------------------------------------------------------------
    // Registro de cliente offline (POST /sync/client)
    // -------------------------------------------------------------------------
    public async Task<SyncClientDto> RegistrarClienteAsync(SyncClientRegisterDto dto, CancellationToken ct)
    {
        var usuarioId = _tenant.UsuarioId ?? throw ApiException.Unauthorized("Sin usuario.");
        var client = new SyncClient
        {
            SyncClientId = Guid.NewGuid(),
            UsuarioId = usuarioId,
            Nombre = dto.Nombre,
            Plataforma = dto.Plataforma
        };
        _db.SyncClients.Add(client);
        await _db.SaveChangesAsync(ct);
        return new SyncClientDto(client.SyncClientId, client.Nombre, null);
    }

    // -------------------------------------------------------------------------
    // PUSH — cliente → servidor (POST /sync/push)
    // -------------------------------------------------------------------------
    public async Task<SyncPushResponse> PushAsync(SyncPushRequest req, CancellationToken ct)
    {
        var grupoId = _tenant.GrupoId ?? throw ApiException.Unauthorized("Sin grupo.");
        var empresaId = _tenant.EmpresaId ?? throw ApiException.BadRequest("Empresa no resuelta.");
        _ = await _db.SyncClients.FirstOrDefaultAsync(c => c.SyncClientId == req.SyncClientId, ct)
            ?? throw ApiException.BadRequest("Cliente de sincronización no registrado.");

        if (req.Items.Count > _opts.MaxBatchSize)
            throw ApiException.BadRequest($"Batch supera el máximo permitido ({_opts.MaxBatchSize}).");

        var results = new List<SyncPushItemResult>();

        foreach (var item in req.Items)
        {
            try
            {
                // Idempotencia: (SyncClientId, Entidad, SyncUuid) único
                var dedup = await _db.SyncOutbox.FirstOrDefaultAsync(o =>
                    o.SyncClientId == req.SyncClientId &&
                    o.Entidad == item.Entidad &&
                    o.SyncUuid == item.SyncUuid, ct);

                if (dedup != null && dedup.Estado == "Aplicado")
                {
                    results.Add(new SyncPushItemResult(item.Entidad, item.SyncUuid, "aplicado", null, null, "duplicado"));
                    continue;
                }

                var outbox = dedup ?? new SyncOutbox
                {
                    SyncClientId = req.SyncClientId,
                    Entidad = item.Entidad,
                    SyncUuid = item.SyncUuid,
                    Operacion = item.Operacion,
                    Payload = item.PayloadJson
                };
                if (dedup == null) _db.SyncOutbox.Add(outbox);

                var (serverId, rowVersionB64) = await ApplyAsync(grupoId, empresaId, req.SyncClientId, item, ct);

                outbox.Estado = "Aplicado";
                outbox.AplicadoAt = DateTime.UtcNow;
                outbox.Error = null;

                results.Add(new SyncPushItemResult(item.Entidad, item.SyncUuid, "aplicado", serverId, rowVersionB64, null));
            }
            catch (ConflictException cex)
            {
                _db.SyncConflicts.Add(new SyncConflict
                {
                    SyncClientId = req.SyncClientId,
                    Entidad = item.Entidad,
                    SyncUuid = item.SyncUuid,
                    PayloadCliente = item.PayloadJson,
                    PayloadServidor = cex.ServerPayload ?? "{}",
                    Resolucion = _opts.ConflictPolicy == "LastWriteWinsWithLog" ? "ServerWins" : "Pendiente"
                });
                results.Add(new SyncPushItemResult(item.Entidad, item.SyncUuid, "conflicto", null, null, cex.Message));
            }
            catch (Exception ex)
            {
                results.Add(new SyncPushItemResult(item.Entidad, item.SyncUuid, "error", null, null, ex.Message));
            }
        }

        await _db.SaveChangesAsync(ct);

        var cursor = req.CursorB64 ?? string.Empty;
        return new SyncPushResponse(results, cursor);
    }

    // -------------------------------------------------------------------------
    // PULL — servidor → cliente (GET /sync/pull?cursor=...)
    // -------------------------------------------------------------------------
    public async Task<SyncPullResponse> PullAsync(Guid syncClientId, string? cursorB64, CancellationToken ct)
    {
        var deltas = new List<SyncEntityDelta>();
        var cursorDate = DecodeCursor(cursorB64) ?? DateTime.UtcNow.AddDays(-_opts.DeltaWindowDays);
        var maxUpdatedAt = cursorDate;

        var batchLimit = _opts.MaxBatchSize;

        maxUpdatedAt = await AppendDeltaAsync<OrdenTrabajo>(deltas, "OrdenTrabajo", cursorDate, maxUpdatedAt, batchLimit, ct);
        maxUpdatedAt = await AppendDeltaAsync<MovimientoStockInsumo>(deltas, "MovimientoStockInsumo", cursorDate, maxUpdatedAt, batchLimit, ct);
        maxUpdatedAt = await AppendDeltaAsync<MovimientoGrano>(deltas, "MovimientoGrano", cursorDate, maxUpdatedAt, batchLimit, ct);
        maxUpdatedAt = await AppendDeltaAsync<MovimientoCaja>(deltas, "MovimientoCaja", cursorDate, maxUpdatedAt, batchLimit, ct);
        maxUpdatedAt = await AppendDeltaAsync<Insumo>(deltas, "Insumo", cursorDate, maxUpdatedAt, batchLimit, ct);
        maxUpdatedAt = await AppendDeltaAsync<Campana>(deltas, "Campana", cursorDate, maxUpdatedAt, batchLimit, ct);
        maxUpdatedAt = await AppendDeltaAsync<Lote>(deltas, "Lote", cursorDate, maxUpdatedAt, batchLimit, ct);

        // Persistir último cursor en el registro del cliente
        var client = await _db.SyncClients.FirstOrDefaultAsync(c => c.SyncClientId == syncClientId, ct);
        if (client != null)
        {
            client.UltimaSincronizacionAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        var hasMore = deltas.Any(d => d.Records.Count >= batchLimit);
        var nextCursor = EncodeCursor(maxUpdatedAt);
        return new SyncPullResponse(deltas, nextCursor, hasMore);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    private async Task<DateTime> AppendDeltaAsync<T>(
        List<SyncEntityDelta> deltas, string entidad, DateTime cursorDate, DateTime maxSoFar, int batchLimit, CancellationToken ct)
        where T : TenantEntityBase
    {
        var rows = await _db.Set<T>().AsNoTracking()
            .Where(e => e.UpdatedAt > cursorDate)
            .OrderBy(e => e.UpdatedAt)
            .Take(batchLimit)
            .ToListAsync(ct);

        if (rows.Count == 0) return maxSoFar;

        var records = rows.Select(e => new SyncRecord(
                e.SyncUuid,
                GetIdInt(e),
                JsonSerializer.Serialize(e, JsonOpts),
                Convert.ToBase64String(e.RowVersion ?? Array.Empty<byte>()),
                e.DeletedAt != null))
            .ToList();

        deltas.Add(new SyncEntityDelta(entidad, records));

        var localMax = rows.Max(r => r.UpdatedAt);
        return localMax > maxSoFar ? localMax : maxSoFar;
    }

    private static int GetIdInt(object entity)
    {
        var prop = entity.GetType().GetProperties()
            .FirstOrDefault(p => p.PropertyType == typeof(int) && p.Name.EndsWith("Id"));
        return prop?.GetValue(entity) is int i ? i : 0;
    }

    private async Task<(int serverId, string rowVersionB64)> ApplyAsync(
        int grupoId, int empresaId, Guid syncClientId, SyncPushItem item, CancellationToken ct)
    {
        switch (item.Entidad)
        {
            case "MovimientoCaja":
                {
                    var dto = JsonSerializer.Deserialize<MovimientoCajaCreateDto>(item.PayloadJson, JsonOpts)
                        ?? throw ApiException.BadRequest("Payload inválido.");
                    var m = new MovimientoCaja
                    {
                        GrupoId = grupoId, EmpresaId = empresaId,
                        SyncClientId = syncClientId, SyncUuid = item.SyncUuid,
                        Fecha = dto.Fecha, Tipo = dto.Tipo, MedioPago = dto.MedioPago,
                        CuentaOrigenId = dto.CuentaOrigenId, CuentaDestinoId = dto.CuentaDestinoId,
                        CategoriaId = dto.CategoriaId, MonedaId = dto.MonedaId, TipoCambio = dto.TipoCambio,
                        Importe = dto.Importe,
                        ImporteArs = dto.MonedaId == 1 ? dto.Importe : dto.Importe * dto.TipoCambio,
                        Concepto = dto.Concepto, ProveedorId = dto.ProveedorId, ClienteId = dto.ClienteId,
                        EmpleadoId = dto.EmpleadoId, ChequeId = dto.ChequeId, ComprobanteId = dto.ComprobanteId,
                        Observaciones = dto.Observaciones
                    };
                    _db.MovimientosCaja.Add(m);
                    await _db.SaveChangesAsync(ct);
                    return (m.MovimientoCajaId, Convert.ToBase64String(m.RowVersion));
                }

            case "MovimientoGrano":
                {
                    var dto = JsonSerializer.Deserialize<MovimientoGranoCreateDto>(item.PayloadJson, JsonOpts)
                        ?? throw ApiException.BadRequest("Payload inválido.");
                    var m = new MovimientoGrano
                    {
                        GrupoId = grupoId, EmpresaId = empresaId,
                        SyncClientId = syncClientId, SyncUuid = item.SyncUuid,
                        SiloId = dto.SiloId, CultivoId = dto.CultivoId, CampanaId = dto.CampanaId,
                        Fecha = dto.Fecha, Tipo = dto.Tipo, Kilogramos = dto.Kilogramos,
                        Humedad = dto.Humedad, Impureza = dto.Impureza,
                        NumeroCartaPorte = dto.NumeroCartaPorte, ClienteId = dto.ClienteId,
                        SiloDestinoId = dto.SiloDestinoId, ViajeCamionId = dto.ViajeCamionId,
                        Observaciones = dto.Observaciones
                    };
                    _db.MovimientosGrano.Add(m);
                    await _db.SaveChangesAsync(ct);
                    return (m.MovimientoGranoId, Convert.ToBase64String(m.RowVersion));
                }

            default:
                throw ApiException.BadRequest($"Entidad '{item.Entidad}' no soportada en sync.");
        }
    }

    private static DateTime? DecodeCursor(string? b64)
    {
        if (string.IsNullOrWhiteSpace(b64)) return null;
        try
        {
            var iso = Encoding.UTF8.GetString(Convert.FromBase64String(b64));
            return DateTime.Parse(iso, null, System.Globalization.DateTimeStyles.RoundtripKind);
        }
        catch { return null; }
    }

    private static string EncodeCursor(DateTime dt) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(dt.ToUniversalTime().ToString("O")));

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles
    };

    private sealed class ConflictException : Exception
    {
        public string? ServerPayload { get; }
        public ConflictException(string msg, string? serverPayload = null) : base(msg) { ServerPayload = serverPayload; }
    }
}
