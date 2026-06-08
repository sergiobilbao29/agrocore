using AgroCore.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AgroCore.Infrastructure.Persistence.Configurations;

public class SiloConfig : IEntityTypeConfiguration<Silo>
{
    public void Configure(EntityTypeBuilder<Silo> b)
    {
        b.ToTable("Silo");
        b.HasKey(x => x.SiloId);
        b.Property(x => x.Codigo).HasMaxLength(30).IsRequired();
        b.Property(x => x.Descripcion).HasMaxLength(200).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Codigo }).IsUnique();
    }
}

public class StockGranoConfig : IEntityTypeConfiguration<StockGrano>
{
    public void Configure(EntityTypeBuilder<StockGrano> b)
    {
        b.ToTable("StockGrano");
        b.HasKey(x => x.StockGranoId);
        b.HasIndex(x => new { x.SiloId, x.CultivoId, x.CampanaId }).IsUnique();
    }
}

public class MovimientoGranoConfig : IEntityTypeConfiguration<MovimientoGrano>
{
    public void Configure(EntityTypeBuilder<MovimientoGrano> b)
    {
        b.ToTable("MovimientoGrano");
        b.HasKey(x => x.MovimientoGranoId);
        b.Property(x => x.Tipo).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.SiloId, x.Fecha });
    }
}

public class HaciendaConfig : IEntityTypeConfiguration<Hacienda>
{
    public void Configure(EntityTypeBuilder<Hacienda> b)
    {
        b.ToTable("Hacienda");
        b.HasKey(x => x.HaciendaId);
        b.Property(x => x.CaravanaSenasa).HasMaxLength(30);
        b.Property(x => x.Categoria).HasMaxLength(30).IsRequired();
        b.Property(x => x.Estado).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.CaravanaSenasa });
    }
}

public class MovimientoHaciendaConfig : IEntityTypeConfiguration<MovimientoHacienda>
{
    public void Configure(EntityTypeBuilder<MovimientoHacienda> b)
    {
        b.ToTable("MovimientoHacienda");
        b.HasKey(x => x.MovimientoHaciendaId);
        b.Property(x => x.Tipo).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Fecha });
    }
}

public class VentaGranoConfig : IEntityTypeConfiguration<VentaGrano>
{
    public void Configure(EntityTypeBuilder<VentaGrano> b)
    {
        b.ToTable("VentaGrano");
        b.HasKey(x => x.VentaGranoId);
        b.HasIndex(x => new { x.EmpresaId, x.Fecha });
        b.HasOne(x => x.Cliente).WithMany().HasForeignKey(x => x.ClienteId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class VentaHaciendaConfig : IEntityTypeConfiguration<VentaHacienda>
{
    public void Configure(EntityTypeBuilder<VentaHacienda> b)
    {
        b.ToTable("VentaHacienda");
        b.HasKey(x => x.VentaHaciendaId);
        b.HasIndex(x => new { x.EmpresaId, x.Fecha });
        b.HasOne(x => x.Cliente).WithMany().HasForeignKey(x => x.ClienteId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class VentaPymeConfig : IEntityTypeConfiguration<VentaPyme>
{
    public void Configure(EntityTypeBuilder<VentaPyme> b)
    {
        b.ToTable("VentaPyme");
        b.HasKey(x => x.VentaPymeId);
        b.Property(x => x.Concepto).HasMaxLength(200).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Fecha });
    }
}

public class MovimientoCajaConfig : IEntityTypeConfiguration<MovimientoCaja>
{
    public void Configure(EntityTypeBuilder<MovimientoCaja> b)
    {
        b.ToTable("MovimientoCaja");
        b.HasKey(x => x.MovimientoCajaId);
        b.Property(x => x.Tipo).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Fecha });
    }
}

public class ChequeConfig : IEntityTypeConfiguration<Cheque>
{
    public void Configure(EntityTypeBuilder<Cheque> b)
    {
        b.ToTable("Cheque");
        b.HasKey(x => x.ChequeId);
        b.Property(x => x.Tipo).HasMaxLength(10).IsRequired();
        b.Property(x => x.Numero).HasMaxLength(40).IsRequired();
        b.Property(x => x.Estado).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Estado, x.FechaVencimiento });
    }
}

public class CuentaCorrienteConfig : IEntityTypeConfiguration<CuentaCorriente>
{
    public void Configure(EntityTypeBuilder<CuentaCorriente> b)
    {
        b.ToTable("CuentaCorriente");
        b.HasKey(x => x.CuentaCorrienteId);
        b.Property(x => x.Tipo).HasMaxLength(15).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Tipo, x.ClienteId, x.ProveedorId }).IsUnique();
    }
}

public class CuentaMovimientoConfig : IEntityTypeConfiguration<CuentaMovimiento>
{
    public void Configure(EntityTypeBuilder<CuentaMovimiento> b)
    {
        b.ToTable("CuentaMovimiento");
        b.HasKey(x => x.CuentaMovimientoId);
        b.Property(x => x.Tipo).HasMaxLength(10).IsRequired();
        b.Property(x => x.Concepto).HasMaxLength(200).IsRequired();
        b.HasIndex(x => new { x.CuentaCorrienteId, x.Fecha });
    }
}

public class MovimientoEfectivoConfig : IEntityTypeConfiguration<MovimientoEfectivo>
{
    public void Configure(EntityTypeBuilder<MovimientoEfectivo> b)
    {
        b.ToTable("MovimientoEfectivo");
        b.HasKey(x => x.MovimientoEfectivoId);
        b.HasIndex(x => new { x.EmpresaId, x.Fecha });
    }
}

public class ContratoConfig : IEntityTypeConfiguration<ContratoArrendamiento>
{
    public void Configure(EntityTypeBuilder<ContratoArrendamiento> b)
    {
        b.ToTable("ContratoArrendamiento");
        b.HasKey(x => x.ContratoArrendamientoId);
        b.Property(x => x.NumeroContrato).HasMaxLength(40).IsRequired();
        b.Property(x => x.ArrendadorNombre).HasMaxLength(200).IsRequired();
        b.Property(x => x.TipoContrato).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.NumeroContrato }).IsUnique();
    }
}

public class MovArrendConfig : IEntityTypeConfiguration<MovimientoArrendamiento>
{
    public void Configure(EntityTypeBuilder<MovimientoArrendamiento> b)
    {
        b.ToTable("MovimientoArrendamiento");
        b.HasKey(x => x.MovimientoArrendamientoId);
        b.Property(x => x.Concepto).HasMaxLength(200).IsRequired();
    }
}

public class EmpleadoConfig : IEntityTypeConfiguration<Empleado>
{
    public void Configure(EntityTypeBuilder<Empleado> b)
    {
        b.ToTable("Empleado");
        b.HasKey(x => x.EmpleadoId);
        b.Property(x => x.Legajo).HasMaxLength(20).IsRequired();
        b.Property(x => x.Apellido).HasMaxLength(100).IsRequired();
        b.Property(x => x.Nombre).HasMaxLength(100).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Legajo }).IsUnique();
    }
}

public class LiquidacionConfig : IEntityTypeConfiguration<Liquidacion>
{
    public void Configure(EntityTypeBuilder<Liquidacion> b)
    {
        b.ToTable("Liquidacion");
        b.HasKey(x => x.LiquidacionId);
        b.HasIndex(x => new { x.EmpleadoId, x.Anio, x.Mes, x.Concepto }).IsUnique();
    }
}

public class ViajeCamionConfig : IEntityTypeConfiguration<ViajeCamion>
{
    public void Configure(EntityTypeBuilder<ViajeCamion> b)
    {
        b.ToTable("ViajeCamion");
        b.HasKey(x => x.ViajeCamionId);
        b.Property(x => x.NumeroCartaPorte).HasMaxLength(40);
        b.Property(x => x.Estado).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Fecha });
        b.HasIndex(x => x.NumeroCartaPorte);
    }
}

public class PuntoVentaConfig : IEntityTypeConfiguration<PuntoVenta>
{
    public void Configure(EntityTypeBuilder<PuntoVenta> b)
    {
        b.ToTable("PuntoVenta");
        b.HasKey(x => x.PuntoVentaId);
        b.Property(x => x.Descripcion).HasMaxLength(120).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Numero }).IsUnique();
    }
}

public class ComprobanteTipoConfig : IEntityTypeConfiguration<ComprobanteTipo>
{
    public void Configure(EntityTypeBuilder<ComprobanteTipo> b)
    {
        b.ToTable("ComprobanteTipo");
        b.HasKey(x => x.ComprobanteTipoId);
        b.Property(x => x.ComprobanteTipoId).ValueGeneratedNever();
        b.Property(x => x.Codigo).HasMaxLength(20).IsRequired();
        b.Property(x => x.Nombre).HasMaxLength(80).IsRequired();
        b.Property(x => x.Letra).HasMaxLength(2).IsRequired();
        b.HasIndex(x => x.Codigo).IsUnique();
    }
}

public class ComprobanteConfig : IEntityTypeConfiguration<Comprobante>
{
    public void Configure(EntityTypeBuilder<Comprobante> b)
    {
        b.ToTable("Comprobante");
        b.HasKey(x => x.ComprobanteId);
        b.Property(x => x.Cae).HasMaxLength(20);
        b.Property(x => x.Estado).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.ComprobanteTipoId, x.PuntoVentaId, x.Numero }).IsUnique();
        b.HasIndex(x => new { x.EmpresaId, x.Fecha });
        b.HasOne(x => x.Tipo).WithMany().HasForeignKey(x => x.ComprobanteTipoId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne(x => x.PuntoVenta).WithMany().HasForeignKey(x => x.PuntoVentaId).OnDelete(DeleteBehavior.Restrict);
    }
}

public class ComprobanteDetalleConfig : IEntityTypeConfiguration<ComprobanteDetalle>
{
    public void Configure(EntityTypeBuilder<ComprobanteDetalle> b)
    {
        b.ToTable("ComprobanteDetalle");
        b.HasKey(x => x.ComprobanteDetalleId);
        b.Property(x => x.Descripcion).HasMaxLength(300).IsRequired();
        b.HasOne(x => x.Comprobante).WithMany(c => c.Detalles).HasForeignKey(x => x.ComprobanteId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class AdjuntoConfig : IEntityTypeConfiguration<Adjunto>
{
    public void Configure(EntityTypeBuilder<Adjunto> b)
    {
        b.ToTable("Adjunto");
        b.HasKey(x => x.AdjuntoId);
        b.Property(x => x.NombreOriginal).HasMaxLength(300).IsRequired();
        b.Property(x => x.Url).HasMaxLength(600).IsRequired();
        b.Property(x => x.ContentType).HasMaxLength(100);
        b.Property(x => x.Almacenamiento).HasMaxLength(20).IsRequired();
        b.HasIndex(x => new { x.EmpresaId, x.Entidad, x.EntidadId });
    }
}

public class SyncClientConfig : IEntityTypeConfiguration<SyncClient>
{
    public void Configure(EntityTypeBuilder<SyncClient> b)
    {
        b.ToTable("SyncClient");
        b.HasKey(x => x.SyncClientId);
        b.Property(x => x.SyncClientId).ValueGeneratedNever();
        b.Property(x => x.Nombre).HasMaxLength(120).IsRequired();
        b.Property(x => x.Plataforma).HasMaxLength(40);
        b.HasOne(x => x.Usuario).WithMany().HasForeignKey(x => x.UsuarioId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class SyncOutboxConfig : IEntityTypeConfiguration<SyncOutbox>
{
    public void Configure(EntityTypeBuilder<SyncOutbox> b)
    {
        b.ToTable("SyncOutbox");
        b.HasKey(x => x.SyncOutboxId);
        b.Property(x => x.Entidad).HasMaxLength(60).IsRequired();
        b.Property(x => x.Operacion).HasMaxLength(10).IsRequired();
        b.Property(x => x.Estado).HasMaxLength(20).IsRequired();
        b.Property(x => x.Payload).HasColumnType("NVARCHAR(MAX)").IsRequired();
        b.HasIndex(x => new { x.SyncClientId, x.Estado });
        b.HasIndex(x => new { x.Entidad, x.SyncUuid });
    }
}

public class SyncConflictConfig : IEntityTypeConfiguration<SyncConflict>
{
    public void Configure(EntityTypeBuilder<SyncConflict> b)
    {
        b.ToTable("SyncConflict");
        b.HasKey(x => x.SyncConflictId);
        b.Property(x => x.Entidad).HasMaxLength(60).IsRequired();
        b.Property(x => x.Resolucion).HasMaxLength(20).IsRequired();
        b.Property(x => x.PayloadCliente).HasColumnType("NVARCHAR(MAX)").IsRequired();
        b.Property(x => x.PayloadServidor).HasColumnType("NVARCHAR(MAX)").IsRequired();
    }
}
