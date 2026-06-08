using AgroCore.Domain.Entities;
using AgroCore.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AgroCore.Infrastructure.Persistence;

/// <summary>
/// Sembrado de datos iniciales: permisos, monedas, catálogo de comprobantes AFIP y rol SuperAdmin.
/// Se invoca desde Program.cs al arrancar la API por primera vez.
/// </summary>
public static class DatabaseSeeder
{
    public static async Task RunAsync(AgroCoreDbContext db, IPasswordHasher hasher, ILogger log, CancellationToken ct = default)
    {
        await db.Database.MigrateAsync(ct);

        await SeedPermisosAsync(db, ct);
        await SeedMonedasAsync(db, ct);
        await SeedComprobanteTiposAsync(db, ct);
        await SeedGrupoDemoAsync(db, hasher, ct);

        log.LogInformation("Seed inicial completado.");
    }

    private static async Task SeedPermisosAsync(AgroCoreDbContext db, CancellationToken ct)
    {
        if (await db.Permisos.AnyAsync(ct)) return;

        var codigos = typeof(Permisos).GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
            .Select(f => (string)f.GetValue(null)!)
            .ToList();

        foreach (var codigo in codigos)
        {
            var partes = codigo.Split(':');
            var modulo = partes[0];
            var accion = string.Join(':', partes.Skip(1));
            db.Permisos.Add(new Permiso { Codigo = codigo, Modulo = modulo, Accion = accion, Descripcion = codigo });
        }
        await db.SaveChangesAsync(ct);
    }

    private static async Task SeedMonedasAsync(AgroCoreDbContext db, CancellationToken ct)
    {
        if (await db.Monedas.AnyAsync(ct)) return;
        db.Monedas.AddRange(
            new Moneda { MonedaId = 1, Codigo = "ARS", Nombre = "Peso Argentino", Simbolo = "$" },
            new Moneda { MonedaId = 2, Codigo = "USD", Nombre = "Dólar Estadounidense", Simbolo = "US$" }
        );
        await db.SaveChangesAsync(ct);
    }

    private static async Task SeedComprobanteTiposAsync(AgroCoreDbContext db, CancellationToken ct)
    {
        if (await db.ComprobanteTipos.AnyAsync(ct)) return;
        // Códigos AFIP https://www.afip.gob.ar/fe/documentos/TablasdeSistema.pdf
        db.ComprobanteTipos.AddRange(
            new ComprobanteTipo { ComprobanteTipoId = 1,  Codigo = "FAC_A",  Nombre = "Factura A",          Letra = "A", AfipCodigo = 1,   Signo = 1 },
            new ComprobanteTipo { ComprobanteTipoId = 2,  Codigo = "NC_A",   Nombre = "Nota de Crédito A",  Letra = "A", AfipCodigo = 3,   Signo = -1 },
            new ComprobanteTipo { ComprobanteTipoId = 3,  Codigo = "ND_A",   Nombre = "Nota de Débito A",   Letra = "A", AfipCodigo = 2,   Signo = 1 },
            new ComprobanteTipo { ComprobanteTipoId = 6,  Codigo = "FAC_B",  Nombre = "Factura B",          Letra = "B", AfipCodigo = 6,   Signo = 1 },
            new ComprobanteTipo { ComprobanteTipoId = 7,  Codigo = "NC_B",   Nombre = "Nota de Crédito B",  Letra = "B", AfipCodigo = 8,   Signo = -1 },
            new ComprobanteTipo { ComprobanteTipoId = 11, Codigo = "FAC_C",  Nombre = "Factura C (Monotr.)", Letra = "C", AfipCodigo = 11, Signo = 1 },
            new ComprobanteTipo { ComprobanteTipoId = 13, Codigo = "NC_C",   Nombre = "Nota de Crédito C",  Letra = "C", AfipCodigo = 13,  Signo = -1 }
        );
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Crea un grupo / empresa / usuario admin de ejemplo si no hay ninguno.</summary>
    private static async Task SeedGrupoDemoAsync(AgroCoreDbContext db, IPasswordHasher hasher, CancellationToken ct)
    {
        if (await db.Grupos.IgnoreQueryFilters().AnyAsync(ct)) return;

        var grupo = new Grupo { Nombre = "Grupo Demo AgroCore" };
        db.Grupos.Add(grupo);
        await db.SaveChangesAsync(ct);

        var empresa = new Empresa
        {
            GrupoId = grupo.GrupoId,
            RazonSocial = "Campo Demo S.A.",
            Cuit = "30-00000000-0",
            CondicionIva = "RI",
            Activo = true
        };
        db.Empresas.Add(empresa);
        await db.SaveChangesAsync(ct);

        var rolAdmin = new Rol
        {
            GrupoId = grupo.GrupoId,
            Codigo = "SUPERADMIN",
            Nombre = "Super Administrador",
            Descripcion = "Acceso total a todas las empresas del grupo",
            EsSistema = true
        };
        db.Roles.Add(rolAdmin);
        await db.SaveChangesAsync(ct);

        // Asignar todos los permisos al rol SuperAdmin
        var perms = await db.Permisos.Select(p => p.PermisoId).ToListAsync(ct);
        foreach (var pid in perms)
            db.RolPermisos.Add(new RolPermiso { RolId = rolAdmin.RolId, PermisoId = pid });
        await db.SaveChangesAsync(ct);

        // Usuario admin inicial: admin / AgroCore2025!
        var (hash, salt) = hasher.Hash("AgroCore2025!");
        var usuario = new Usuario
        {
            GrupoId = grupo.GrupoId,
            Username = "admin",
            Email = "admin@agrocore.ar",
            NombreCompleto = "Administrador del Sistema",
            PasswordHash = hash,
            PasswordSalt = salt,
            Activo = true
        };
        db.Usuarios.Add(usuario);
        await db.SaveChangesAsync(ct);

        db.UsuarioEmpresaRoles.Add(new UsuarioEmpresaRol
        {
            UsuarioId = usuario.UsuarioId,
            EmpresaId = empresa.EmpresaId,
            RolId = rolAdmin.RolId
        });
        await db.SaveChangesAsync(ct);
    }
}
