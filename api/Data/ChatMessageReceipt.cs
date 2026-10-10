using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 消息已读回执表
/// </summary>
public partial class ChatMessageReceipt
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 消息ID
    /// </summary>
    public ulong MessageId { get; set; }

    /// <summary>
    /// 已读用户ID
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 已读时间
    /// </summary>
    public DateTime ReadAt { get; set; }

    public virtual ChatMessage Message { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
