using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 好友请求表
/// </summary>
public partial class UserFriendRequest
{
    /// <summary>
    /// 主键
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 请求者用户ID
    /// </summary>
    public ulong RequesterUserId { get; set; }

    /// <summary>
    /// 接收者用户ID
    /// </summary>
    public ulong ReceiverUserId { get; set; }

    /// <summary>
    /// 来源群组会话ID
    /// </summary>
    public ulong? SourceConversationId { get; set; }

    /// <summary>
    /// 请求消息
    /// </summary>
    public string? RequestMessage { get; set; }

    /// <summary>
    /// 请求来源（account-账号/group-群组/search-搜索/system-系统）
    /// </summary>
    public string RequestSource { get; set; } = null!;

    /// <summary>
    /// 请求状态（pending-待处理/accepted-已接受/rejected-已拒绝/cancelled-已取消/expired-已过期）
    /// </summary>
    public string RequestStatus { get; set; } = null!;

    /// <summary>
    /// 处理者用户ID
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
    /// 过期时间
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

    public virtual User? HandledByUser { get; set; }

    public virtual User ReceiverUser { get; set; } = null!;

    public virtual User RequesterUser { get; set; } = null!;

    public virtual ChatConversation? SourceConversation { get; set; }

    public virtual ICollection<UserFriendship> UserFriendships { get; set; } = new List<UserFriendship>();
}
