using AgroCore.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AgroCore.Infrastructure.Persistence.Configurations;

public class InsumoConfig : IEntityTypeConfiguration<Insumo>
{
    public void Configure(EntityTypeBuilder<Insumo> b)
    {
        b.ToTable("Insumo");
        b.HasKey(x => x.InsumoId);
        b.Property(x => x.Codigo).HasMaxLength(40).IsRequired();
        b.Property(x => x.Nombre).HasMaxLength(200).IsRequired();
        b.Property(x => x.TipoInsumo).HasMaxLength(30).IsRequired();
        b.Property(x => x.UnidadMedida).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Codigo }).IsUnique();
        b.HasIndex(x => new { x.EmpresaId, x.TipoInsumo });
    }
}

public class ProveedorConfig : IEntityTypeConfiguration<Proveedor>
{
    public void Configure(EntityTypeBuilder<Proveedor> b)
    {
        b.ToTable("Proveedor");
        b.HasKey(x => x.ProveedorId);
        b.Property(x => x.Codigo).HasMaxLength(30).IsRequired();
        b.Property(x => x.RazonSocial).HasMaxLength(200).IsRequired();
        b.Property(x => x.Cuit).HasMaxLength(13);
        b.HasIndex(x => new { x.EmpresaId, x.Codigo }).IsUnique();
        b.HasIndex(x => new { x.EmpresaId, x.Cuit });
    }
}

public class ClienteConfig : IEntityTypeConfiguration<Cliente>
{
    public void Configure(EntityTypeBuilder<Cliente> b)
    {
        b.ToTable("Cliente");
        b.HasKey(x => x.ClienteId);
        b.Property(x => x.Codigo).HasMaxLength(30).IsRequired();
        b.Property(x => x.RazonSocial).HasMaxLength(200).IsRequired();
        b.Property(x => x.Cuit).HasMaxLength(13);
        b.HasIndex(x => new { x.EmpresaId, x.Codigo }).IsUnique();
    }
}

public class CompraInsumoConfig : IEntityTypeConfiguration<CompraInsumo>
{
    public void Configure(EntityTypeBuilder<CompraInsumo> b)
    {
        b.ToTable("CompraInsumo");
        b.HasKey(x => x.CompraInsumoId);
        b.Property(x => x.NumeroComprobante).HasMaxLength(40);
        b.HasOne(x => x.Proveedor).WithMany().HasForeignKey(x => x.ProveedorId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.EmpresaId, x.Fecha });
    }
}

public class CompraInsumoDetalleConfig : IEntityTypeConfiguration<CompraInsumoDetalle>
{
    public void Configure(EntityTypeBuilder<CompraInsumoDetalle> b)
    {
        b.ToTable("CompraInsumoDetalle");
        b.HasKey(x => x.CompraInsumoDetalleId);
        b.HasOne(x => x.CompraInsumo).WithMany(c => c.Detalles).HasForeignKey(x => x.CompraInsumoId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Insumo).WithMany().HasForeignKey(x => x.InsumoId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class MovimientoStockInsumoConfig : IEntityTypeConfiguration<MovimientoStockInsumo>
{
    public void Configure(EntityTypeBuilder<MovimientoStockInsumo> b)
    {
        b.ToTable("MovimientoStockInsumo");
        b.HasKey(x => x.MovimientoStockInsumoId);
        b.HasOne(x => x.Insumo).WithMany().HasForeignKey(x => x.InsumoId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.InsumoId, x.Fecha });
    }
}

public class OrdenTrabajoConfig : IEntityTypeConfiguration<OrdenTrabajo>
{
    public void Configure(EntityTypeBuilder<OrdenTrabajo> b)
    {
        b.ToTable("OrdenTrabajo");
        b.HasKey(x => x.OrdenTrabajoId);
        b.Property(x => x.Numero).HasMaxLength(30).IsRequired();
        b.Property(x => x.TipoLabor).HasMaxLength(30).IsRequired();
        b.Property(x => x.Estado).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Numero }).IsUnique();
        b.HasIndex(x => new { x.EmpresaId, x.FechaPlanificada });
        b.HasOne(x => x.Campana).WithMany(c => c.OrdenesTrabajo).HasForeignKey(x => x.CampanaId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Lote).WithMany().HasForeignKey(x => x.LoteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Maquinaria).WithMany().HasForeignKey(x => x.MaquinariaId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Operario).WithMany().HasForeignKey(x => x.OperarioId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class OrdenTrabajoInsumoConfig : IEntityTypeConfiguration<OrdenTrabajoInsumo>
{
    public void Configure(EntityTypeBuilder<OrdenTrabajoInsumo> b)
    {
        b.ToTable("OrdenTrabajoInsumo");
        b.HasKey(x => x.OrdenTrabajoInsumoId);
        b.HasOne(x => x.OrdenTrabajo).WithMany(o => o.Insumos).HasForeignKey(x => x.OrdenTrabajoId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Insumo).WithMany().HasForeignKey(x => x.InsumoId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class OrdenTrabajoCostoConfig : IEntityTypeConfiguration<OrdenTrabajoCosto>
{
    public void Configure(EntityTypeBuilder<OrdenTrabajoCosto> b)
    {
        b.ToTable("OrdenTrabajoCosto");
        b.HasKey(x => x.OrdenTrabajoCostoId);
        b.Property(x => x.Concepto).HasMaxLength(120).IsRequired();
        b.HasOne(x => x.OrdenTrabajo).WithMany(o => o.Costos).HasForeignKey(x => x.OrdenTrabajoId).OnDelete(DeleteBehavior.Cascade);
    }
}
