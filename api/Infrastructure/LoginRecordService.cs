using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using api.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.Infrastructure;

/// <summary>
/// 登录记录服务接口：登录成功时记录 IP / 设备 / 归属地，登出 / 撤销时回填退出时间。
/// 所有方法都**绝不抛异常**，失败只打日志，不能影响登录 / 登出主流程。
/// </summary>
public interface ILoginRecordService
{
    /// <summary>
    /// 登录成功后调用：解析客户端 IP / 设备 / User-Agent / GeoIP 归属地并写入一条登录记录。
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
    readonly DailyCheckDbContext _db = db;
    readonly IGeoIpService _geoIpService = geoIpService;
    readonly ILogger<LoginRecordService> _logger = logger;

    /// <summary>
    /// 登录成功后调用：解析客户端 IP / 设备 / User-Agent / GeoIP 归属地并写入一条登录记录。
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

            var record = new UserLoginRecord
            {
                UserId = user.Id,
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
                LoginAt = DateTime.UtcNow,
                LogoutAt = null
            };

            _db.UserLoginRecords.Add(record);
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
