using AgroCore.Domain.Entities;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Infrastructure.Persistence;

/// <summary>
/// DbContext principal. Aplica:
///   - Filtros globales de soft-delete y tenant (GrupoId/EmpresaId) via ITenantContext.
///   - Timestamps de auditoría (CreatedAt/UpdatedAt/UpdatedBy) automáticos en SaveChanges.
///   - ROWVERSION para concurrencia optimista y delta-sync.
/// </summary>
public class AgroCoreDbContext : DbContext
{
    private readonly ITenantContext? _tenant;

    public AgroCoreDbContext(DbContextOptions<AgroCoreDbContext> options, ITenantContext? tenant = null)
        : base(options)
    {
        _tenant = tenant;
    }

    // Seguridad
    public DbSet<Grupo> Grupos => Set<Grupo>();
    public DbSet<Empresa> Empresas => Set<Empresa>();
    public DbSet<Usuario> Usuarios => Set<Usuario>();
    public DbSet<Rol> Roles => Set<Rol>();
    public DbSet<Permiso> Permisos => Set<Permiso>();
    public DbSet<RolPermiso> RolPermisos => Set<RolPermiso>();
    public DbSet<UsuarioEmpresaRol> UsuarioEmpresaRoles => Set<UsuarioEmpresaRol>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    // Catálogos
    public DbSet<Moneda> Monedas => Set<Moneda>();
    public DbSet<TipoCambio> TiposCambio => Set<TipoCambio>();
    public DbSet<Categoria> Categorias => Set<Categoria>();

    // Campo / Producción
    public DbSet<Campo> Campos => Set<Campo>();
    public DbSet<Lote> Lotes => Set<Lote>();
    public DbSet<Cultivo> Cultivos => Set<Cultivo>();
    public DbSet<Campana> Campanas => Set<Campana>();
    public DbSet<Maquinaria> Maquinarias => Set<Maquinaria>();

    // Stock / Insumos
    public DbSet<Insumo> Insumos => Set<Insumo>();
    public DbSet<Proveedor> Proveedores => Set<Proveedor>();
    public DbSet<Cliente> Clientes => Set<Cliente>();
    public DbSet<CompraInsumo> ComprasInsumo => Set<CompraInsumo>();
    public DbSet<CompraInsumoDetalle> ComprasInsumoDetalle => Set<CompraInsumoDetalle>();
    public DbSet<MovimientoStockInsumo> MovimientosStockInsumo => Set<MovimientoStockInsumo>();

    // Órdenes de trabajo
    public DbSet<OrdenTrabajo> OrdenesTrabajo => Set<OrdenTrabajo>();
    public DbSet<OrdenTrabajoInsumo> OrdenesTrabajoInsumo => Set<OrdenTrabajoInsumo>();
    public DbSet<OrdenTrabajoCosto> OrdenesTrabajoCosto => Set<OrdenTrabajoCosto>();

    // Grano / Hacienda
    public DbSet<Silo> Silos => Set<Silo>();
    public DbSet<StockGrano> StocksGrano => Set<StockGrano>();
    public DbSet<MovimientoGrano> MovimientosGrano => Set<MovimientoGrano>();
    public DbSet<Hacienda> Haciendas => Set<Hacienda>();
    public DbSet<MovimientoHacienda> MovimientosHacienda => Set<MovimientoHacienda>();

    // Ventas
    public DbSet<VentaGrano> VentasGrano => Set<VentaGrano>();
    public DbSet<VentaHacienda> VentasHacienda => Set<VentaHacienda>();
    public DbSet<VentaPyme> VentasPyme => Set<VentaPyme>();

    // Tesorería
    public DbSet<MovimientoCaja> MovimientosCaja => Set<MovimientoCaja>();
    public DbSet<Cheque> Cheques => Set<Cheque>();
    public DbSet<CuentaCorriente> CuentasCorrientes => Set<CuentaCorriente>();
    public DbSet<CuentaMovimiento> CuentasMovimiento => Set<CuentaMovimiento>();
    public DbSet<MovimientoEfectivo> MovimientosEfectivo => Set<MovimientoEfectivo>();

    // Contratos / Empleados / Viajes
    public DbSet<ContratoArrendamiento> Contratos => Set<ContratoArrendamiento>();
    public DbSet<MovimientoArrendamiento> MovimientosArrendamiento => Set<MovimientoArrendamiento>();
    public DbSet<Empleado> Empleados => Set<Empleado>();
    public DbSet<Liquidacion> Liquidaciones => Set<Liquidacion>();
    public DbSet<ViajeCamion> ViajesCamion => Set<ViajeCamion>();

    // Comprobantes / Adjuntos / Sync
    public DbSet<PuntoVenta> PuntosVenta => Set<PuntoVenta>();
    public DbSet<ComprobanteTipo> ComprobanteTipos => Set<ComprobanteTipo>();
    public DbSet<Comprobante> Comprobantes => Set<Comprobante>();
    public DbSet<ComprobanteDetalle> ComprobantesDetalle => Set<ComprobanteDetalle>();
    public DbSet<Adjunto> Adjuntos => Set<Adjunto>();
    public DbSet<SyncClient> SyncClients => Set<SyncClient>();
    public DbSet<SyncOutbox> SyncOutbox => Set<SyncOutbox>();
    public DbSet<SyncConflict> SyncConflicts => Set<SyncConflict>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        base.OnModelCreating(mb);
        mb.HasDefaultSchema("dbo");
        mb.ApplyConfigurationsFromAssembly(typeof(AgroCoreDbContext).Assembly);
        ConfigureSoftDeleteAndTenantFilters(mb);
        ConfigureDecimalPrecision(mb);
    }

    private void ConfigureSoftDeleteAndTenantFilters(ModelBuilder mb)
    {
        foreach (var et in mb.Model.GetEntityTypes())
        {
            var clrType = et.ClrType;
            // Solo entidades transaccionales con tenant: aplicar filtro global.
            if (typeof(TenantEntityBase).IsAssignableFrom(clrType))
            {
                var method = typeof(AgroCoreDbContext)
                    .GetMethod(nameof(ApplyTenantFilter), System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
                    .MakeGenericMethod(clrType);
                method.Invoke(this, new object[] { mb });
            }
            else if (typeof(EntityBase).IsAssignableFrom(clrType))
            {
                var method = typeof(AgroCoreDbContext)
                    .GetMethod(nameof(ApplySoftDeleteFilter), System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
                    .MakeGenericMethod(clrType);
                method.Invoke(this, new object[] { mb });
            }
        }
    }

    private void ApplyTenantFilter<T>(ModelBuilder mb) where T : TenantEntityBase
    {
        mb.Entity<T>().HasQueryFilter(e =>
            e.DeletedAt == null &&
            (_tenant == null || !_tenant.Aplicar ||
             (e.GrupoId == _tenant.GrupoId && (_tenant.EmpresaId == null || e.EmpresaId == _tenant.EmpresaId))));
    }

    private void ApplySoftDeleteFilter<T>(ModelBuilder mb) where T : EntityBase
    {
        mb.Entity<T>().HasQueryFilter(e => e.DeletedAt == null);
    }

    private static void ConfigureDecimalPrecision(ModelBuilder mb)
    {
        foreach (var prop in mb.Model.GetEntityTypes()
                     .SelectMany(t => t.GetProperties())
                     .Where(p => p.ClrType == typeof(decimal) || p.ClrType == typeof(decimal?)))
        {
            if (prop.GetPrecision() == null)
            {
                prop.SetPrecision(18);
                prop.SetScale(4);
            }
        }
    }

    public override int SaveChanges()
    {
        StampAudit();
        return base.SaveChanges();
    }

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        StampAudit();
        return base.SaveChangesAsync(ct);
    }

    private void StampAudit()
    {
        var now = DateTime.UtcNow;
        var userId = _tenant?.UsuarioId;

        foreach (var entry in ChangeTracker.Entries<EntityBase>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.CreatedAt = now;
                    entry.Entity.UpdatedAt = now;
                    if (userId.HasValue) entry.Entity.UpdatedBy = userId;
                    break;
                case EntityState.Modified:
                    entry.Entity.UpdatedAt = now;
                    if (userId.HasValue) entry.Entity.UpdatedBy = userId;
                    entry.Property(nameof(EntityBase.CreatedAt)).IsModified = false;
                    break;
                case EntityState.Deleted:
                    // soft-delete
                    entry.State = EntityState.Modified;
                    entry.Entity.DeletedAt = now;
                    entry.Entity.UpdatedAt = now;
                    if (userId.HasValue) entry.Entity.UpdatedBy = userId;
                    break;
            }
        }
    }
}
