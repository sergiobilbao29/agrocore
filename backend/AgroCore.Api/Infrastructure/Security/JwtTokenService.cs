using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using AgroCore.Domain.Entities;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace AgroCore.Infrastructure.Security;

public record IssuedToken(string AccessToken, DateTime AccessExpiresAt, string RefreshToken, DateTime RefreshExpiresAt);

public interface IJwtTokenService
{
    IssuedToken Issue(Usuario u, int empresaActivaId, IEnumerable<int> empresasIds, IEnumerable<string> roles, IEnumerable<string> permisos, string? deviceId = null);
    byte[] HashRefresh(string raw);
    string NewRefreshRaw();
}

public class JwtTokenService : IJwtTokenService
{
    private readonly JwtOptions _opts;
    public JwtTokenService(IOptions<JwtOptions> opts) => _opts = opts.Value;

    public IssuedToken Issue(Usuario u, int empresaActivaId, IEnumerable<int> empresasIds, IEnumerable<string> roles, IEnumerable<string> permisos, string? deviceId = null)
    {
        var now = DateTime.UtcNow;
        var accessExp = now.AddMinutes(_opts.AccessTokenMinutes);
        var refreshExp = now.AddDays(_opts.RefreshTokenDays);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(JwtRegisteredClaimNames.Sub, u.UsuarioId.ToString()),
            new(AgroClaims.UsuarioId, u.UsuarioId.ToString()),
            new(AgroClaims.GrupoId,   u.GrupoId.ToString()),
            new(AgroClaims.EmpresaId, empresaActivaId.ToString()),
            new(AgroClaims.Username,  u.Username),
            new(AgroClaims.Empresas,  string.Join(",", empresasIds.Distinct()))
        };
        if (!string.IsNullOrEmpty(deviceId)) claims.Add(new Claim(AgroClaims.DeviceId, deviceId));
        foreach (var r in roles.Distinct())    claims.Add(new Claim(AgroClaims.Role, r));
        foreach (var p in permisos.Distinct()) claims.Add(new Claim(AgroClaims.Permission, p));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_opts.SecretKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _opts.Issuer,
            audience: _opts.Audience,
            claims: claims,
            notBefore: now,
            expires: accessExp,
            signingCredentials: creds);

        var access = new JwtSecurityTokenHandler().WriteToken(token);
        return new IssuedToken(access, accessExp, NewRefreshRaw(), refreshExp);
    }

    public byte[] HashRefresh(string raw)
    {
        using var sha = SHA256.Create();
        return sha.ComputeHash(Encoding.UTF8.GetBytes(raw));
    }

    public string NewRefreshRaw()
    {
        var buf = new byte[48];
        RandomNumberGenerator.Fill(buf);
        return Convert.ToBase64String(buf).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }
}
