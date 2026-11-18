using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using api.Data;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

namespace api.Controllers;

/// <summary>
/// 登录记录相关接口。
///
/// <para>
/// 数据来源为 <c>user_login_records</c>：每次成功登录写一条（IP / 设备 / 登录方式 /
/// GeoCN 离线解析出的国内省市区），登出 / 撤销 / 改密时回填退出时间。
/// 本接口只返回当前登录用户自己的记录。
/// </para>
/// </summary>
[ApiController]
[Route("mm/[controller]")]
[Authorize]
public class LoginRecordsController(
    DailyCheckDbContext db,
    IConnectionMultiplexer? redis) : ControllerBase
{
    readonly DailyCheckDbContext _db = db;
    readonly IDatabase? _redisDb = redis?.GetDatabase();

    /// <summary>
    /// 分页获取当前登录用户的登录记录。
    ///
    /// <para>
    /// <c>scope=domestic</c>（默认）只返回中国大陆 IP 记录；<c>scope=all</c> 返回全部记录
    /// （含境外 / 内网）。每条记录带 <c>status</c> 三态：
    /// <c>current</c>（当前请求令牌对应的设备会话）、<c>logged_out</c>（已登出 / 被撤销）、
    /// <c>active</c>（仍在线）。
    /// </para>
    /// </summary>
    /// <param name="page">页码，默认 1，小于 1 按 1 处理。</param>
    /// <param name="pageSize">每页数量，默认 20，取值夹到 1..50。</param>
    /// <param name="scope">记录范围：domestic（默认，国内）/ all（全部），非法值按 domestic。</param>
    /// <param name="cancellationToken">取消标记。</param>
    /// <returns>分页登录记录，含 total / domesticTotal / allTotal 计数。</returns>
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
        var currentSessionId = GetCurrentSessionId();

        var baseQuery = _db.UserLoginRecords
            .AsNoTracking()
            .Where(r => r.UserId == userId);

        var allTotal = await baseQuery.CountAsync(cancellationToken);
        var domesticTotal = await baseQuery.CountAsync(r => r.IsDomestic, cancellationToken);
        var total = normalizedScope == "all" ? allTotal : domesticTotal;

        var scopeQuery = normalizedScope == "all"
            ? baseQuery
            : baseQuery.Where(r => r.IsDomestic);

        var rows = await scopeQuery
            .OrderByDescending(r => r.LoginAt)
            .ThenByDescending(r => r.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(r => new
            {
                r.Id,
                r.SessionId,
                r.Device,
                r.Platform,
                r.LoginType,
                r.Location,
                r.Ip,
                r.Province,
                r.City,
                r.District,
                r.Isp,
                r.IsDomestic,
                r.LoginAt,
                r.LogoutAt
            })
            .ToListAsync(cancellationToken);

        // Redis 撤销状态：一次 MGET 查「账号级撤销时间戳 + 本页各 sid 的设备级撤销标记」。
        // Redis 不可用时只按 DB 的 logout_at 判定，不影响接口返回。
        long? revokedBefore = null;
        var revokedSids = new HashSet<string>(StringComparer.Ordinal);

        if (_redisDb != null && rows.Count > 0)
        {
            try
            {
                var keys = new List<RedisKey> { $"auth_revoked_before:{userId}" };
                var rowSids = rows
                    .Select(r => r.SessionId)
                    .Where(sid => !string.IsNullOrEmpty(sid))
                    .Distinct(StringComparer.Ordinal)
                    .ToList();

                foreach (var sid in rowSids)
                    keys.Add($"revoked_sid:{sid}");

                var values = await _redisDb.StringGetAsync(keys.ToArray());

                if (values.Length > 0 && !values[0].IsNullOrEmpty &&
                    long.TryParse(values[0].ToString(), out var epoch))
                {
                    revokedBefore = epoch;
                }

                for (var i = 0; i < rowSids.Count && i + 1 < values.Length; i++)
                {
                    if (!values[i + 1].IsNullOrEmpty)
                        revokedSids.Add(rowSids[i]);
                }
            }
            catch (Exception)
            {
                // Redis 故障容错：撤销状态只按 logout_at 判定。
            }
        }

        var items = rows
            .Select(r => new LoginRecordItem
            {
                Id = unchecked((long)r.Id),
                Device = r.Device,
                Platform = r.Platform,
                LoginType = r.LoginType,
                Location = r.Location,
                IpMasked = MaskIp(r.Ip),
                Province = r.Province,
                City = r.City,
                District = r.District,
                Isp = r.Isp,
                IsDomestic = r.IsDomestic,
                Status = ResolveStatus(
                    r.SessionId, currentSessionId, r.LoginAt, r.LogoutAt, revokedBefore, revokedSids),
                LoginAt = AsUtc(r.LoginAt),
                LogoutAt = r.LogoutAt.HasValue ? AsUtc(r.LogoutAt.Value) : null
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
    /// 计算单条记录状态：current（当前请求令牌对应的会话）→ logged_out（已退出 / 被撤销）→ active。
    /// </summary>
    /// <param name="sessionId">记录的设备会话标识。</param>
    /// <param name="currentSessionId">当前请求令牌的 sid。</param>
    /// <param name="loginAt">登录时间（UTC）。</param>
    /// <param name="logoutAt">退出时间（UTC，未退出为 null）。</param>
    /// <param name="revokedBefore">账号级撤销时间戳（epoch 秒），无则 null。</param>
    /// <param name="revokedSids">已撤销的设备 sid 集合。</param>
    /// <returns>current / logged_out / active。</returns>
    static string ResolveStatus(
        string sessionId,
        string? currentSessionId,
        DateTime loginAt,
        DateTime? logoutAt,
        long? revokedBefore,
        HashSet<string> revokedSids)
    {
        if (!string.IsNullOrEmpty(currentSessionId) &&
            string.Equals(sessionId, currentSessionId, StringComparison.Ordinal))
        {
            return "current";
        }

        if (logoutAt.HasValue)
            return "logged_out";

        if (!string.IsNullOrEmpty(sessionId) && revokedSids.Contains(sessionId))
            return "logged_out";

        if (revokedBefore.HasValue && ToEpochSeconds(loginAt) <= revokedBefore.Value)
            return "logged_out";

        return "active";
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

    /// <summary>把 UTC 时间转成 Unix 秒。</summary>
    /// <param name="value">UTC 时间。</param>
    /// <returns>Unix 秒。</returns>
    static long ToEpochSeconds(DateTime value)
        => new DateTimeOffset(AsUtc(value)).ToUnixTimeSeconds();

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
