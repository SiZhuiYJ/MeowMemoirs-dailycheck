using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 用户表（支持伪删除与黑名单冻结）
/// </summary>
public partial class User
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 用户邮箱（唯一）
    /// </summary>
    public string? Email { get; set; }

    /// <summary>
    /// 密码哈希（如bcrypt）
    /// </summary>
    public string PasswordHash { get; set; } = null!;

    /// <summary>
    /// 用户昵称
    /// </summary>
    public string? NickName { get; set; }

    /// <summary>
    /// 头像图片URL
    /// </summary>
    public string? AvatarKey { get; set; }

    /// <summary>
    /// 是否伪删除：0正常，1已删除
    /// </summary>
    public bool IsDeleted { get; set; }

    /// <summary>
    /// 伪删除时间
    /// </summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>
    /// 账户状态：1正常，0冻结
    /// </summary>
    public bool? Status { get; set; }

    /// <summary>
    /// 用户角色：user普通用户，admin管理员
    /// </summary>
    public string Role { get; set; } = null!;

    /// <summary>
    /// 账户冻结时间
    /// </summary>
    public DateTime? FrozenAt { get; set; }

    /// <summary>
    /// 账户冻结原因
    /// </summary>
    public string? FrozenReason { get; set; }

    /// <summary>
    /// 执行冻结操作的管理员用户ID
    /// </summary>
    public ulong? FreezeOperatorId { get; set; }

    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// 用户账号（唯一）
    /// </summary>
    public string UserAccount { get; set; } = null!;

    /// <summary>
    /// username更新时间
    /// </summary>
    public DateTime? AccountUpdatedAt { get; set; }

    public virtual ICollection<ChatConversation> ChatConversationDisbandedByUsers { get; set; } = new List<ChatConversation>();

    public virtual ICollection<ChatConversationMember> ChatConversationMemberInvitedByUsers { get; set; } = new List<ChatConversationMember>();

    public virtual ICollection<ChatConversationMember> ChatConversationMemberMutedByUsers { get; set; } = new List<ChatConversationMember>();

    public virtual ICollection<ChatConversationMember> ChatConversationMemberRemovedByUsers { get; set; } = new List<ChatConversationMember>();

    public virtual ICollection<ChatConversationMember> ChatConversationMemberUsers { get; set; } = new List<ChatConversationMember>();

    public virtual ICollection<ChatConversation> ChatConversationOwnerUsers { get; set; } = new List<ChatConversation>();

    public virtual ICollection<ChatFileRecord> ChatFileRecords { get; set; } = new List<ChatFileRecord>();

    public virtual ICollection<ChatGroupActionLog> ChatGroupActionLogOperatorUsers { get; set; } = new List<ChatGroupActionLog>();

    public virtual ICollection<ChatGroupActionLog> ChatGroupActionLogTargetUsers { get; set; } = new List<ChatGroupActionLog>();

    public virtual ICollection<ChatGroupJoinRequest> ChatGroupJoinRequestHandledByUsers { get; set; } = new List<ChatGroupJoinRequest>();

    public virtual ICollection<ChatGroupJoinRequest> ChatGroupJoinRequestRequesterUsers { get; set; } = new List<ChatGroupJoinRequest>();

    public virtual ICollection<ChatMessageReceipt> ChatMessageReceipts { get; set; } = new List<ChatMessageReceipt>();

    public virtual ICollection<ChatMessage> ChatMessages { get; set; } = new List<ChatMessage>();

    public virtual ICollection<CheckinPlan> CheckinPlans { get; set; } = new List<CheckinPlan>();

    public virtual ICollection<Checkin> Checkins { get; set; } = new List<Checkin>();

    public virtual User? FreezeOperator { get; set; }

    public virtual ICollection<User> InverseFreezeOperator { get; set; } = new List<User>();

    public virtual ICollection<SoftDeleteLog> SoftDeleteLogs { get; set; } = new List<SoftDeleteLog>();

    public virtual ICollection<UserBlacklistRecord> UserBlacklistRecordOperatorUsers { get; set; } = new List<UserBlacklistRecord>();

    public virtual ICollection<UserBlacklistRecord> UserBlacklistRecordUsers { get; set; } = new List<UserBlacklistRecord>();

    public virtual ICollection<UserFriendRequest> UserFriendRequestHandledByUsers { get; set; } = new List<UserFriendRequest>();

    public virtual ICollection<UserFriendRequest> UserFriendRequestReceiverUsers { get; set; } = new List<UserFriendRequest>();

    public virtual ICollection<UserFriendRequest> UserFriendRequestRequesterUsers { get; set; } = new List<UserFriendRequest>();

    public virtual ICollection<UserFriendship> UserFriendshipCreatedByUsers { get; set; } = new List<UserFriendship>();

    public virtual ICollection<UserFriendship> UserFriendshipDeletedByUsers { get; set; } = new List<UserFriendship>();

    public virtual ICollection<UserFriendship> UserFriendshipFriendUsers { get; set; } = new List<UserFriendship>();

    public virtual ICollection<UserFriendship> UserFriendshipUsers { get; set; } = new List<UserFriendship>();

    public virtual ICollection<UserOauthAccount> UserOauthAccounts { get; set; } = new List<UserOauthAccount>();
}
