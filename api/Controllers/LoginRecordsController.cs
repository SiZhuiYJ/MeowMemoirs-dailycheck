using System;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using api.Data;
using api.Infrastructure;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace api.Controllers;

/// <summary>
/// 登录记录相关接口（设备列表 + 最后活跃时间）。
///
/// <para>
/// 数据来源为两张表：<c>user_login_devices</c>（一台设备一行，(user_id, device_key) 唯一，
/// 带 <c>last_active_at</c>）与 <c>user_login_records</c>（每次成功登录一条）。
/// GET 返回当前用户**每台设备 + 该设备最后一次登录记录 + 最后活跃时间**（一台设备一项），
/// 按设备最后活跃时间倒序；POST /active 用于客户端打开小程序 / 网页时上报活跃。
/// </para>
/// </summary>
[ApiController]
[Route("mm/[controller]")]
[Authorize]
public class LoginRecordsController(DailyCheckDbContext db) : ControllerBase
{
    readonly DailyCheckDbContext _db = db;

    /// <summary>
    /// 分页获取当前登录用户的登录设备列表（每台设备附带该设备最后一次登录记录）。
    ///
    /// <para>
    /// <c>scope=domestic</c>（默认）只返回「最后一次登录为国内」的设备；<c>scope=all</c> 返回
    /// 全部设备（含最后登录为境外 / 内网）。计数均为**设备数**。
    /// 每项带 <c>lastActiveAt</c>（最后活跃时间）与 <c>isCurrent</c>（是否当前请求所在设备）：
    /// 优先用请求头 <c>X-Device-Id</c> 匹配设备，没有该头时兜底用该设备最后一条登录记录的
    /// <c>session_id</c> 与当前令牌 sid 比对。按设备最后活跃时间倒序。
    /// </para>
    /// </summary>
    /// <param name="page">页码，默认 1，小于 1 按 1 处理。</param>
    /// <param name="pageSize">每页数量，默认 20，取值夹到 1..50。</param>
    /// <param name="scope">设备范围：domestic（默认，国内）/ all（全部），非法值按 domestic。</param>
    /// <param name="cancellationToken">取消标记。</param>
    /// <returns>分页登录设备，含 total / domesticTotal / allTotal 设备计数。</returns>
    /// <response code="200">获取成功</response>
    /// <response code="401">未登录或登录状态已失效</response>
    [HttpGet]
    public async Task<ActionResult<LoginRecordListResponse>> GetLoginRecords(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? scope = "domestic",
        CancellationToken cancellationToken = default)
    {
        var normalizedScope = string.Equals(scope?.Trim(), "all", StringComparison.OrdinalIgnoreCase)
            ? "all"
            : "domestic";
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 50);

        var userId = GetUserId();
        var currentDeviceKey = ClientContextResolver.ResolveDeviceId(HttpContext);
        var currentSessionId = GetCurrentSessionId();

        // 每台设备 left join 它的最后一次登录记录（last_login_record_id），一条 SQL 取全，
        // 避免「先查设备再逐台查记录」的 N+1。设备可能是「只上报过活跃、没登录记录」的新设备，
        // 所以用 left join，记录为空时登录相关字段按设备时间兜底。
        var joined = from d in _db.UserLoginDevices.AsNoTracking()
                     join r in _db.UserLoginRecords.AsNoTracking()
                         on (ulong?)d.LastLoginRecordId equals (ulong?)r.Id into records
                     from r in records.DefaultIfEmpty()
                     where d.UserId == userId
                     select new
                     {
                         DeviceId = d.Id,
                         d.DeviceKey,
                         d.Device,
                         d.Platform,
                         d.LastLoginAt,
                         d.LastActiveAt,
                         Record = r
                     };

        var allTotal = await joined.CountAsync(cancellationToken);
        var domesticTotal = await joined.CountAsync(
            x => x.Record != null && x.Record.IsDomestic, cancellationToken);
        var total = normalizedScope == "all" ? allTotal : domesticTotal;

        var scopeQuery = normalizedScope == "all"
            ? joined
            : joined.Where(x => x.Record != null && x.Record.IsDomestic);

        var rows = await scopeQuery
            .OrderByDescending(x => x.LastActiveAt)
            .ThenByDescending(x => x.DeviceId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var items = rows
            .Select(x => new LoginRecordItem
            {
                DeviceId = unchecked((long)x.DeviceId),
                Device = x.Device,
                Platform = x.Platform,
                LoginType = x.Record?.LoginType ?? string.Empty,
                Location = x.Record?.Location,
                IpMasked = MaskIp(x.Record?.Ip),
                Province = x.Record?.Province,
                City = x.Record?.City,
                District = x.Record?.District,
                Isp = x.Record?.Isp,
                IsDomestic = x.Record?.IsDomestic ?? false,
                LastActiveAt = AsUtc(x.LastActiveAt),
                IsCurrent = ResolveIsCurrent(
                    x.DeviceKey, x.Record, currentDeviceKey, currentSessionId),
                // 设备一定有最后登录时间；从未登录过（只上报过活跃）时退化为设备创建时间。
                LoginAt = AsUtc(x.Record?.LoginAt ?? x.LastLoginAt)
            })
            .ToList();

        return Ok(new LoginRecordListResponse
        {
            Scope = normalizedScope,
            Page = page,
            PageSize = pageSize,
            Total = total,
            DomesticTotal = domesticTotal,
            AllTotal = allTotal,
            Items = items
        });
    }

    /// <summary>
    /// 上报当前设备活跃（客户端打开小程序 / 网页时调用）：更新该设备的最后活跃时间。
    /// 设备识别与登录一致（<c>X-Device-Id</c>，无头时 UA 指纹）；未见过的新设备会创建一条设备记录
    /// （没有登录记录）。上报失败不影响客户端打开应用（服务内部吞异常只打日志）。
    /// </summary>
    /// <param name="loginRecordService">登录记录服务（依赖注入）。</param>
    /// <param name="cancellationToken">取消标记。</param>
    /// <returns>本次上报后的最后活跃时间（UTC）。</returns>
    /// <response code="200">上报成功，返回 lastActiveAt</response>
    /// <response code="401">未登录或登录状态已失效</response>
    [HttpPost("active")]
    public async Task<ActionResult<LoginRecordActiveResponse>> ReportActive(
        [FromServices] ILoginRecordService loginRecordService,
        CancellationToken cancellationToken = default)
    {
        var userId = GetUserId();
        var now = DateTime.UtcNow;

        await loginRecordService.TouchDeviceAsync(userId, HttpContext, cancellationToken);

        return Ok(new LoginRecordActiveResponse { LastActiveAt = now });
    }

    /// <summary>
    /// 判断某台设备是否是当前请求所在设备：
    /// 优先用请求头 <c>X-Device-Id</c> 匹配 <c>device_key</c>；
    /// 没有该头（旧客户端）时兜底用该设备最后一条登录记录的 <c>session_id</c> 与当前令牌 sid 比对。
    /// </summary>
    /// <param name="deviceKey">设备的 device_key。</param>
    /// <param name="record">该设备最后一次登录记录（可能为空）。</param>
    /// <param name="currentDeviceKey">当前请求头解析出的 device key（无则为 null）。</param>
    /// <param name="currentSessionId">当前令牌的 sid。</param>
    /// <returns>是当前设备返回 true。</returns>
    static bool ResolveIsCurrent(
        string deviceKey,
        UserLoginRecord? record,
        string? currentDeviceKey,
        string? currentSessionId)
    {
        if (!string.IsNullOrEmpty(currentDeviceKey))
            return string.Equals(deviceKey, currentDeviceKey, StringComparison.Ordinal);

        if (string.IsNullOrEmpty(currentSessionId) || record == null)
            return false;

        return string.Equals(record.SessionId, currentSessionId, StringComparison.Ordinal);
    }

    /// <summary>IP 脱敏：IPv4 只留前两段（222.137.*.*）；IPv6 只留前两组（240e:476:*）；空 IP 返回 null。</summary>
    /// <param name="ip">原始 IP（v4 / v6）。</param>
    /// <returns>脱敏后的 IP 字符串。</returns>
    static string? MaskIp(string? ip)
    {
        if (string.IsNullOrWhiteSpace(ip))
            return null;

        if (!IPAddress.TryParse(ip.Trim(), out var address))
            return null;

        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            var parts = address.ToString().Split('.');
            return parts.Length == 4 ? $"{parts[0]}.{parts[1]}.*.*" : null;
        }

        // IPv6：只保留前两组（非空组），如 240e:476::1 → 240e:476:*。
        // 压缩后不足两组（如 ::1）无法做「部分保留」，直接返回 null（本地网络记录本身也不该暴露 IP）。
        var groups = address.ToString().Split(':', StringSplitOptions.RemoveEmptyEntries);
        return groups.Length >= 2 ? $"{groups[0]}:{groups[1]}:*" : null;
    }

    /// <summary>把数据库读出的 datetime（Kind=Unspecified，实际为 UTC）标记为 UTC，保证 JSON 带 Z。</summary>
    /// <param name="value">数据库时间。</param>
    /// <returns>Kind=Utc 的时间。</returns>
    static DateTime AsUtc(DateTime value)
        => value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    /// <summary>从当前访问令牌读取设备会话标识 sid。</summary>
    /// <returns>sid；读取失败返回 null。</returns>
    string? GetCurrentSessionId()
    {
        var rawToken = Request.Headers.Authorization.ToString().Replace("Bearer ", string.Empty).Trim();
        return ReadPayloadString(rawToken, "sid");
    }

    /// <summary>从原始 JWT 的 payload 读取字符串声明（不依赖 claim 类型映射）。</summary>
    /// <param name="rawToken">原始 JWT。</param>
    /// <param name="claimName">声明名。</param>
    /// <returns>声明值；不存在或解析失败返回 null。</returns>
    static string? ReadPayloadString(string rawToken, string claimName)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(rawToken))
                return null;

            var handler = new JwtSecurityTokenHandler();
            if (!handler.CanReadToken(rawToken))
                return null;

            var jwt = handler.ReadJwtToken(rawToken);
            return jwt.Payload.TryGetValue(claimName, out var value) ? value?.ToString() : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// 从当前访问令牌中解析用户 ID（与其它控制器保持一致的 Claim 兼容顺序）。
    /// </summary>
    /// <returns>当前登录用户 ID。</returns>
    ulong GetUserId()
    {
        var candidateTypes = new[] { ClaimTypes.NameIdentifier, "sub", "nameid", "user_id", "id" };

        foreach (var type in candidateTypes)
        {
            var value = User.FindFirstValue(type);
            if (string.IsNullOrEmpty(value))
                continue;

            if (ulong.TryParse(value, out var id))
                return id;

            throw new InvalidOperationException($"无法解析用户ID：claim '{type}' 的值为 '{value}'，不是有效的 ulong。");
        }

        throw new InvalidOperationException("在令牌中未找到用户ID。");
    }
}
