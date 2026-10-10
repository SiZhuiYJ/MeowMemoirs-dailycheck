using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 好友关系表（按用户方向存储）
/// </summary>
public partial class UserFriendship
{
    /// <summary>
    /// 主键
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 用户ID
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 好友用户ID
    /// </summary>
    public ulong FriendUserId { get; set; }

    /// <summary>
    /// 来源好友请求ID
    /// </summary>
    public ulong? SourceRequestId { get; set; }

    /// <summary>
    /// 来源群组会话ID
    /// </summary>
    public ulong? SourceConversationId { get; set; }

    /// <summary>
    /// 好友关系状态（active-活跃/deleted-已删除）
    /// </summary>
    public string Status { get; set; } = null!;

    /// <summary>
    /// 好友备注
    /// </summary>
    public string? FriendRemark { get; set; }

    /// <summary>
    /// 是否置顶（0-否/1-是）
    /// </summary>
    public bool IsStarred { get; set; }

    /// <summary>
    /// 是否静音（0-否/1-是）
    /// </summary>
    public bool IsMuted { get; set; }

    /// <summary>
    /// 接受时间
    /// </summary>
    public DateTime? AcceptedAt { get; set; }

    /// <summary>
    /// 创建关系的操作者用户ID
    /// </summary>
    public ulong? CreatedByUserId { get; set; }

    /// <summary>
    /// 删除时间
    /// </summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>
    /// 删除关系的操作者用户ID
    /// </summary>
    public ulong? DeletedByUserId { get; set; }

    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual User? CreatedByUser { get; set; }

    public virtual User? DeletedByUser { get; set; }

    public virtual User FriendUser { get; set; } = null!;

    public virtual ChatConversation? SourceConversation { get; set; }

    public virtual UserFriendRequest? SourceRequest { get; set; }

    public virtual User User { get; set; } = null!;
}
