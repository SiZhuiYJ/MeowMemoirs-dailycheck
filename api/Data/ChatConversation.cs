using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 聊天会话主表（支持群管理扩展）
/// </summary>
public partial class ChatConversation
{
    /// <summary>
    /// 会话ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 会话类型：direct=双人，group=多人/群聊
    /// </summary>
    public string ConversationType { get; set; } = null!;

    /// <summary>
    /// 会话标题（群聊可配置）
    /// </summary>
    public string? Title { get; set; }

    /// <summary>
    /// 群主/创建者用户ID
    /// </summary>
    public ulong? OwnerUserId { get; set; }

    /// <summary>
    /// 会话头像存储标识
    /// </summary>
    public string? AvatarKey { get; set; }

    /// <summary>
    /// 会话状态：1=可用，0=已停用
    /// </summary>
    public bool? IsActive { get; set; }

    /// <summary>
    /// 会话生命周期状态：active=正常活跃,disbanded=已解散,archived=已归档
    /// </summary>
    public string ConversationStatus { get; set; } = null!;

    /// <summary>
    /// 群成员人数上限
    /// </summary>
    public uint MemberLimit { get; set; }

    /// <summary>
    /// 最后一条消息发送时间
    /// </summary>
    public DateTime? LastMessageAt { get; set; }

    /// <summary>
    /// 群解散时间
    /// </summary>
    public DateTime? DisbandedAt { get; set; }

    /// <summary>
    /// 解散操作人用户ID
    /// </summary>
    public ulong? DisbandedByUserId { get; set; }

    /// <summary>
    /// 群解散原因说明
    /// </summary>
    public string? DisbandReason { get; set; }

    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<ChatConversationMember> ChatConversationMembers { get; set; } = new List<ChatConversationMember>();

    public virtual ICollection<ChatFileRecord> ChatFileRecords { get; set; } = new List<ChatFileRecord>();

    public virtual ICollection<ChatGroupActionLog> ChatGroupActionLogs { get; set; } = new List<ChatGroupActionLog>();

    public virtual ICollection<ChatGroupJoinRequest> ChatGroupJoinRequests { get; set; } = new List<ChatGroupJoinRequest>();

    public virtual ICollection<ChatMessage> ChatMessages { get; set; } = new List<ChatMessage>();

    public virtual User? DisbandedByUser { get; set; }

    public virtual User? OwnerUser { get; set; }

    public virtual ICollection<UserFriendRequest> UserFriendRequests { get; set; } = new List<UserFriendRequest>();

    public virtual ICollection<UserFriendship> UserFriendships { get; set; } = new List<UserFriendship>();
}
