using System;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

namespace api.Infrastructure;

/// <summary>
/// Redis Token验证中间件，在每个请求前检查Redis中的token状态
/// 确保访问令牌在Redis中仍然有效，避免JWT过期时间与Redis状态不一致的问题
/// </summary>
public class RedisTokenValidationMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IDatabase? _redisDb;
    private readonly JwtOptions _jwtOptions;

    public RedisTokenValidationMiddleware(
        RequestDelegate next,
        IConnectionMultiplexer? redis,
        IOptions<JwtOptions> jwtOptions)
    {
        _next = next;
        _redisDb = redis?.GetDatabase();
        _jwtOptions = jwtOptions.Value;
    }

    /// <summary>
    /// 解析令牌 payload（<b>不校验签名</b>）。
    ///
    /// 旧实现对 typ / sid / iat 各调用一次 <c>ReadJwtToken</c>，同一段 Base64
    /// 在一个请求里被解码 3 遍。这里统一解析一次，后续都复用这个对象；
    /// 签名校验仍然单独做（见 <see cref="InvokeAsync"/>），安全性不变。
    /// </summary>
    static JwtSecurityToken? ReadToken(string rawToken)
    {
        try
        {
            var handler = new JwtSecurityTokenHandler();
            return handler.CanReadToken(rawToken) ? handler.ReadJwtToken(rawToken) : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>从已解析的令牌 payload 读取字符串声明（不依赖 claim 类型映射）。</summary>
    static string? GetPayloadString(JwtSecurityToken? jwt, string claimName)
        => jwt != null && jwt.Payload.TryGetValue(claimName, out var value) ? value?.ToString() : null;

    /// <summary>从已解析的令牌 payload 读取签发时间 iat（秒）。</summary>
    static long? GetIssuedAtEpoch(JwtSecurityToken? jwt)
    {
        if (jwt == null ||
            !jwt.Payload.TryGetValue(JwtRegisteredClaimNames.Iat, out var value) ||
            value == null)
        {
            return null;
        }

        return value switch
        {
            long l => l,
            int i => i,
            _ => long.TryParse(value.ToString(), out var parsed) ? parsed : null
        };
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (_redisDb == null)
        {
            await _next(context);
            return;
        }

        // 排除不需要token验证的接口
        var path = context.Request.Path.Value?.ToLowerInvariant();
        if (path == "/mm/auth/refresh" ||
            path == "/mm/auth/login" ||
            path == "/mm/auth/login-account" ||
            path == "/mm/auth/register" ||
            path == "/mm/auth/email-code" ||
            path == "/mm/auth/validate-account")
        {
            await _next(context);
            return;
        }

        // 获取Authorization头
        var authHeader = context.Request.Headers["Authorization"].FirstOrDefault();

        // 检查是否为Bearer token
        if (!string.IsNullOrEmpty(authHeader) && authHeader.StartsWith("Bearer "))
        {
            var token = authHeader.Substring(7).Trim();

            try
            {
                // 先解析一次 payload，后面 typ / sub / sid / iat 都从这里取。
                var jwtToken = ReadToken(token);
                var userIdValue = GetPayloadString(jwtToken, JwtRegisteredClaimNames.Sub);

                if (!string.IsNullOrEmpty(userIdValue) && ulong.TryParse(userIdValue, out var userId))
                {
                    // 长令牌（typ=refresh）只能用于换取新令牌，不能拿来访问业务接口。
                    // 旧实现靠「与 Redis 精确匹配」顺带挡住了这一点，改成按签发时间判定后必须显式校验。
                    if (!string.Equals(GetPayloadString(jwtToken, "typ"), "access", StringComparison.OrdinalIgnoreCase))
                    {
                        Console.WriteLine($"[TokenValidation] 使用了非 access 令牌访问接口 user={userId}");
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("该令牌不能用于访问接口，请重新登录");
                        return;
                    }

                    // 验签。JwtBearer 之后还会验一次，这里保留是为了让后面的撤销判定
                    // 建立在「签名可信」的令牌上；HMAC-SHA256 验签本身开销很小。
                    var handler = new JwtSecurityTokenHandler();
                    var key = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(_jwtOptions.Key));
                    var parameters = new TokenValidationParameters
                    {
                        ValidateIssuer = true,
                        ValidateAudience = true,
                        ValidateIssuerSigningKey = true,
                        ValidateLifetime = false, // 不验证过期时间，由Redis控制
                        ValidIssuer = _jwtOptions.Issuer,
                        ValidAudience = _jwtOptions.Audience,
                        IssuerSigningKey = key,
                        ClockSkew = TimeSpan.Zero // 关闭时钟偏移，完全依赖Redis
                    };
                    handler.ValidateToken(token, parameters, out _);

                    // 一次 MGET 查两个撤销维度，只有一次 Redis 往返：
                    //   1) 账号级 auth_revoked_before:{userId} —— 改密码/注销等「全端下线」
                    //   2) 设备级 revoked_sid:{sid}             —— 某个设备自己登出
                    var sid = GetPayloadString(jwtToken, "sid");
                    var revokedValues = await _redisDb.StringGetAsync(new RedisKey[]
                    {
                        $"auth_revoked_before:{userId}",
                        sid == null ? "revoked_sid:__none__" : $"revoked_sid:{sid}"
                    });
                    var revokedBefore = revokedValues.Length > 0 ? revokedValues[0] : RedisValue.Null;
                    var revokedSid = revokedValues.Length > 1 ? revokedValues[1] : RedisValue.Null;

                    if (!revokedSid.IsNullOrEmpty)
                    {
                        Console.WriteLine($"[TokenValidation] 该设备已登出 user={userId} sid={sid}");
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("该设备已退出登录，请重新登录");
                        return;
                    }

                    if (!revokedBefore.IsNullOrEmpty)
                    {
                        var issuedAtEpoch = GetIssuedAtEpoch(jwtToken);
                        if (issuedAtEpoch == null || issuedAtEpoch.Value <= (long)revokedBefore)
                        {
                            Console.WriteLine($"[TokenValidation] 令牌已被撤销 user={userId} iat={issuedAtEpoch} revokedBefore={revokedBefore}");
                            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                            await context.Response.WriteAsync("登录状态已失效，请重新登录");
                            return;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                // JWT解析失败，记录日志但不阻止请求（让后续认证中间件处理）
                Console.WriteLine($"[TokenValidation] JWT parsing error: {ex.Message}");
            }
        }

        // 继续执行后续中间件
        await _next(context);
    }
}
