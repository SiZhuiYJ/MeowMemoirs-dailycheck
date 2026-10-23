using System;
using System.Collections.Generic;

namespace api.Models;

/// <summary>
/// 创建会话请求参数
/// </summary>
public class CreateConversationRequest
{
    /// <summary>
    /// 会话类型，默认为"direct"
    /// </summary>
    public string ConversationType { get; set; } = "direct";
    /// <summary>
    /// 会话标题，可为空
    /// </summary>
    public string? Title { get; set; }
    /// <summary>
    /// 头像键，可为空
    /// </summary>
    public string? AvatarKey { get; set; }
    /// <summary>
    /// 成员用户ID列表
    /// </summary>
    public List<ulong> MemberUserIds { get; set; } = new();
}

/// <summary>
/// 更新会话信息请求参数
/// </summary>
public class UpdateConversationRequest
{
    /// <summary>
    /// 会话标题，可为空
    /// </summary>
    public string? Title { get; set; }
    /// <summary>
    /// 头像键，可为空
    /// </summary>
    public string? AvatarKey { get; set; }
    /// <summary>
    /// 是否激活，可为空
    /// </summary>
    public bool? IsActive { get; set; }
    /// <summary>
    /// 是否置顶，可为空
    /// </summary>
    public bool? IsPinned { get; set; }
    /// <summary>
    /// 是否静音，可为空
    /// </summary>
    public bool? IsMuted { get; set; }
}

/// <summary>
/// 更新群成员角色请求参数
/// </summary>
public class UpdateConversationMemberRoleRequest
{
    /// <summary>
    /// 目标成员角色，仅支持 admin 或 member
    /// </summary>
    public string MemberRole { get; set; } = "member";
}

/// <summary>
/// 会话成员信息数据传输对象
/// </summary>
public class ConversationMemberDto
{
    /// <summary>
    /// 用户ID
    /// </summary>
    public ulong UserId { get; set; }
    /// <summary>
    /// User account, nullable
    /// </summary>
    public string? UserAccount { get; set; }
    /// <summary>
    /// 昵称，可为空
    /// </summary>
    public string? NickName { get; set; }
    /// <summary>
    /// 头像键，可为空
    /// </summary>
    public string? AvatarKey { get; set; }
    /// <summary>
    /// 成员角色，默认为"member"
    /// </summary>
    public string MemberRole { get; set; } = "member";
    /// <summary>
    /// 加入时间
    /// </summary>
    public DateTime JoinedAt { get; set; }
    /// <summary>
    /// 最后阅读消息ID，可为空
    /// </summary>
    public ulong? LastReadMessageId { get; set; }
    /// <summary>
    /// Whether the member is currently muted in the group
    /// </summary>
    public bool IsMuted { get; set; }
    /// <summary>
    /// Group mute expiration time, nullable
    /// </summary>
    public DateTime? MutedUntil { get; set; }
    /// <summary>
    /// Group mute mode, nullable
    /// </summary>
    public string? MutedMode { get; set; }
}

/// <summary>
/// 消息摘要数据传输对象
/// </summary>
public class MessageReferenceDto
{
    /// <summary>
    /// 消息ID
    /// </summary>
    public ulong Id { get; set; }
    /// <summary>
    /// 发送者用户ID
    /// </summary>
    public ulong SenderUserId { get; set; }
    /// <summary>
    /// 发送者昵称，可为空
    /// </summary>
    public string? SenderNickName { get; set; }
    /// <summary>
    /// 消息类型
    /// </summary>
    public string MessageType { get; set; } = "text";
    /// <summary>
    /// 消息内容，可为空
    /// </summary>
    public string? Content { get; set; }
    /// <summary>
    /// 额外信息，可为空
    /// </summary>
    public string? Extra { get; set; }
    /// <summary>
    /// 是否撤回
    /// </summary>
    public bool IsRecalled { get; set; }
    /// <summary>
    /// 执行撤回的用户ID，可为空
    /// </summary>
    public ulong? RecalledByUserId { get; set; }
    /// <summary>
    /// 管理撤回提示（仅群主/管理员撤回他人消息时有值），可为空
    /// </summary>
    public string? RecallPrompt { get; set; }
    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// 娑堟伅鎽樿鏁版嵁浼犺緭瀵硅薄
/// </summary>
public class MessageSummaryDto
{
    /// <summary>
    /// 消息ID
    /// </summary>
    public ulong Id { get; set; }
    /// <summary>
    /// 发送者用户ID
    /// </summary>
    public ulong SenderUserId { get; set; }
    /// <summary>
    /// 发送者昵称，可为空
    /// </summary>
    public string? SenderNickName { get; set; }
    /// <summary>
    /// 消息类型，默认为"text"
    /// </summary>
    public string MessageType { get; set; } = "text";
    /// <summary>
    /// 消息内容，可为空
    /// </summary>
    public string? Content { get; set; }
    /// <summary>
    /// 额外信息，可为空
    /// </summary>
    public string? Extra { get; set; }
    /// <summary>
    /// 回复的消息ID，可为空
    /// </summary>
    public ulong? ReplyToMessageId { get; set; }
    /// <summary>
    /// 被引用消息摘要，可为空
    /// </summary>
    public MessageReferenceDto? ReplyToMessage { get; set; }
    /// <summary>
    /// 是否撤回
    /// </summary>
    public bool IsRecalled { get; set; }
    /// <summary>
    /// 执行撤回的用户ID，可为空
    /// </summary>
    public ulong? RecalledByUserId { get; set; }
    /// <summary>
    /// 管理撤回提示（仅群主/管理员撤回他人消息时有值），可为空
    /// </summary>
    public string? RecallPrompt { get; set; }
    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// 会话摘要数据传输对象
/// </summary>
public class ConversationSummaryDto
{
    /// <summary>
    /// 会话ID
    /// </summary>
    public ulong Id { get; set; }
    /// <summary>
    /// 会话类型，默认为"direct"
    /// </summary>
    public string ConversationType { get; set; } = "direct";
    /// <summary>
    /// 会话标题，可为空
    /// </summary>
    public string? Title { get; set; }
    /// <summary>
    /// Peer user account for direct conversation, nullable
    /// </summary>
    public string? UserAccount { get; set; }
    /// <summary>
    /// 头像键，可为空
    /// </summary>
    public string? AvatarKey { get; set; }
    /// <summary>
    /// 头像用户ID，可为空
    /// </summary>
    public ulong? AvatarUserId { get; set; }
    /// <summary>
    /// 是否激活
    /// </summary>
    public bool IsActive { get; set; }
    /// <summary>
    /// 是否置顶
    /// </summary>
    public bool IsPinned { get; set; }
    /// <summary>
    /// 是否静音
    /// </summary>
    public bool IsMuted { get; set; }
    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }
    /// <summary>
    /// 待处理加群申请数量
    /// </summary>
    /// <summary>
    /// 未读数量
    /// </summary>
    public int UnreadCount { get; set; }
    /// <summary>
    /// 最后一条消息，可为空
    /// </summary>
    public MessageSummaryDto? LastMessage { get; set; }
}

/// <summary>
/// 会话详情数据传输对象
/// </summary>
public class ConversationDetailDto
{
    /// <summary>
    /// 会话ID
    /// </summary>
    public ulong Id { get; set; }
    /// <summary>
    /// 会话类型，默认为"direct"
    /// </summary>
    public string ConversationType { get; set; } = "direct";
    /// <summary>
    /// 会话标题，可为空
    /// </summary>
    public string? Title { get; set; }
    /// <summary>
    /// 头像键，可为空
    /// </summary>
    public string? AvatarKey { get; set; }
    /// <summary>
    /// 头像用户ID，可为空
    /// </summary>
    public ulong? AvatarUserId { get; set; }
    /// <summary>
    /// 是否激活
    /// </summary>
    public bool IsActive { get; set; }
    /// <summary>
    /// 是否置顶
    /// </summary>
    public bool IsPinned { get; set; }
    /// <summary>
    /// 是否静音
    /// </summary>
    public bool IsMuted { get; set; }
    /// <summary>
    /// 拥有者用户ID，可为空
    /// </summary>
    public ulong? OwnerUserId { get; set; }
    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }
    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }
    /// <summary>
    /// 待处理加群申请数量
    /// </summary>
    public int PendingJoinRequestCount { get; set; }
    /// <summary>
    /// 好友备注，仅单聊会话可能返回
    /// </summary>
    public string? FriendRemark { get; set; }
    /// <summary>
    /// 当前单聊对方是否仍是好友
    /// </summary>
    public bool IsFriend { get; set; }
    /// <summary>
    /// 成员列表
    /// </summary>
    public List<ConversationMemberDto> Members { get; set; } = new();
}

/// <summary>
/// 发送消息请求参数
/// </summary>
public class SendMessageRequest
{
    /// <summary>
    /// 消息类型，默认为"text"
    /// </summary>
    public string MessageType { get; set; } = "text";
    /// <summary>
    /// 消息内容，可为空
    /// </summary>
    public string? Content { get; set; }
    /// <summary>
    /// 额外信息，可为空
    /// </summary>
    public FileExtra? Extra { get; set; }
    /// <summary>
    /// 回复的消息ID，可为空
    /// </summary>
    public ulong? ReplyToMessageId { get; set; }
}

public class FileExtra
{
    // 必需属性
    public string FileName { get; set; } = string.Empty;
    public long FileSize { get; set; }          // 文件大小（字节）
    public string FileUrl { get; set; } = string.Empty;

    // 可选属性
    public string? FileKey { get; set; }        // 文件标识
    public string? ThumbnailUrl { get; set; }   // 缩略图URL
    public double? Duration { get; set; }       // 时长（秒），适用于音视频
    public string? MimeType { get; set; }       // MIME类型
    public int? Width { get; set; }             // 图片宽度
    public int? Height { get; set; }            // 图片高度
}


/// <summary>
/// 消息增量数据传输对象
/// </summary>
public class MessageDeltaDto
{
    /// <summary>
    /// 最后消息ID
    /// </summary>
    public ulong LastMessageId { get; set; }
    /// <summary>
    /// 是否还有更多消息
    /// </summary>
    public bool HasMore { get; set; }
    /// <summary>
    /// 消息列表
    /// </summary>
    public List<MessageSummaryDto> Messages { get; set; } = new();
}

/// <summary>
/// 标记会话已读请求参数
/// </summary>
public class ReadConversationRequest
{
    /// <summary>
    /// 最后已读消息ID，可为空
    /// </summary>
    public ulong? LastReadMessageId { get; set; }
}

/// <summary>
/// 消息已读详情数据传输对象
/// </summary>
public class MessageReadDetailDto
{
    /// <summary>
    /// 消息ID
    /// </summary>
    public ulong MessageId { get; set; }
    /// <summary>
    /// 总接收者数量（排除发送者）
    /// </summary>
    public int TotalRecipients { get; set; }
    /// <summary>
    /// 已读用户数量
    /// </summary>
    public int ReadCount { get; set; }
    /// <summary>
    /// 已读用户列表
    /// </summary>
    public List<ReadUserDto> ReadUsers { get; set; } = new();
}

/// <summary>
/// 已读用户信息数据传输对象
/// </summary>
public class ReadUserDto
{
    /// <summary>
    /// 用户ID
    /// </summary>
    public ulong UserId { get; set; }
    /// <summary>
    /// 昵称
    /// </summary>
    public string NickName { get; set; } = null!;
    /// <summary>
    /// 头像键，可为空
    /// </summary>
    public string? AvatarKey { get; set; }
    /// <summary>
    /// 已读时间
    /// </summary>
    public DateTime ReadAt { get; set; }
}

/// <summary>
/// 消息伪删除（仅自己不可见）结果
/// </summary>
public class DeleteMessageResultDto
{
    /// <summary>
    /// 被隐藏的消息ID
    /// </summary>
    public ulong MessageId { get; set; }
    /// <summary>
    /// 消息所属会话ID
    /// </summary>
    public ulong ConversationId { get; set; }
    /// <summary>
    /// 是否已对该用户隐藏
    /// </summary>
    public bool Hidden { get; set; }
}

/// <summary>
/// 删除会话聊天记录（仅自己）结果
/// </summary>
public class DeleteConversationHistoryResultDto
{
    /// <summary>
    /// 会话ID
    /// </summary>
    public ulong ConversationId { get; set; }
    /// <summary>
    /// 聊天记录清除到此消息ID（含），仅对该用户生效
    /// </summary>
    public ulong ClearedBeforeMessageId { get; set; }
    /// <summary>
    /// 会话是否已从该用户的收件箱隐藏
    /// </summary>
    public bool Hidden { get; set; }
}

/// <summary>
/// 用户主页信息数据传输对象
/// </summary>
public class UserProfileDto
{
    /// <summary>
    /// 用户ID
    /// </summary>
    public ulong UserId { get; set; }
    /// <summary>
    /// 用户账号
    /// </summary>
    public string? UserAccount { get; set; }
    /// <summary>
    /// 昵称
    /// </summary>
    public string? NickName { get; set; }
    /// <summary>
    /// 头像键
    /// </summary>
    public string? AvatarKey { get; set; }
    /// <summary>
    /// 注册时间
    /// </summary>
    public DateTime CreatedAt { get; set; }
    /// <summary>
    /// 是否查看自己的主页
    /// </summary>
    public bool IsSelf { get; set; }
    /// <summary>
    /// 是否是好友
    /// </summary>
    public bool IsFriend { get; set; }
    /// <summary>
    /// 当前用户是否已把该用户拉黑
    /// </summary>
    public bool IsBlocked { get; set; }
    /// <summary>
    /// 该用户是否已把当前用户拉黑（被拉黑方仍可查看主页，但不能再互动）
    /// </summary>
    public bool IsBlockedByTarget { get; set; }
    /// <summary>
    /// 好友备注
    /// </summary>
    public string? FriendRemark { get; set; }
    /// <summary>
    /// 与当前用户的单聊会话ID（若存在）
    /// </summary>
    public ulong? DirectConversationId { get; set; }
    /// <summary>
    /// 当前用户是否已向该用户发送待处理的好友申请
    /// </summary>
    public bool HasPendingSentRequest { get; set; }
    /// <summary>
    /// 该用户是否已向当前用户发送待处理的好友申请
    /// </summary>
    public bool HasPendingReceivedRequest { get; set; }
    /// <summary>
    /// 账号状态：active=正常，frozen=冻结
    /// </summary>
    public string Status { get; set; } = "active";
}

