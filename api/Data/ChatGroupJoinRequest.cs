using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 群聊加群申请记录表
/// </summary>
public partial class ChatGroupJoinRequest
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
    /// 申请人用户ID
    /// </summary>
    public ulong RequesterUserId { get; set; }

    /// <summary>
    /// 申请附言
    /// </summary>
    public string? RequestMessage { get; set; }

    /// <summary>
    /// 申请状态：pending=待处理,approved=已通过,rejected=已拒绝,expired=已过期
    /// </summary>
    public string RequestStatus { get; set; } = null!;

    /// <summary>
    /// 处理人用户ID
    /// </summary>
    public ulong? HandledByUserId { get; set; }

    /// <summary>
    /// 处理时间
    /// </summary>
    public DateTime? HandledAt { get; set; }

    /// <summary>
    /// 拒绝原因
    /// </summary>
    public string? RejectReason { get; set; }

    /// <summary>
    /// 申请过期时间
    /// </summary>
    public DateTime? ExpireAt { get; set; }

    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual ChatConversation Conversation { get; set; } = null!;

    public virtual User? HandledByUser { get; set; }

    public virtual User RequesterUser { get; set; } = null!;
}
