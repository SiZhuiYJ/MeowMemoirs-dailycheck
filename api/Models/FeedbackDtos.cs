using System;
using System.Collections.Generic;

namespace api.Models;

/// <summary>
/// 提交反馈请求参数。
/// </summary>
public class CreateFeedbackRequest
{
    /// <summary>
    /// 反馈内容（必填，trim 后非空且不超过 2000 个字符）。
    /// 声明为可空是为了在缺失字段时返回业务错误文案，而不是框架的模型校验 400。
    /// </summary>
    public string? Content { get; set; }

    /// <summary>
    /// 联系方式（可选，邮箱 / 手机号 / QQ 等；trim 后空串按不填处理，不超过 128 个字符）。
    /// </summary>
    public string? Contact { get; set; }

    /// <summary>
    /// 来源端：web 网页 / mp 小程序；仅 "mp" 记为 mp，其余（含缺省）按 web 处理。
    /// </summary>
    public string? App { get; set; }
}

/// <summary>
/// 管理员回复反馈请求参数。
/// </summary>
public class ReplyFeedbackRequest
{
    /// <summary>
    /// 回复内容（必填，trim 后非空且不超过 2000 个字符；重复回复视为覆盖）。
    /// </summary>
    public string? ReplyContent { get; set; }
}

/// <summary>
/// 单条反馈（普通用户视角：只看自己的反馈，不含用户身份字段）。
/// </summary>
public class FeedbackItemDto
{
    /// <summary>反馈 ID</summary>
    public long Id { get; set; }

    /// <summary>反馈内容</summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>联系方式（可选）</summary>
    public string? Contact { get; set; }

    /// <summary>来源端：web 网页 / mp 小程序</summary>
    public string App { get; set; } = "web";

    /// <summary>处理状态：pending 待回复 / replied 已回复</summary>
    public string Status { get; set; } = "pending";

    /// <summary>管理员回复内容（未回复为 null）</summary>
    public string? ReplyContent { get; set; }

    /// <summary>回复时间（UTC，未回复为 null）</summary>
    public DateTime? RepliedAt { get; set; }

    /// <summary>提交时间（UTC）</summary>
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// 单条反馈（管理员视角：在普通字段之外附带提交用户身份）。
/// </summary>
public class AdminFeedbackItemDto : FeedbackItemDto
{
    /// <summary>提交用户 ID</summary>
    public long UserId { get; set; }

    /// <summary>提交用户账号（用户被软删除后仍展示其历史反馈的账号）</summary>
    public string? UserAccount { get; set; }

    /// <summary>提交用户昵称</summary>
    public string? NickName { get; set; }

    /// <summary>提交用户邮箱</summary>
    public string? Email { get; set; }
}

/// <summary>
/// 「我的反馈」分页响应。
/// </summary>
public class MyFeedbackListResponse
{
    /// <summary>当前页码（从 1 开始）</summary>
    public int Page { get; set; } = 1;

    /// <summary>每页数量（1..50）</summary>
    public int PageSize { get; set; } = 20;

    /// <summary>当前用户的反馈总数（不含已删除）</summary>
    public int Total { get; set; }

    /// <summary>当前页反馈，按提交时间倒序</summary>
    public List<FeedbackItemDto> Items { get; set; } = new();
}

/// <summary>
/// 管理员「查看意见」分页响应。
/// </summary>
public class AdminFeedbackListResponse
{
    /// <summary>当前页码（从 1 开始）</summary>
    public int Page { get; set; } = 1;

    /// <summary>每页数量（1..50）</summary>
    public int PageSize { get; set; } = 20;

    /// <summary>当前筛选条件命中的反馈数</summary>
    public int Total { get; set; }

    /// <summary>全部未删除反馈中待回复的数量（不受关键词 / 来源筛选影响，供前端 tab 徽标）</summary>
    public int PendingTotal { get; set; }

    /// <summary>全部未删除反馈中已回复的数量（不受关键词 / 来源筛选影响，供前端 tab 徽标）</summary>
    public int RepliedTotal { get; set; }

    /// <summary>生效的状态筛选：pending / replied / all</summary>
    public string Status { get; set; } = "all";

    /// <summary>生效的关键词（trim 后；无关键词为 null）</summary>
    public string? Keyword { get; set; }

    /// <summary>生效的来源端筛选：web / mp / all</summary>
    public string App { get; set; } = "all";

    /// <summary>当前页反馈，按提交时间倒序</summary>
    public List<AdminFeedbackItemDto> Items { get; set; } = new();
}
