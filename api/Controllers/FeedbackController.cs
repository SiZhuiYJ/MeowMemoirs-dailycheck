using System;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using api.Data;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace api.Controllers;

/// <summary>
/// 意见反馈接口（普通用户提交 / 查看自己的反馈；管理员查看全部并回复）。
///
/// <para>
/// 数据源是单表 <c>feedbacks</c>：管理员回复写回同一条反馈记录
/// （<c>reply_content</c> / <c>replied_by_user_id</c> / <c>replied_at</c>），
/// 重复回复视为覆盖，不保留历史回复版本。
/// </para>
/// <para>
/// 权限：用户接口（POST / GET mine）只看当前登录用户自己的数据；
/// 管理接口（GET 列表 / POST reply）每次都**查库**确认 <c>users.role = "admin"</c>，
/// 不只看 JWT 里的 role claim：claim 在令牌有效期内无法即时反映降权，
/// 而反馈列表会带出所有用户的邮箱 / 账号，属敏感数据，必须每次以数据库为准。
/// </para>
/// <para>
/// 时间字段一律按 UTC 存取，返回时标记为 UTC（JSON 带 Z），由客户端转本地时区展示。
/// </para>
/// </summary>
[ApiController]
[Route("mm/[controller]")]
[Authorize]
public class FeedbackController(DailyCheckDbContext db) : ControllerBase
{
    /// <summary>反馈内容与回复内容的最大字符数。</summary>
    const int MaxContentLength = 2000;

    /// <summary>联系方式的最大字符数。</summary>
    const int MaxContactLength = 128;

    /// <summary>管理员关键词搜索的最大字符数（超出部分截断，避免超长 LIKE）。</summary>
    const int MaxKeywordLength = 100;

    /// <summary>分页默认每页数量。</summary>
    const int DefaultPageSize = 20;

    /// <summary>分页最大每页数量。</summary>
    const int MaxPageSize = 50;

    readonly DailyCheckDbContext _db = db;

    /// <summary>
    /// 提交反馈（当前登录用户）。
    ///
    /// <para>
    /// 内容 trim 后必须在 1..2000 字符；联系方式 trim 后空串按不填处理（存 NULL）；
    /// <c>app</c> 只有小程序的 "mp" 记为 mp，其余（含缺省 / 非法值）一律按网页 web 记录。
    /// 新反馈状态为 pending，返回本人视角的反馈 DTO。
    /// </para>
    /// </summary>
    /// <param name="request">反馈内容、可选联系方式、来源端。</param>
    /// <param name="cancellationToken">取消标记。</param>
    /// <returns>刚提交的反馈。</returns>
    /// <response code="200">提交成功</response>
    /// <response code="400">反馈内容 / 联系方式不合法</response>
    /// <response code="401">未登录或登录状态已失效</response>
    [HttpPost]
    public async Task<ActionResult<FeedbackItemDto>> CreateFeedback(
        [FromBody] CreateFeedbackRequest request,
        CancellationToken cancellationToken = default)
    {
        var content = (request.Content ?? string.Empty).Trim();
        if (content.Length == 0)
            return BadRequest(new { message = "反馈内容不能为空" });
        if (content.Length > MaxContentLength)
            return BadRequest(new { message = $"反馈内容不能超过 {MaxContentLength} 个字符" });

        var contact = string.IsNullOrWhiteSpace(request.Contact) ? null : request.Contact.Trim();
        if (contact is { Length: > MaxContactLength })
            return BadRequest(new { message = $"联系方式不能超过 {MaxContactLength} 个字符" });

        // 只认小程序的 "mp"，其余来源（含没有传 app 的旧客户端）都按网页处理，
        // 这样前端 tab 的来源统计不会因为客户端漏传而出现空值分组。
        var app = string.Equals(request.App?.Trim(), "mp", StringComparison.OrdinalIgnoreCase)
            ? "mp"
            : "web";

        var now = DateTime.UtcNow;
        var feedback = new Feedback
        {
            UserId = GetUserId(),
            Content = content,
            Contact = contact,
            App = app,
            Status = "pending",
            IsDeleted = false,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.Feedbacks.Add(feedback);
        await _db.SaveChangesAsync(cancellationToken);

        return Ok(ToItemDto(feedback));
    }

    /// <summary>
    /// 分页获取当前用户自己提交的反馈（「我的反馈」）。
    ///
    /// <para>
    /// 只返回本人且未删除的反馈，按提交时间倒序（同一时间按 ID 倒序保证分页稳定）。
    /// </para>
    /// </summary>
    /// <param name="page">页码，默认 1，小于 1 按 1 处理。</param>
    /// <param name="pageSize">每页数量，默认 20，取值夹到 1..50。</param>
    /// <param name="cancellationToken">取消标记。</param>
    /// <returns>当前用户的反馈分页结果。</returns>
    /// <response code="200">获取成功</response>
    /// <response code="401">未登录或登录状态已失效</response>
    [HttpGet("mine")]
    public async Task<ActionResult<MyFeedbackListResponse>> GetMyFeedbacks(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = DefaultPageSize,
        CancellationToken cancellationToken = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var userId = GetUserId();
        var query = _db.Feedbacks
            .AsNoTracking()
            .Where(f => f.UserId == userId && !f.IsDeleted);

        var total = await query.CountAsync(cancellationToken);
        var rows = await query
            .OrderByDescending(f => f.CreatedAt)
            .ThenByDescending(f => f.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return Ok(new MyFeedbackListResponse
        {
            Page = page,
            PageSize = pageSize,
            Total = total,
            Items = rows.Select(ToItemDto).ToList()
        });
    }

    /// <summary>
    /// 管理员分页查看全部意见。
    ///
    /// <para>
    /// 支持状态（pending / replied / all）、来源端（web / mp / all）与关键词筛选；
    /// 关键词同时匹配反馈内容、联系方式与提交用户（邮箱 / 账号 / 昵称），
    /// 用户即使被伪删除也仍能展示其历史反馈（这里不按 users.is_deleted 过滤）。
    /// <c>pendingTotal</c> / <c>repliedTotal</c> 是全部未删除反馈的统计，
    /// 不受关键词 / 来源筛选影响，供前端 tab 徽标显示。
    /// </para>
    /// </summary>
    /// <param name="page">页码，默认 1，小于 1 按 1 处理。</param>
    /// <param name="pageSize">每页数量，默认 20，取值夹到 1..50。</param>
    /// <param name="status">状态筛选：pending / replied / all（缺省或非法按 all）。</param>
    /// <param name="keyword">关键词（trim，最多取前 100 字符；空表示不过滤）。</param>
    /// <param name="app">来源端筛选：web / mp / all（缺省或非法按 all）。</param>
    /// <param name="cancellationToken">取消标记。</param>
    /// <returns>全部反馈分页结果（含待回复 / 已回复总数）。</returns>
    /// <response code="200">获取成功</response>
    /// <response code="401">未登录或登录状态已失效</response>
    /// <response code="403">当前用户不是管理员</response>
    [HttpGet]
    public async Task<ActionResult<AdminFeedbackListResponse>> GetAllFeedbacks(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = DefaultPageSize,
        [FromQuery] string? status = "all",
        [FromQuery] string? keyword = null,
        [FromQuery] string? app = "all",
        CancellationToken cancellationToken = default)
    {
        var userId = GetUserId();
        if (!await IsAdminAsync(userId, cancellationToken))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "仅管理员可查看全部反馈" });

        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        var normalizedStatus = NormalizeEnumFilter(status, "pending", "replied");
        var normalizedApp = NormalizeEnumFilter(app, "web", "mp");

        var normalizedKeyword = (keyword ?? string.Empty).Trim();
        if (normalizedKeyword.Length > MaxKeywordLength)
            normalizedKeyword = normalizedKeyword[..MaxKeywordLength];

        // 左连接 users 而不是内连接：user_id 有外键、正常不会孤儿，但用户被伪删除时
        // 仍要展示其历史反馈，左连接 + 不按 users.is_deleted 过滤更稳。
        var joined = from f in _db.Feedbacks.AsNoTracking()
                     join u in _db.Users.AsNoTracking()
                         on f.UserId equals u.Id into users
                     from u in users.DefaultIfEmpty()
                     where !f.IsDeleted
                     select new { Feedback = f, User = u };

        if (normalizedStatus != "all")
            joined = joined.Where(x => x.Feedback.Status == normalizedStatus);
        if (normalizedApp != "all")
            joined = joined.Where(x => x.Feedback.App == normalizedApp);
        if (normalizedKeyword.Length > 0)
        {
            var kw = normalizedKeyword;
            joined = joined.Where(x =>
                x.Feedback.Content.Contains(kw)
                || (x.Feedback.Contact != null && x.Feedback.Contact.Contains(kw))
                || (x.User.Email != null && x.User.Email.Contains(kw))
                || (x.User.UserAccount != null && x.User.UserAccount.Contains(kw))
                || (x.User.NickName != null && x.User.NickName.Contains(kw)));
        }

        var total = await joined.CountAsync(cancellationToken);

        // tab 徽标统计：不受关键词 / 来源 / 状态筛选影响，每次都是全量未删除反馈的分布。
        var pendingTotal = await _db.Feedbacks
            .AsNoTracking()
            .CountAsync(f => !f.IsDeleted && f.Status == "pending", cancellationToken);
        var repliedTotal = await _db.Feedbacks
            .AsNoTracking()
            .CountAsync(f => !f.IsDeleted && f.Status == "replied", cancellationToken);

        var rows = await joined
            .OrderByDescending(x => x.Feedback.CreatedAt)
            .ThenByDescending(x => x.Feedback.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return Ok(new AdminFeedbackListResponse
        {
            Page = page,
            PageSize = pageSize,
            Total = total,
            PendingTotal = pendingTotal,
            RepliedTotal = repliedTotal,
            Status = normalizedStatus,
            Keyword = normalizedKeyword.Length == 0 ? null : normalizedKeyword,
            App = normalizedApp,
            Items = rows
                .Select(x => ToAdminItemDto(
                    x.Feedback, x.User?.UserAccount, x.User?.NickName, x.User?.Email))
                .ToList()
        });
    }

    /// <summary>
    /// 管理员回复反馈（重复回复视为覆盖，保留最后一条回复）。
    ///
    /// <para>
    /// 回复内容 trim 后必须在 1..2000 字符；反馈不存在或已伪删除返回 404。
    /// 回复后状态置为 replied，并记录回复管理员与回复时间（UTC）。
    /// </para>
    /// </summary>
    /// <param name="id">反馈 ID。</param>
    /// <param name="request">回复内容。</param>
    /// <param name="cancellationToken">取消标记。</param>
    /// <returns>回复后的反馈（管理员视角，含提交用户身份）。</returns>
    /// <response code="200">回复成功</response>
    /// <response code="400">回复内容不合法</response>
    /// <response code="401">未登录或登录状态已失效</response>
    /// <response code="403">当前用户不是管理员</response>
    /// <response code="404">反馈不存在</response>
    [HttpPost("{id:ulong}/reply")]
    public async Task<ActionResult<AdminFeedbackItemDto>> ReplyFeedback(
        ulong id,
        [FromBody] ReplyFeedbackRequest request,
        CancellationToken cancellationToken = default)
    {
        var adminId = GetUserId();
        if (!await IsAdminAsync(adminId, cancellationToken))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "仅管理员可查看全部反馈" });

        var replyContent = (request.ReplyContent ?? string.Empty).Trim();
        if (replyContent.Length == 0)
            return BadRequest(new { message = "回复内容不能为空" });
        if (replyContent.Length > MaxContentLength)
            return BadRequest(new { message = $"回复内容不能超过 {MaxContentLength} 个字符" });

        var feedback = await _db.Feedbacks
            .FirstOrDefaultAsync(f => f.Id == id && !f.IsDeleted, cancellationToken);
        if (feedback == null)
            return NotFound(new { message = "反馈不存在" });

        var now = DateTime.UtcNow;
        feedback.ReplyContent = replyContent;
        feedback.Status = "replied";
        feedback.RepliedByUserId = adminId;
        feedback.RepliedAt = now;
        feedback.UpdatedAt = now;

        await _db.SaveChangesAsync(cancellationToken);

        // 返回给管理端的 DTO 需要提交用户身份；此时反馈一定还挂在某个用户上（外键级联），
        // 用户即使被伪删除也照常展示其历史信息。
        var owner = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == feedback.UserId)
            .Select(u => new { u.UserAccount, u.NickName, u.Email })
            .FirstOrDefaultAsync(cancellationToken);

        return Ok(ToAdminItemDto(feedback, owner?.UserAccount, owner?.NickName, owner?.Email));
    }

    /// <summary>
    /// 查库判断当前用户是否为管理员。
    /// 不依赖 JWT 的 role claim：claim 在令牌有效期内是快照，管理员被降权后旧令牌仍带 admin。
    /// </summary>
    /// <param name="userId">当前用户 ID。</param>
    /// <param name="cancellationToken">取消标记。</param>
    /// <returns>是管理员返回 true；用户不存在 / 已删除 / 角色不是 admin 返回 false。</returns>
    async Task<bool> IsAdminAsync(ulong userId, CancellationToken cancellationToken)
    {
        var role = await _db.Users
            .AsNoTracking()
            .Where(x => x.Id == userId && !x.IsDeleted)
            .Select(x => x.Role)
            .FirstOrDefaultAsync(cancellationToken);

        return string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 规范化枚举类筛选参数：只允许白名单值，其余（含 null / 空串 / 非法值）按 all。
    /// </summary>
    /// <param name="raw">原始参数值。</param>
    /// <param name="allowedFirst">第一个合法值。</param>
    /// <param name="allowedSecond">第二个合法值。</param>
    /// <returns>规范化后的值（allowedFirst / allowedSecond / all）。</returns>
    static string NormalizeEnumFilter(string? raw, string allowedFirst, string allowedSecond)
    {
        var value = (raw ?? string.Empty).Trim().ToLowerInvariant();
        if (value == allowedFirst)
            return allowedFirst;
        if (value == allowedSecond)
            return allowedSecond;
        return "all";
    }

    /// <summary>实体 → 本人视角的反馈 DTO（时间统一标记为 UTC）。</summary>
    /// <param name="feedback">反馈实体。</param>
    /// <returns>反馈 DTO。</returns>
    static FeedbackItemDto ToItemDto(Feedback feedback)
    {
        return new FeedbackItemDto
        {
            Id = unchecked((long)feedback.Id),
            Content = feedback.Content,
            Contact = feedback.Contact,
            App = feedback.App,
            Status = feedback.Status,
            ReplyContent = feedback.ReplyContent,
            RepliedAt = AsUtc(feedback.RepliedAt),
            CreatedAt = AsUtc(feedback.CreatedAt)
        };
    }

    /// <summary>实体 + 提交用户身份 → 管理员视角的反馈 DTO。</summary>
    /// <param name="feedback">反馈实体。</param>
    /// <param name="userAccount">提交用户账号（可能为 null）。</param>
    /// <param name="nickName">提交用户昵称（可能为 null）。</param>
    /// <param name="email">提交用户邮箱（可能为 null）。</param>
    /// <returns>管理员反馈 DTO。</returns>
    static AdminFeedbackItemDto ToAdminItemDto(
        Feedback feedback,
        string? userAccount,
        string? nickName,
        string? email)
    {
        return new AdminFeedbackItemDto
        {
            Id = unchecked((long)feedback.Id),
            Content = feedback.Content,
            Contact = feedback.Contact,
            App = feedback.App,
            Status = feedback.Status,
            ReplyContent = feedback.ReplyContent,
            RepliedAt = AsUtc(feedback.RepliedAt),
            CreatedAt = AsUtc(feedback.CreatedAt),
            UserId = unchecked((long)feedback.UserId),
            UserAccount = userAccount,
            NickName = nickName,
            Email = email
        };
    }

    /// <summary>把数据库读出的 datetime（Kind=Unspecified，实际为 UTC）标记为 UTC，保证 JSON 带 Z。</summary>
    /// <param name="value">数据库时间。</param>
    /// <returns>Kind=Utc 的时间。</returns>
    static DateTime AsUtc(DateTime value)
        => value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    /// <summary>可空时间版本的 <see cref="AsUtc(DateTime)"/>；null 原样返回。</summary>
    /// <param name="value">数据库时间（可能为 null）。</param>
    /// <returns>Kind=Utc 的时间；null 返回 null。</returns>
    static DateTime? AsUtc(DateTime? value)
        => value.HasValue ? AsUtc(value.Value) : null;

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
