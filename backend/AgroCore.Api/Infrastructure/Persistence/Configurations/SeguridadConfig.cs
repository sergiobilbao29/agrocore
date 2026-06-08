using AgroCore.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AgroCore.Infrastructure.Persistence.Configurations;

public class GrupoConfig : IEntityTypeConfiguration<Grupo>
{
    public void Configure(EntityTypeBuilder<Grupo> b)
    {
        b.ToTable("Grupo");
        b.HasKey(x => x.GrupoId);
        b.Property(x => x.Nombre).HasMaxLength(150).IsRequired();
        b.Property(x => x.CuitHolding).HasMaxLength(13);
        b.Property(x => x.Descripcion).HasMaxLength(500);
    }
}

public class EmpresaConfig : IEntityTypeConfiguration<Empresa>
{
    public void Configure(EntityTypeBuilder<Empresa> b)
    {
        b.ToTable("Empresa");
        b.HasKey(x => x.EmpresaId);
        b.Property(x => x.RazonSocial).HasMaxLength(200).IsRequired();
        b.Property(x => x.NombreFantasia).HasMaxLength(200);
        b.Property(x => x.Cuit).HasMaxLength(13).IsRequired();
        b.Property(x => x.CondicionIva).HasMaxLength(50).HasDefaultValue("RI");
        b.HasIndex(x => x.Cuit).IsUnique();
        b.HasOne(x => x.Grupo).WithMany(g => g.Empresas).HasForeignKey(x => x.GrupoId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class UsuarioConfig : IEntityTypeConfiguration<Usuario>
{
    public void Configure(EntityTypeBuilder<Usuario> b)
    {
        b.ToTable("Usuario");
        b.HasKey(x => x.UsuarioId);
        b.Property(x => x.Username).HasMaxLength(60).IsRequired();
        b.Property(x => x.Email).HasMaxLength(200).IsRequired();
        b.Property(x => x.NombreCompleto).HasMaxLength(200).IsRequired();
        b.HasIndex(x => new { x.GrupoId, x.Username }).IsUnique();
        b.HasIndex(x => new { x.GrupoId, x.Email }).IsUnique();
        b.HasOne(x => x.Grupo).WithMany(g => g.Usuarios).HasForeignKey(x => x.GrupoId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class RolConfig : IEntityTypeConfiguration<Rol>
{
    public void Configure(EntityTypeBuilder<Rol> b)
    {
        b.ToTable("Rol");
        b.HasKey(x => x.RolId);
        b.Property(x => x.Codigo).HasMaxLength(40).IsRequired();
        b.Property(x => x.Nombre).HasMaxLength(100).IsRequired();
        b.HasIndex(x => new { x.GrupoId, x.Codigo }).IsUnique();
    }
}

public class PermisoConfig : IEntityTypeConfiguration<Permiso>
{
    public void Configure(EntityTypeBuilder<Permiso> b)
    {
        b.ToTable("Permiso");
        b.HasKey(x => x.PermisoId);
        b.Property(x => x.Codigo).HasMaxLength(60).IsRequired();
        b.Property(x => x.Modulo).HasMaxLength(40).IsRequired();
        b.Property(x => x.Accion).HasMaxLength(20).IsRequired();
        b.HasIndex(x => x.Codigo).IsUnique();
    }
}

public class RolPermisoConfig : IEntityTypeConfiguration<RolPermiso>
{
    public void Configure(EntityTypeBuilder<RolPermiso> b)
    {
        b.ToTable("RolPermiso");
        b.HasKey(x => new { x.RolId, x.PermisoId });
        b.HasOne(x => x.Rol).WithMany(r => r.Permisos).HasForeignKey(x => x.RolId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Permiso).WithMany(p => p.Roles).HasForeignKey(x => x.PermisoId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class UsuarioEmpresaRolConfig : IEntityTypeConfiguration<UsuarioEmpresaRol>
{
    public void Configure(EntityTypeBuilder<UsuarioEmpresaRol> b)
    {
        b.ToTable("UsuarioEmpresaRol");
        b.HasKey(x => x.UsuarioEmpresaRolId);
        b.HasIndex(x => new { x.UsuarioId, x.EmpresaId, x.RolId }).IsUnique();
        b.HasOne(x => x.Usuario).WithMany(u => u.EmpresasRoles).HasForeignKey(x => x.UsuarioId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne(x => x.Empresa).WithMany(e => e.UsuariosRoles).HasForeignKey(x => x.EmpresaId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.Rol).WithMany().HasForeignKey(x => x.RolId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class RefreshTokenConfig : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> b)
    {
        b.ToTable("RefreshToken");
        b.HasKey(x => x.RefreshTokenId);
        b.HasIndex(x => new { x.UsuarioId, x.RevocadoAt });
        b.HasOne(x => x.Usuario).WithMany(u => u.RefreshTokens).HasForeignKey(x => x.UsuarioId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class AuditLogConfig : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> b)
    {
        b.ToTable("AuditLog");
        b.HasKey(x => x.AuditLogId);
        b.Property(x => x.Entidad).HasMaxLength(60).IsRequired();
        b.Property(x => x.Accion).HasMaxLength(20).IsRequired();
        b.Property(x => x.EntidadId).HasMaxLength(40);
        b.HasIndex(x => new { x.EmpresaId, x.CreatedAt });
        b.HasIndex(x => new { x.Entidad, x.EntidadId });
    }
}
