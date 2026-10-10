using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Security.Claims;
using System.Text;
using api.Data;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace api.Infrastructure;

/// <summary>
/// JWT 相关配置选项。
/// </summary>
public class JwtOptions
{
    /// <summary>
    /// 令牌签发者。
    /// </summary>
    public string Issuer { get; set; } = string.Empty;

    /// <summary>
    /// 令牌受众。
    /// </summary>
    public string Audience { get; set; } = string.Empty;

    /// <summary>
    /// 对称加密密钥。
    /// </summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// 访问令牌有效分钟数。
    /// </summary>
    public int AccessTokenMinutes { get; set; } = 1;

    /// <summary>
    /// 刷新令牌有效天数。
    /// </summary>
    public int RefreshTokenDays { get; set; } = 7;
}

/// <summary>
/// 访问令牌与刷新令牌的组合。
/// </summary>
public class TokenPair
{
    /// <summary>
    /// 访问令牌字符串。
    /// </summary>
    public string AccessToken { get; set; } = string.Empty;

    /// <summary>
    /// 刷新令牌字符串。
    /// </summary>
    public string RefreshToken { get; set; } = string.Empty;

    /// <summary>
    /// 访问令牌过期时间（UTC）。
    /// </summary>
    public DateTime AccessTokenExpiresAt { get; set; }

    /// <summary>
    /// 刷新令牌过期时间（UTC）。
    /// </summary>
    public DateTime RefreshTokenExpiresAt { get; set; }
}

/// <summary>
/// JWT 令牌服务接口。
/// </summary>
public interface IJwtTokenService
{
    /// <summary>
    /// 为指定用户生成访问令牌和刷新令牌。
    /// </summary>
    /// <param name="user">用户实体。</param>
    /// <returns>访问令牌与刷新令牌组合。</returns>
    TokenPair GenerateTokens(User user);

    /// <summary>
    /// 验证刷新令牌有效性并返回声明主体。
    /// </summary>
    /// <param name="refreshToken">刷新令牌字符串。</param>
    /// <returns>验证通过返回声明主体，否则返回 null。</returns>
    ClaimsPrincipal? ValidateRefreshToken(string refreshToken);
}

/// <summary>
/// 默认的 JWT 令牌服务实现，支持双 token 和单点登录。
/// </summary>
/// <remarks>
/// 使用配置选项初始化 JWT 令牌服务。
/// </remarks>
/// <param name="options">JWT 配置选项。</param>
public class JwtTokenService(IOptions<JwtOptions> options) : IJwtTokenService
{
    readonly JwtOptions _options = options.Value;

    // 移除内存存储，完全依赖Redis
    // static readonly ConcurrentDictionary<string, string> RefreshTokenJtiByUserId = new();

    /// <summary>
    /// 为指定用户生成新的访问令牌和刷新令牌。
    /// </summary>
    /// <param name="user">用户实体。</param>
    /// <returns>访问令牌与刷新令牌组合。</returns>
    public TokenPair GenerateTokens(User user)
    {
        var jti = Guid.NewGuid().ToString("N");
        // 不再使用内存字典存储，完全由Redis管理

        var accessExpires = DateTime.UtcNow.AddMinutes(_options.AccessTokenMinutes);
        var refreshExpires = DateTime.UtcNow.AddDays(_options.RefreshTokenDays);

        var accessToken = CreateToken(user, jti, accessExpires, "access");
        var refreshToken = CreateToken(user, jti, refreshExpires, "refresh");

        return new TokenPair
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken,
            AccessTokenExpiresAt = accessExpires,
            RefreshTokenExpiresAt = refreshExpires
        };
    }

    /// <summary>
    /// 验证刷新令牌是否有效。
    /// </summary>
    /// <param name="refreshToken">刷新令牌字符串。</param>
    /// <returns>验证通过的声明主体，否则为 null。</returns>
    public ClaimsPrincipal? ValidateRefreshToken(string refreshToken)
    {
        if (string.IsNullOrWhiteSpace(refreshToken))
            return null;

        var handler = new JwtSecurityTokenHandler();
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.Key));

        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            ValidIssuer = _options.Issuer,
            ValidAudience = _options.Audience,
            IssuerSigningKey = key,
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        try
        {
            var principal = handler.ValidateToken(refreshToken, parameters, out var validatedToken);

            if (validatedToken is not JwtSecurityToken jwt)
                return null;

            var type = jwt.Claims.FirstOrDefault(c => c.Type == "typ")?.Value;
            if (!string.Equals(type, "refresh", StringComparison.OrdinalIgnoreCase))
                return null;

            // 不再检查内存字典，完全依赖Redis验证
            // var sub = jwt.Claims.FirstOrDefault(c => c.Type == JwtRegisteredClaimNames.Sub)?.Value;
            // var jti = jwt.Claims.FirstOrDefault(c => c.Type == JwtRegisteredClaimNames.Jti)?.Value;
            // if (string.IsNullOrWhiteSpace(sub) || string.IsNullOrWhiteSpace(jti))
            //     return null;

            // if (!RefreshTokenJtiByUserId.TryGetValue(sub, out var currentJti))
            //     return null;

            // if (!string.Equals(currentJti, jti, StringComparison.Ordinal))
            //     return null;

            return principal;
        }
        catch (SecurityTokenException)
        {
            return null;
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /// <summary>
    /// 创建包含基本声明和类型信息的 JWT 令牌。
    /// </summary>
    /// <param name="user">用户实体。</param>
    /// <param name="jti">令牌唯一标识。</param>
    /// <param name="expires">过期时间。</param>
    /// <param name="tokenType">令牌类型：access 或 refresh。</param>
    /// <returns>序列化后的 JWT 字符串。</returns>
    string CreateToken(User user, string jti, DateTime expires, string tokenType)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(ClaimTypes.Role, user.Role),
            new(JwtRegisteredClaimNames.Jti, jti),
            new("typ", tokenType)
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.Key));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            _options.Issuer,
            _options.Audience,
            claims,
            expires: expires,
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
