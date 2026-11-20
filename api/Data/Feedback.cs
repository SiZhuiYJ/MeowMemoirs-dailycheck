using System;

namespace api.Data;

/// <summary>
/// 用户意见反馈（普通用户提交，管理员在同一行上回复）。
///
/// <para>
/// 回复直接写在反馈行上（<see cref="ReplyContent"/> / <see cref="RepliedByUserId"/> /
/// <see cref="RepliedAt"/>），不另建回复表：当前业务一条反馈只需一次回复，
/// 重复回复视为覆盖，单表能减少 join 并让前端一次拿全展示所需字段。
/// </para>
/// <para>
/// 删除使用 <see cref="IsDeleted"/> 伪删除；时间字段一律为 UTC（与项目其它模块一致），
/// 展示时由客户端转本地时区。
/// </para>
/// </summary>
public partial class Feedback
{
    /// <summary>反馈 ID</summary>
    public ulong Id { get; set; }

    /// <summary>提交用户 ID</summary>
    public ulong UserId { get; set; }

    /// <summary>反馈内容（不超过 2000 字符，已 trim）</summary>
    public string Content { get; set; } = null!;

    /// <summary>联系方式（可选，邮箱 / 手机号 / QQ 等，已 trim，空串存 NULL）</summary>
    public string? Contact { get; set; }

    /// <summary>来源端：web 网页，mp 小程序</summary>
    public string App { get; set; } = null!;

    /// <summary>处理状态：pending 待回复，replied 已回复</summary>
    public string Status { get; set; } = null!;

    /// <summary>管理员回复内容（未回复为 NULL，已 trim）</summary>
    public string? ReplyContent { get; set; }

    /// <summary>回复管理员 ID（未回复为 NULL）</summary>
    public ulong? RepliedByUserId { get; set; }

    /// <summary>回复时间（UTC，未回复为 NULL）</summary>
    public DateTime? RepliedAt { get; set; }

    /// <summary>是否伪删除：0正常，1已删除</summary>
    public bool IsDeleted { get; set; }

    /// <summary>提交时间（UTC）</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>更新时间（UTC，提交/回复时刷新）</summary>
    public DateTime UpdatedAt { get; set; }
}
