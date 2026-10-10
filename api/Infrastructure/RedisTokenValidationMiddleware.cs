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
                        var storedAccessToken = await _redisDb.StringGetAsync($"access_token:{userId}");

                        // 如果Redis中没有存储的token，或者存储的token与当前请求的token不匹配
                        if (storedAccessToken.IsNullOrEmpty || storedAccessToken != token)
                        {
                            // 记录日志
                            Console.WriteLine($"[TokenValidation] Token validation failed for user {userId}: " +
                                $"stored={storedAccessToken.IsNullOrEmpty}, match={(!storedAccessToken.IsNullOrEmpty && storedAccessToken == token)}");

                            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                            await context.Response.WriteAsync("访问令牌无效或已过期，请重新登录");
                            return;
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
