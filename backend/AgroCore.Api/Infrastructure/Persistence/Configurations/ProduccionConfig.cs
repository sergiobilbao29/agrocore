using AgroCore.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AgroCore.Infrastructure.Persistence.Configurations;

public class MonedaConfig : IEntityTypeConfiguration<Moneda>
{
    public void Configure(EntityTypeBuilder<Moneda> b)
    {
        b.ToTable("Moneda");
        b.HasKey(x => x.MonedaId);
        b.Property(x => x.MonedaId).ValueGeneratedNever();
        b.Property(x => x.Codigo).HasMaxLength(3).IsFixedLength().IsRequired();
        b.Property(x => x.Nombre).HasMaxLength(40).IsRequired();
        b.Property(x => x.Simbolo).HasMaxLength(5).IsRequired();
        b.HasIndex(x => x.Codigo).IsUnique();
    }
}

public class TipoCambioConfig : IEntityTypeConfiguration<TipoCambio>
{
    public void Configure(EntityTypeBuilder<TipoCambio> b)
    {
        b.ToTable("TipoCambio");
        b.HasKey(x => x.TipoCambioId);
        b.HasIndex(x => new { x.Fecha, x.MonedaId }).IsUnique();
        b.HasOne(x => x.Moneda).WithMany().HasForeignKey(x => x.MonedaId);
    }
}

public class CategoriaConfig : IEntityTypeConfiguration<Categoria>
{
    public void Configure(EntityTypeBuilder<Categoria> b)
    {
        b.ToTable("Categoria");
        b.HasKey(x => x.CategoriaId);
        b.Property(x => x.Tipo).HasMaxLength(30).IsRequired();
        b.Property(x => x.Codigo).HasMaxLength(40).IsRequired();
        b.Property(x => x.Nombre).HasMaxLength(120).IsRequired();
        b.HasIndex(x => new { x.GrupoId, x.Tipo, x.Codigo }).IsUnique();
    }
}

public class CampoConfig : IEntityTypeConfiguration<Campo>
{
    public void Configure(EntityTypeBuilder<Campo> b)
    {
        b.ToTable("Campo");
        b.HasKey(x => x.CampoId);
        b.Property(x => x.Codigo).HasMaxLength(30).IsRequired();
        b.Property(x => x.Nombre).HasMaxLength(200).IsRequired();
        b.Property(x => x.GeoJson).HasColumnType("NVARCHAR(MAX)");
        b.HasIndex(x => new { x.EmpresaId, x.Codigo }).IsUnique();
        b.HasOne(x => x.Empresa).WithMany(e => e.Campos).HasForeignKey(x => x.EmpresaId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class LoteConfig : IEntityTypeConfiguration<Lote>
{
    public void Configure(EntityTypeBuilder<Lote> b)
    {
        b.ToTable("Lote");
        b.HasKey(x => x.LoteId);
        b.Property(x => x.Codigo).HasMaxLength(30).IsRequired();
        b.Property(x => x.Nombre).HasMaxLength(200).IsRequired();
        b.Property(x => x.GeoJson).HasColumnType("NVARCHAR(MAX)");
        b.HasIndex(x => new { x.CampoId, x.Codigo }).IsUnique();
        b.HasOne(x => x.Campo).WithMany(c => c.Lotes).HasForeignKey(x => x.CampoId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class CultivoConfig : IEntityTypeConfiguration<Cultivo>
{
    public void Configure(EntityTypeBuilder<Cultivo> b)
    {
        b.ToTable("Cultivo");
        b.HasKey(x => x.CultivoId);
        b.Property(x => x.Codigo).HasMaxLength(30).IsRequired();
        b.Property(x => x.Nombre).HasMaxLength(120).IsRequired();
        b.HasIndex(x => new { x.GrupoId, x.Codigo }).IsUnique();
    }
}

public class CampanaConfig : IEntityTypeConfiguration<Campana>
{
    public void Configure(EntityTypeBuilder<Campana> b)
    {
        b.ToTable("Campana");
        b.HasKey(x => x.CampanaId);
        b.Property(x => x.Nombre).HasMaxLength(120).IsRequired();
        b.Property(x => x.Estado).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.LoteId, x.Nombre });
        b.HasOne(x => x.Lote).WithMany(l => l.Campanas).HasForeignKey(x => x.LoteId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Cultivo).WithMany().HasForeignKey(x => x.CultivoId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class MaquinariaConfig : IEntityTypeConfiguration<Maquinaria>
{
    public void Configure(EntityTypeBuilder<Maquinaria> b)
    {
        b.ToTable("Maquinaria");
        b.HasKey(x => x.MaquinariaId);
        b.Property(x => x.Codigo).HasMaxLength(30).IsRequired();
        b.Property(x => x.Descripcion).HasMaxLength(200).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Codigo }).IsUnique();
    }
}
