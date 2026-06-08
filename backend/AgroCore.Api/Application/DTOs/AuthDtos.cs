namespace AgroCore.Application.DTOs;

public record LoginRequest(string UsernameOrEmail, string Password, int? EmpresaId, string? DeviceId);

public record LoginResponse(
    string AccessToken,
    DateTime AccessExpiresAt,
    string RefreshToken,
    DateTime RefreshExpiresAt,
    UsuarioResumen Usuario,
    List<EmpresaResumen> Empresas,
    List<string> Roles,
    List<string> Permisos,
    int EmpresaActivaId);

public record UsuarioResumen(int UsuarioId, string Username, string NombreCompleto, string Email);

public record EmpresaResumen(int EmpresaId, string RazonSocial, string Cuit, bool EsPyme, string CondicionIva);

public record RefreshRequest(string RefreshToken, int? EmpresaId);

public record ChangePasswordRequest(string PasswordActual, string PasswordNueva);

public record CambiarEmpresaRequest(int EmpresaId);

public record CrearUsuarioRequest(
    string Username,
    string Email,
    string NombreCompleto,
    string Password,
    string? Telefono,
    List<AsignacionRol> Asignaciones);

public record AsignacionRol(int EmpresaId, int RolId);

public record EditarUsuarioRequest(string NombreCompleto, string Email, string? Telefono, bool Activo);
