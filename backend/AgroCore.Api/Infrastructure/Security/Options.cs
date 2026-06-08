namespace AgroCore.Infrastructure.Security;

public class JwtOptions
{
    public string Issuer { get; set; } = "AgroCore.Api";
    public string Audience { get; set; } = "AgroCore.Clients";
    public string SecretKey { get; set; } = null!;
    public int AccessTokenMinutes { get; set; } = 30;
    public int RefreshTokenDays { get; set; } = 30;
    public int ClockSkewSeconds { get; set; } = 60;
}

public class SecurityOptions
{
    public int BcryptWorkFactor { get; set; } = 12;
    public int MaxFailedLoginAttempts { get; set; } = 5;
    public int LockoutMinutes { get; set; } = 15;
    public int PasswordMinLength { get; set; } = 8;
    public bool RequireMfaForAdmins { get; set; }
}

public class SyncOptions
{
    public int MaxBatchSize { get; set; } = 500;
    public int DeltaWindowDays { get; set; } = 90;
    public string ConflictPolicy { get; set; } = "LastWriteWinsWithLog";
}

/// <summary>Nombres de claims personalizados.</summary>
public static class AgroClaims
{
    public const string UsuarioId = "uid";
    public const string GrupoId   = "grp";
    public const string EmpresaId = "emp";
    public const string Username  = "usr";
    public const string Role      = "role";
    public const string Permission = "perm";
    public const string Empresas  = "emps";   // lista de empresas permitidas
    public const string DeviceId  = "dev";
}
