using System.Security.Cryptography;
using System.Text;

namespace api.Infrastructure;

/// <summary>
/// 提供基于 PBKDF2 的密码哈希与验证功能。
/// </summary>
public static class PasswordHasher
{
    const int SaltSize = 16;
    const int KeySize = 32;
    const int Iterations = 100_000;

    /// <summary>
    /// 计算密码哈希并返回包含盐值的字符串表示。
    /// </summary>
    /// <param name="password">明文密码。</param>
    /// <returns>包含盐值和密钥的 Base64 串，使用冒号分隔。</returns>
    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, KeySize);
        return Convert.ToBase64String(salt) + ":" + Convert.ToBase64String(key);
    }

    /// <summary>
    /// 验证明文密码是否与已存储的哈希匹配。
    /// </summary>
    /// <param name="hash">存储的哈希字符串。</param>
    /// <param name="password">待验证的明文密码。</param>
    /// <returns>匹配返回 true，否则返回 false。</returns>
    public static bool Verify(string hash, string password)
    {
        var parts = hash.Split(':', 2);
        if (parts.Length != 2)
            return false;

        var salt = Convert.FromBase64String(parts[0]);
        var key = Convert.FromBase64String(parts[1]);

        var keyToCheck = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, KeySize);
        return CryptographicOperations.FixedTimeEquals(key, keyToCheck);
    }
}
