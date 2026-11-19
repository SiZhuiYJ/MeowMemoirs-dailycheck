using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using api.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.Infrastructure;

/// <summary>
/// 登录记录服务接口：登录成功时确定「目标登录设备」并记录一次登录，登出 / 撤销时回填退出时间。
/// 所有方法都**绝不抛异常**，失败只打日志，不能影响登录 / 登出主流程。
/// </summary>
public interface ILoginRecordService
{
    /// <summary>
    /// 登录成功后调用：
    /// 1. 按 <c>X-Device-Id</c>（无则 UA 指纹）确定设备 key；
    /// 2. 同一 (user_id, device_key) 复用已有设备，否则新建设备；
    /// 3. 写入一条登录记录（含 <c>device_id</c>），并把设备的「最后登录」指针更新到该记录。
    /// 内部 try/catch + ILogger，失败只打日志，不影响登录。
    /// </summary>
    /// <param name="user">已登录用户。</param>
    /// <param name="loginType">登录方式：password/email-code/wechat/register/email-change。</param>
    /// <param name="sessionId">设备会话标识（JWT sid，刷新沿用）。</param>
    /// <param name="httpContext">当前 HTTP 上下文（用于取 IP / 设备头 / UA）。</param>
    /// <param name="ct">取消标记。</param>
    /// <returns>异步任务。</returns>
    Task RecordLoginAsync(
        User user,
        string loginType,
        string sessionId,
        HttpContext httpContext,
        CancellationToken ct = default);

    /// <summary>
    /// 上报「设备活跃」（打开小程序 / 网页时调用；登录本身也会更新活跃时间）。
    /// 设备识别与登录一致（<c>X-Device-Id</c>，无头时 UA 指纹）：
    /// 设备已存在 → 更新展示名 / 平台 / <c>last_active_at</c> / <c>updated_at</c>（不写登录记录）；
    /// 设备不存在 → 创建设备（first/last_login_at = now、last_active_at = now、last_login_record_id = null）。
    /// 内部 try/catch + ILogger，**绝不抛异常**（活跃上报失败不能影响用户打开应用）。
    /// </summary>
    /// <param name="userId">用户 ID。</param>
    /// <param name="httpContext">当前 HTTP 上下文（用于取设备头 / UA）。</param>
    /// <param name="ct">取消标记。</param>
    /// <returns>异步任务。</returns>
    Task TouchDeviceAsync(ulong userId, HttpContext httpContext, CancellationToken ct = default);

    /// <summary>
    /// 登出 / 撤销时调用：把该用户尚未退出的登录记录回填 <c>logout_at</c>。
    /// <paramref name="sessionId"/> 为 null 表示该用户全部未退出记录（全端下线）。
    /// 内部 try/catch + ILogger，失败只打日志，不影响主流程。
    /// </summary>
    /// <param name="userId">用户 ID。</param>
    /// <param name="sessionId">设备会话标识；null 表示该用户全部未退出记录。</param>
    /// <param name="ct">取消标记。</param>
    /// <returns>异步任务。</returns>
    Task MarkLoggedOutAsync(ulong userId, string? sessionId, CancellationToken ct = default);
}

/// <summary>
/// 基于 <see cref="DailyCheckDbContext"/> 与 <see cref="IGeoIpService"/> 的登录记录服务实现。
/// </summary>
public sealed class LoginRecordService(
    DailyCheckDbContext db,
    IGeoIpService geoIpService,
    ILogger<LoginRecordService> logger) : ILoginRecordService
{
    /// <summary>UA 指纹兜底设备 key 的前缀与哈希长度（hex 字符数）。</summary>
    const string FallbackDeviceKeyPrefix = "ua:";

    /// <summary>UA 指纹兜底时截取的 SHA256 hex 前 32 位。</summary>
    const int FallbackDeviceKeyHashLength = 32;

    readonly DailyCheckDbContext _db = db;
    readonly IGeoIpService _geoIpService = geoIpService;
    readonly ILogger<LoginRecordService> _logger = logger;

    /// <summary>
    /// 登录成功后调用：确定目标登录设备 → 写登录记录 → 回写设备的最后登录指针。
    /// 内部 try/catch + ILogger，失败只打日志，不影响登录。
    /// </summary>
    /// <param name="user">已登录用户。</param>
    /// <param name="loginType">登录方式：password/email-code/wechat/register/email-change。</param>
    /// <param name="sessionId">设备会话标识（JWT sid，刷新沿用）。</param>
    /// <param name="httpContext">当前 HTTP 上下文（用于取 IP / 设备头 / UA）。</param>
    /// <param name="ct">取消标记。</param>
    /// <returns>异步任务。</returns>
    public async Task RecordLoginAsync(
        User user,
        string loginType,
        string sessionId,
        HttpContext httpContext,
        CancellationToken ct = default)
    {
        if (user == null || httpContext == null)
            return;

        try
        {
            var ip = ClientContextResolver.ResolveClientIp(httpContext);
            var (platform, device) = ClientContextResolver.ResolveDevice(httpContext);
            var userAgent = httpContext.Request.Headers.UserAgent.ToString();
            var geo = _geoIpService.Resolve(ip);

            var deviceKey = ClientContextResolver.ResolveDeviceId(httpContext)
                ?? BuildFallbackDeviceKey(platform, device);

            var now = DateTime.UtcNow;

            // 1) 查 / 建「目标登录设备」。
            var loginDevice = await _db.UserLoginDevices
                .FirstOrDefaultAsync(d => d.UserId == user.Id && d.DeviceKey == deviceKey, ct);

            if (loginDevice == null)
            {
                loginDevice = new UserLoginDevice
                {
                    UserId = user.Id,
                    DeviceKey = deviceKey,
                    Device = Truncate(device, 128) ?? string.Empty,
                    Platform = Truncate(platform, 32) ?? "unknown",
                    FirstLoginAt = now,
                    LastLoginAt = now,
                    LastActiveAt = now,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                _db.UserLoginDevices.Add(loginDevice);

                try
                {
                    await _db.SaveChangesAsync(ct);
                }
                catch (DbUpdateException)
                {
                    // 并发登录时可能撞 (user_id, device_key) 唯一索引：丢掉本次要插入的实体，
                    // 重新查询复用对方已插入的设备（再查不到才真正失败，交给外层 catch 记日志）。
                    _db.Entry(loginDevice).State = EntityState.Detached;
                    loginDevice = await _db.UserLoginDevices
                        .FirstOrDefaultAsync(d => d.UserId == user.Id && d.DeviceKey == deviceKey, ct);

                    if (loginDevice == null)
                        throw;
                }
            }
            else
            {
                // 同设备再次登录：刷新设备展示信息、最后登录时间与最后活跃时间。
                loginDevice.Device = Truncate(device, 128) ?? string.Empty;
                loginDevice.Platform = Truncate(platform, 32) ?? "unknown";
                loginDevice.LastLoginAt = now;
                loginDevice.LastActiveAt = now;
                loginDevice.UpdatedAt = now;
            }

            // 2) 写一条登录记录（快照字段同 v1，额外带目标设备 ID）。
            var record = new UserLoginRecord
            {
                UserId = user.Id,
                DeviceId = loginDevice.Id,
                SessionId = Truncate(sessionId, 64) ?? string.Empty,
                LoginType = Truncate(loginType, 32) ?? "password",
                Platform = Truncate(platform, 32) ?? "unknown",
                Device = Truncate(device, 128) ?? string.Empty,
                UserAgent = Truncate(userAgent, 512),
                Ip = Truncate(ip, 45),
                Location = Truncate(geo.Location, 64),
                Province = Truncate(geo.Province, 64),
                City = Truncate(geo.City, 64),
                District = Truncate(geo.District, 64),
                Isp = Truncate(geo.Isp, 64),
                IsDomestic = geo.IsDomestic,
                LoginAt = now,
                LogoutAt = null
            };

            _db.UserLoginRecords.Add(record);
            await _db.SaveChangesAsync(ct);

            // 3) 设备「最后一次登录」指针指向刚写入的记录。
            loginDevice.LastLoginRecordId = record.Id;
            loginDevice.LastLoginAt = now;
            loginDevice.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            // 记录失败绝不影响登录成功。
            _logger.LogWarning(
                ex,
                "[LoginRecord] 写入登录记录失败 userId={UserId} loginType={LoginType} sid={SessionId}",
                user.Id,
                loginType,
                sessionId);
        }
    }

    /// <summary>
    /// 上报「设备活跃」：设备识别与登录一致，存在则刷新 last_active_at，不存在则创建设备。
    /// 不写登录记录；内部 try/catch + ILogger，绝不抛异常。
    /// </summary>
    /// <param name="userId">用户 ID。</param>
    /// <param name="httpContext">当前 HTTP 上下文（用于取设备头 / UA）。</param>
    /// <param name="ct">取消标记。</param>
    /// <returns>异步任务。</returns>
    public async Task TouchDeviceAsync(ulong userId, HttpContext httpContext, CancellationToken ct = default)
    {
        if (httpContext == null)
            return;

        try
        {
            var (platform, device) = ClientContextResolver.ResolveDevice(httpContext);
            var deviceKey = ClientContextResolver.ResolveDeviceId(httpContext)
                ?? BuildFallbackDeviceKey(platform, device);

            var now = DateTime.UtcNow;

            var loginDevice = await _db.UserLoginDevices
                .FirstOrDefaultAsync(d => d.UserId == userId && d.DeviceKey == deviceKey, ct);

            if (loginDevice == null)
            {
                // 第一次见到这台设备（例如登录后清了登录记录未清设备缓存）：只建设备，不伪造登录记录。
                loginDevice = new UserLoginDevice
                {
                    UserId = userId,
                    DeviceKey = deviceKey,
                    Device = Truncate(device, 128) ?? string.Empty,
                    Platform = Truncate(platform, 32) ?? "unknown",
                    FirstLoginAt = now,
                    LastLoginAt = now,
                    LastActiveAt = now,
                    LastLoginRecordId = null,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                _db.UserLoginDevices.Add(loginDevice);

                try
                {
                    await _db.SaveChangesAsync(ct);
                }
                catch (DbUpdateException)
                {
                    // 并发活跃上报 / 与登录并发时可能撞 (user_id, device_key) 唯一索引：
                    // 丢掉本次插入，重新查询复用对方已插入的设备。
                    _db.Entry(loginDevice).State = EntityState.Detached;
                    loginDevice = await _db.UserLoginDevices
                        .FirstOrDefaultAsync(d => d.UserId == userId && d.DeviceKey == deviceKey, ct);

                    if (loginDevice == null)
                        throw;

                    loginDevice.Device = Truncate(device, 128) ?? string.Empty;
                    loginDevice.Platform = Truncate(platform, 32) ?? "unknown";
                    loginDevice.LastActiveAt = now;
                    loginDevice.UpdatedAt = now;
                    await _db.SaveChangesAsync(ct);
                }
            }
            else
            {
                loginDevice.Device = Truncate(device, 128) ?? string.Empty;
                loginDevice.Platform = Truncate(platform, 32) ?? "unknown";
                loginDevice.LastActiveAt = now;
                loginDevice.UpdatedAt = now;
                await _db.SaveChangesAsync(ct);
            }
        }
        catch (Exception ex)
        {
            // 活跃上报失败不影响用户打开应用。
            _logger.LogWarning(
                ex,
                "[LoginRecord] 更新设备活跃时间失败 userId={UserId}",
                userId);
        }
    }

    /// <summary>
    /// 登出 / 撤销时调用：把该用户尚未退出的登录记录回填 <c>logout_at</c>。
    /// <paramref name="sessionId"/> 为 null 表示该用户全部未退出记录（全端下线）。
    /// 内部 try/catch + ILogger，失败只打日志，不影响主流程。
    /// </summary>
    /// <param name="userId">用户 ID。</param>
    /// <param name="sessionId">设备会话标识；null 表示该用户全部未退出记录。</param>
    /// <param name="ct">取消标记。</param>
    /// <returns>异步任务。</returns>
    public async Task MarkLoggedOutAsync(ulong userId, string? sessionId, CancellationToken ct = default)
    {
        try
        {
            var query = _db.UserLoginRecords
                .Where(r => r.UserId == userId && r.LogoutAt == null);

            if (!string.IsNullOrWhiteSpace(sessionId))
                query = query.Where(r => r.SessionId == sessionId);

            var records = await query.ToListAsync(ct);
            if (records.Count == 0)
                return;

            var now = DateTime.UtcNow;
            foreach (var record in records)
                record.LogoutAt = now;

            await _db.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            // 标记失败不影响登出 / 撤销本身。
            _logger.LogWarning(
                ex,
                "[LoginRecord] 标记登录记录退出失败 userId={UserId} sid={SessionId}",
                userId,
                sessionId);
        }
    }

    /// <summary>
    /// 旧客户端没有 <c>X-Device-Id</c> 时的设备指纹兜底：
    /// <c>"ua:" + SHA256(platform + "|" + deviceDisplay)</c> 取前 32 位 hex。
    /// </summary>
    /// <param name="platform">平台标识。</param>
    /// <param name="device">设备展示名。</param>
    /// <returns>设备 key（总长 35，符合 varchar(64)）。</returns>
    static string BuildFallbackDeviceKey(string platform, string device)
    {
        var raw = $"{platform}|{device}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        var hex = Convert.ToHexString(hash).ToLowerInvariant();
        return FallbackDeviceKeyPrefix + hex[..FallbackDeviceKeyHashLength];
    }

    /// <summary>按数据库列宽截断字符串；空值原样返回。</summary>
    /// <param name="value">原字符串。</param>
    /// <param name="maxLength">最大长度。</param>
    /// <returns>截断后的字符串。</returns>
    static string? Truncate(string? value, int maxLength)
    {
        if (value == null)
            return null;

        return value.Length <= maxLength ? value : value[..maxLength];
    }
}
