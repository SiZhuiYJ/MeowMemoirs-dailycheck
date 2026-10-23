using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 会话成员关系表（支持邀请、踢出、禁言）
/// </summary>
public partial class ChatConversationMember
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 会话ID
    /// </summary>
    public ulong ConversationId { get; set; }

    /// <summary>
    /// 用户ID
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 成员角色
    /// </summary>
    public string MemberRole { get; set; } = null!;

    /// <summary>
    /// 成员状态（active：活跃，left：已离开，kicked：被踢出）
    /// </summary>
    public string MembershipStatus { get; set; } = null!;

    /// <summary>
    /// 加入时间
    /// </summary>
    public DateTime JoinedAt { get; set; }

    /// <summary>
    /// 邀请时间
    /// </summary>
    public DateTime? InvitedAt { get; set; }

    /// <summary>
    /// 邀请人用户ID
    /// </summary>
    public ulong? InvitedByUserId { get; set; }

    /// <summary>
    /// 离开时间（NULL表示仍在会话中）
    /// </summary>
    public DateTime? LeftAt { get; set; }

    /// <summary>
    /// 移除操作人用户ID
    /// </summary>
    public ulong? RemovedByUserId { get; set; }

    /// <summary>
    /// 离开或移除原因
    /// </summary>
    public string? RemovedReason { get; set; }

    /// <summary>
    /// 禁言截至时间（NULL表示不禁言）
    /// </summary>
    public DateTime? MuteUntil { get; set; }

    /// <summary>
    /// 禁言模式（temporary：临时，permanent：永久）
    /// </summary>
    public string? MuteMode { get; set; }

    /// <summary>
    /// 禁言原因
    /// </summary>
    public string? MuteReason { get; set; }

    /// <summary>
    /// 禁言开始时间
    /// </summary>
    public DateTime? MutedAt { get; set; }

    /// <summary>
    /// 禁言操作人用户ID
    /// </summary>
    public ulong? MutedByUserId { get; set; }

    /// <summary>
    /// 是否置顶会话：1是，0否
    /// </summary>
    public bool IsPinned { get; set; }

    /// <summary>
    /// 是否消息免打扰：1是，0否
    /// </summary>
    public bool IsMuted { get; set; }

    /// <summary>
    /// 是否对该用户隐藏会话（伪删除标记）。
    ///
    /// 用户在会话列表里执行「删除」时置为 true：会话从该用户的收件箱消失，
    /// 但会话本身和对方的记录都保留。收到新消息时会重新置为 false，
    /// 让会话重新出现在列表里。
    /// </summary>
    public bool IsHidden { get; set; }

    /// <summary>
    /// 聊天记录清除到此消息ID（含该消息），仅对该用户生效。
    ///
    /// 删除会话时写入当时的最新消息ID；之后拉取消息、
    /// 计算未读与会话预览时都只认大于这个游标的记录。
    /// 与 IsHidden 分开保存，所以「收到新消息重新出现」时旧记录仍然不可见。
    /// </summary>
    public ulong? HistoryClearedBeforeMessageId { get; set; }

    /// <summary>
    /// 聊天记录清除时间（仅该用户）
    /// </summary>
    public DateTime? HistoryClearedAt { get; set; }

    /// <summary>
    /// 最后已读消息ID（逻辑引用）
    /// </summary>
    public ulong? LastReadMessageId { get; set; }

    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual ChatConversation Conversation { get; set; } = null!;

    public virtual User? InvitedByUser { get; set; }

    public virtual User? MutedByUser { get; set; }

    public virtual User? RemovedByUser { get; set; }

    public virtual User User { get; set; } = null!;
}
