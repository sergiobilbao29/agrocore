using AgroCore.Domain.Enums;

namespace AgroCore.Domain.Entities;

public class Grupo : EntityBase
{
    public int GrupoId { get; set; }
    public string Nombre { get; set; } = null!;
    public string? CuitHolding { get; set; }
    public string? Descripcion { get; set; }
    public bool Activo { get; set; } = true;

    public ICollection<Empresa> Empresas { get; set; } = new List<Empresa>();
    public ICollection<Usuario> Usuarios { get; set; } = new List<Usuario>();
    public ICollection<Rol> Roles { get; set; } = new List<Rol>();
}

public class Empresa : EntityBase
{
    public int EmpresaId { get; set; }
    public int GrupoId { get; set; }
    public string RazonSocial { get; set; } = null!;
    public string? NombreFantasia { get; set; }
    public string Cuit { get; set; } = null!;
    public string? IngresosBrutos { get; set; }
    public string CondicionIva { get; set; } = "RI";
    public string? Renspa { get; set; }
    public string? Direccion { get; set; }
    public string? Localidad { get; set; }
    public string? Provincia { get; set; }
    public string? Telefono { get; set; }
    public string? Email { get; set; }
    public bool EsPyme { get; set; }
    public bool Activo { get; set; } = true;

    public Grupo Grupo { get; set; } = null!;
    public ICollection<UsuarioEmpresaRol> UsuariosRoles { get; set; } = new List<UsuarioEmpresaRol>();
    public ICollection<Campo> Campos { get; set; } = new List<Campo>();
}

public class Usuario : EntityBase
{
    public int UsuarioId { get; set; }
    public int GrupoId { get; set; }
    public string Username { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string NombreCompleto { get; set; } = null!;
    public byte[] PasswordHash { get; set; } = null!;
    public byte[]? PasswordSalt { get; set; }
    public string? Telefono { get; set; }
    public bool Activo { get; set; } = true;
    public byte[]? MfaSecret { get; set; }
    public DateTime? UltimoLoginAt { get; set; }
    public int IntentosFallidos { get; set; }
    public DateTime? BloqueadoHasta { get; set; }

    public Grupo Grupo { get; set; } = null!;
    public ICollection<UsuarioEmpresaRol> EmpresasRoles { get; set; } = new List<UsuarioEmpresaRol>();
    public ICollection<RefreshToken> RefreshTokens { get; set; } = new List<RefreshToken>();
}

public class Rol : EntityBase
{
    public int RolId { get; set; }
    public int GrupoId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Nombre { get; set; } = null!;
    public string? Descripcion { get; set; }
    public bool EsSistema { get; set; }
    public bool Activo { get; set; } = true;

    public Grupo Grupo { get; set; } = null!;
    public ICollection<RolPermiso> Permisos { get; set; } = new List<RolPermiso>();
}

public class Permiso
{
    public int PermisoId { get; set; }
    public string Codigo { get; set; } = null!;
    public string Modulo { get; set; } = null!;
    public string Accion { get; set; } = null!;
    public string? Descripcion { get; set; }

    public ICollection<RolPermiso> Roles { get; set; } = new List<RolPermiso>();
}

public class RolPermiso
{
    public int RolId { get; set; }
    public int PermisoId { get; set; }
    public Rol Rol { get; set; } = null!;
    public Permiso Permiso { get; set; } = null!;
}

public class UsuarioEmpresaRol
{
    public long UsuarioEmpresaRolId { get; set; }
    public int UsuarioId { get; set; }
    public int EmpresaId { get; set; }
    public int RolId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Usuario Usuario { get; set; } = null!;
    public Empresa Empresa { get; set; } = null!;
    public Rol Rol { get; set; } = null!;
}

public class RefreshToken
{
    public long RefreshTokenId { get; set; }
    public int UsuarioId { get; set; }
    public byte[] TokenHash { get; set; } = null!;
    public string? DeviceInfo { get; set; }
    public DateTime ExpiraAt { get; set; }
    public DateTime? RevocadoAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Usuario Usuario { get; set; } = null!;
}

public class AuditLog
{
    public long AuditLogId { get; set; }
    public int GrupoId { get; set; }
    public int? EmpresaId { get; set; }
    public int? UsuarioId { get; set; }
    public string Entidad { get; set; } = null!;
    public string? EntidadId { get; set; }
    public string Accion { get; set; } = null!;
    public string? DatosAntes { get; set; }
    public string? DatosDespues { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
