using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 用户黑名单记录表
/// </summary>
public partial class UserBlacklistRecord
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 被拉黑的用户ID
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 执行操作的管理员用户ID
    /// </summary>
    public ulong? OperatorUserId { get; set; }

    /// <summary>
    /// 拉黑或解封原因
    /// </summary>
    public string Reason { get; set; } = null!;

    /// <summary>
    /// 状态：1拉黑，0解封（历史记录）
    /// </summary>
    public bool Status { get; set; }

    /// <summary>
    /// 操作发生时间
    /// </summary>
    public DateTime OccurredAt { get; set; }

    public virtual User? OperatorUser { get; set; }

    public virtual User User { get; set; } = null!;
}
