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
    /// 从原始 JWT 的 payload 读取签发时间 iat（秒）。
    /// 直接读 payload 而不依赖 Claim 类型映射，避免 iat 被映射成其他类型后取不到。
    /// </summary>
    /// <summary>判断该令牌是否为可用于业务接口的 access 令牌。</summary>
    static bool IsAccessToken(string rawToken)
    {
        try
        {
            var handler = new JwtSecurityTokenHandler();
            if (!handler.CanReadToken(rawToken)) return false;

            var jwt = handler.ReadJwtToken(rawToken);
            return jwt.Payload.TryGetValue("typ", out var value)
                && string.Equals(value?.ToString(), "access", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>从原始 JWT 的 payload 读取字符串声明（不依赖 claim 类型映射）。</summary>
    static string? GetPayloadString(string rawToken, string claimName)
    {
        try
        {
            var handler = new JwtSecurityTokenHandler();
            if (!handler.CanReadToken(rawToken)) return null;

            var jwt = handler.ReadJwtToken(rawToken);
            return jwt.Payload.TryGetValue(claimName, out var value) ? value?.ToString() : null;
        }
        catch
        {
            return null;
        }
    }

    static long? GetIssuedAtEpoch(string rawToken)
    {
        try
        {
            var handler = new JwtSecurityTokenHandler();
            if (!handler.CanReadToken(rawToken)) return null;

            var jwt = handler.ReadJwtToken(rawToken);
            if (!jwt.Payload.TryGetValue(JwtRegisteredClaimNames.Iat, out var value) || value == null)
                return null;

            return value switch
            {
                long l => l,
                int i => i,
                _ => long.TryParse(value.ToString(), out var parsed) ? parsed : null
            };
        }
        catch
        {
            return null;
        }
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
                // 解析JWT获取用户ID
                var handler = new JwtSecurityTokenHandler();

                // 验证JWT签名（使用相同的配置）
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

                var principal = handler.ValidateToken(token, parameters, out var validatedToken);

                if (validatedToken is JwtSecurityToken jwtToken)
                {
                    // 从JWT中提取用户ID
                    var userIdClaim = jwtToken.Claims.FirstOrDefault(c => c.Type == JwtRegisteredClaimNames.Sub);
                    if (userIdClaim != null && ulong.TryParse(userIdClaim.Value, out var userId))
                    {
                        // 检查Redis中是否存在对应的access_token
                        // 撤销判定：登出（改密、踢下线）会在 Redis 写入「撤销时间戳」，
                        // 签发时间早于它的令牌一律失效 —— 登出依然即时，且对所有端同时生效。
                        //
                        // 旧实现是「令牌必须与 Redis 里那一份完全相等」：手机与电脑同时在线时，
                        // 任一端刷新都会把另一端顶成 401，最终演变成「过一会就要重新登录」。
                        // 现在改为按签发时间判定，多端互不干扰。
                        // 长令牌（typ=refresh）只能用于换取新令牌，不能拿来访问业务接口。
                        // 旧实现靠「与 Redis 精确匹配」顺带挡住了这一点，改成按签发时间判定后必须显式校验。
                        if (!IsAccessToken(token))
                        {
                            Console.WriteLine($"[TokenValidation] 使用了非 access 令牌访问接口 user={userId}");
                            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                            await context.Response.WriteAsync("该令牌不能用于访问接口，请重新登录");
                            return;
                        }

                        // 一次 MGET 查两个撤销维度，只有一次 Redis 往返：
                        //   1) 账号级 auth_revoked_before:{userId} —— 改密码/注销等「全端下线」
                        //   2) 设备级 revoked_sid:{sid}             —— 某个设备自己登出
                        var sid = GetPayloadString(token, "sid");
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
                            var issuedAtEpoch = GetIssuedAtEpoch(token);
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
            }
            catch (Exception ex)
            {
                // JWT解析失败，记录日志但不阻止请求（让后续认证中间件处理）
                Console.WriteLine($"[TokenValidation] JWT parsing error: {ex.Message}");
                // 可以选择记录详细错误信息用于调试
            }
        }

        // 继续执行后续中间件
        await _next(context);
    }
}
