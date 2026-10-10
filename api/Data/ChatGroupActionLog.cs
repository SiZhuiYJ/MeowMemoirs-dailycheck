using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 群操作日志表
/// </summary>
public partial class ChatGroupActionLog
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 群聊会话ID
    /// </summary>
    public ulong ConversationId { get; set; }

    /// <summary>
    /// 群操作类型
    /// </summary>
    public string ActionType { get; set; } = null!;

    /// <summary>
    /// 操作者用户ID
    /// </summary>
    public ulong? OperatorUserId { get; set; }

    /// <summary>
    /// 目标用户ID
    /// </summary>
    public ulong? TargetUserId { get; set; }

    /// <summary>
    /// 关联系统消息ID
    /// </summary>
    public ulong? RelatedMessageId { get; set; }

    /// <summary>
    /// 操作原因
    /// </summary>
    public string? ActionReason { get; set; }

    /// <summary>
    /// 额外JSON负载数据
    /// </summary>
    public string? ActionPayload { get; set; }

    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    public virtual ChatConversation Conversation { get; set; } = null!;

    public virtual User? OperatorUser { get; set; }

    public virtual ChatMessage? RelatedMessage { get; set; }

    public virtual User? TargetUser { get; set; }
}
