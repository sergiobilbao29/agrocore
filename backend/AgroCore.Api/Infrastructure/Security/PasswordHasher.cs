using System.Text;
using Microsoft.Extensions.Options;

namespace AgroCore.Infrastructure.Security;

public interface IPasswordHasher
{
    (byte[] hash, byte[] salt) Hash(string password);
    bool Verify(string password, byte[] hash, byte[]? salt);
}

public class BcryptPasswordHasher : IPasswordHasher
{
    private readonly int _workFactor;
    public BcryptPasswordHasher(IOptions<SecurityOptions> opts) => _workFactor = opts.Value.BcryptWorkFactor;

    public (byte[] hash, byte[] salt) Hash(string password)
    {
        // BCrypt genera salt internamente y lo devuelve embebido en el string.
        var hashStr = BCrypt.Net.BCrypt.HashPassword(password, _workFactor);
        return (Encoding.UTF8.GetBytes(hashStr), Array.Empty<byte>());
    }

    public bool Verify(string password, byte[] hash, byte[]? salt)
    {
        try
        {
            var hashStr = Encoding.UTF8.GetString(hash);
            return BCrypt.Net.BCrypt.Verify(password, hashStr);
        }
        catch { return false; }
    }
}
