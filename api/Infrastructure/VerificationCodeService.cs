using System;
using System.Security.Cryptography;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using StackExchange.Redis;
using System.Threading;
using System.Threading.Tasks;

namespace api.Infrastructure;

/// <summary>
/// 发送验证码结果状态。
/// </summary>
public enum SendCodeStatus
{
    /// <summary>
    /// 发送成功。
    /// </summary>
    Success,
    /// <summary>
    /// 请求过于频繁，被限流。
    /// </summary>
    TooFrequent
}

/// <summary>
/// 校验验证码结果状态。
/// </summary>
public enum VerifyCodeStatus
{
    /// <summary>
    /// 验证通过。
    /// </summary>
    Success,
    /// <summary>
    /// 验证码不存在或已过期。
    /// </summary>
    NotFoundOrExpired,
    /// <summary>
    /// 验证码不匹配。
    /// </summary>
    CodeMismatch
}

/// <summary>
/// 邮箱验证码发送与校验服务接口。
/// </summary>
public interface IVerificationCodeService
{
    /// <summary>
    /// 发送邮箱验证码并应用频率限制。
    /// </summary>
    /// <param name="email">目标邮箱地址。</param>
    /// <param name="actionType">操作类型（如：注册、登录等）。</param>
    /// <param name="cancellationToken">取消操作标记。</param>
    /// <returns>发送结果状态。</returns>
    Task<SendCodeStatus> SendCodeAsync(string email, string? actionType, CancellationToken cancellationToken = default);

    /// <summary>
    /// 校验指定邮箱的验证码是否有效。
    /// </summary>
    /// <param name="email">目标邮箱地址。</param>
    /// <param name="code">用户提交的验证码。</param>
    /// <param name="cancellationToken">取消操作标记。</param>
    /// <returns>校验结果状态。</returns>
    Task<VerifyCodeStatus> VerifyCodeAsync(string email, string code, CancellationToken cancellationToken = default);
}

/// <summary>
/// 支持 Redis 与内存双实现的邮箱验证码服务。
/// </summary>
public class VerificationCodeService : IVerificationCodeService
{
    readonly IEmailService _emailService;
    readonly IMemoryCache _memoryCache;
    readonly IConnectionMultiplexer? _redis;
    readonly bool _useRedis;
    readonly TimeSpan _codeTtl;
    readonly TimeSpan _sendLimitTtl;
    readonly object _memoryLock = new();

    /// <summary>
    /// 初始化验证码服务实例。
    /// </summary>
    /// <param name="emailService">邮件发送服务。</param>
    /// <param name="memoryCache">内存缓存实例。</param>
    /// <param name="configuration">应用配置对象。</param>
    /// <param name="redis">可选的 Redis 连接多路复用器。</param>
    public VerificationCodeService(IEmailService emailService, IMemoryCache memoryCache, IConfiguration configuration, IConnectionMultiplexer? redis)
    {
        _emailService = emailService;
        _memoryCache = memoryCache;
        _redis = redis;

        var emailSection = configuration.GetSection("Email");
        var expiryMinutes = emailSection.GetValue<int?>("ExpiryMinutes") ?? 5;
        var rateLimitSeconds = emailSection.GetValue<int?>("RateLimitSeconds") ?? 60;

        _codeTtl = TimeSpan.FromMinutes(expiryMinutes);
        _sendLimitTtl = TimeSpan.FromSeconds(rateLimitSeconds);

        var redisSection = configuration.GetSection("Redis");
        var enabled = redisSection.GetValue<bool?>("Enabled") ?? false;
        _useRedis = enabled && _redis != null;
    }

    /// <summary>
    /// 发送邮箱验证码并应用频率限制。
    /// </summary>
    /// <param name="email">目标邮箱地址。</param>
    /// <param name="actionType">操作类型（如：注册、登录等）。</param>
    /// <param name="cancellationToken">取消操作标记。</param>
    /// <returns>发送结果状态。</returns>
    public async Task<SendCodeStatus> SendCodeAsync(string email, string? actionType, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(email))
            throw new ArgumentException("Email is required", nameof(email));

        var normalizedAction = string.IsNullOrWhiteSpace(actionType) ? "验证" : actionType.Trim();

        var normalized = NormalizeEmail(email);

        if (_useRedis)
        {
            var db = _redis!.GetDatabase();
            var limitKey = GetLimitKey(normalized);

            var acquired = await db.StringSetAsync(limitKey, "1", _sendLimitTtl, When.NotExists);
            if (!acquired)
                return SendCodeStatus.TooFrequent;

            var codeKey = GetCodeKey(normalized);
            var code = GenerateCode(6);

            try
            {
                await db.StringSetAsync(codeKey, code, _codeTtl, When.Always);
                await _emailService.SendVerificationCodeAsync(email, code, normalizedAction, cancellationToken);
                return SendCodeStatus.Success;
            }
            catch
            {
                await db.KeyDeleteAsync(limitKey);
                await db.KeyDeleteAsync(codeKey);
                throw;
            }
        }
        else
        {
            var limitKey = GetLimitKey(normalized);
            var codeKey = GetCodeKey(normalized);

            lock (_memoryLock)
            {
                if (_memoryCache.TryGetValue(limitKey, out _))
                    return SendCodeStatus.TooFrequent;

                _memoryCache.Set(limitKey, 1, _sendLimitTtl);
            }

            var code = GenerateCode(6);

            try
            {
                _memoryCache.Set(codeKey, code, _codeTtl);
                await _emailService.SendVerificationCodeAsync(email, code, normalizedAction, cancellationToken);
                return SendCodeStatus.Success;
            }
            catch
            {
                _memoryCache.Remove(limitKey);
                _memoryCache.Remove(codeKey);
                throw;
            }
        }
    }

    /// <summary>
    /// 校验指定邮箱的验证码是否有效。
    /// </summary>
    /// <param name="email">目标邮箱地址。</param>
    /// <param name="code">用户提交的验证码。</param>
    /// <param name="cancellationToken">取消操作标记。</param>
    /// <returns>校验结果状态。</returns>
    public async Task<VerifyCodeStatus> VerifyCodeAsync(string email, string code, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(email))
            throw new ArgumentException("Email is required", nameof(email));

        if (string.IsNullOrWhiteSpace(code))
            throw new ArgumentException("Code is required", nameof(code));

        var normalized = NormalizeEmail(email);

        if (_useRedis)
        {
            var db = _redis!.GetDatabase();
            var codeKey = GetCodeKey(normalized);
            var stored = await db.StringGetAsync(codeKey);

            if (stored.IsNullOrEmpty)
                return VerifyCodeStatus.NotFoundOrExpired;

            if (!string.Equals(stored.ToString(), code, StringComparison.Ordinal))
                return VerifyCodeStatus.CodeMismatch;

            await db.KeyDeleteAsync(codeKey);
            return VerifyCodeStatus.Success;
        }
        else
        {
            var codeKey = GetCodeKey(normalized);
            if (!_memoryCache.TryGetValue<string>(codeKey, out var stored) || string.IsNullOrEmpty(stored))
                return VerifyCodeStatus.NotFoundOrExpired;

            if (!string.Equals(stored, code, StringComparison.Ordinal))
                return VerifyCodeStatus.CodeMismatch;

            _memoryCache.Remove(codeKey);
            return VerifyCodeStatus.Success;
        }
    }

    static string NormalizeEmail(string email)
    {
        return email.Trim().ToLowerInvariant();
    }

    static string GetCodeKey(string normalizedEmail)
    {
        return "email:verify:code:" + normalizedEmail;
    }

    static string GetLimitKey(string normalizedEmail)
    {
        return "email:verify:limit:" + normalizedEmail;
    }

    static string GenerateCode(int length)
    {
        const string digits = "0123456789";
        Span<byte> bytes = stackalloc byte[length];
        RandomNumberGenerator.Fill(bytes);
        var chars = new char[length];

        for (var i = 0; i < length; i++)
        {
            chars[i] = digits[bytes[i] % digits.Length];
        }

        return new string(chars);
    }
}