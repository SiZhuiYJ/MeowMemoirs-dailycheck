using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 聊天消息表
/// </summary>
public partial class ChatMessage
{
    /// <summary>
    /// 消息ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 会话ID
    /// </summary>
    public ulong ConversationId { get; set; }

    /// <summary>
    /// 发送者用户ID
    /// </summary>
    public ulong SenderUserId { get; set; }

    /// <summary>
    /// 消息类型
    /// </summary>
    public string MessageType { get; set; } = null!;

    /// <summary>
    /// 消息文本内容
    /// </summary>
    public string? Content { get; set; }

    /// <summary>
    /// 扩展字段(JSON)，如图片/文件信息、@信息等
    /// </summary>
    public string? Extra { get; set; }

    /// <summary>
    /// 引用回复的消息ID
    /// </summary>
    public ulong? ReplyToMessageId { get; set; }

    /// <summary>
    /// 是否撤回：1是，0否
    /// </summary>
    public bool IsRecalled { get; set; }

    /// <summary>
    /// 撤回时间
    /// </summary>
    public DateTime? RecalledAt { get; set; }

    /// <summary>
    /// 执行撤回的用户ID。
    /// 自己撤回时为发送者本人；群主/管理员撤回他人消息时为操作人。
    /// </summary>
    public ulong? RecalledByUserId { get; set; }

    /// <summary>
    /// 管理撤回提示（仅群主/管理员撤回他人消息时有值），
    /// 在该消息原来的位置直接展示，而不是在底部追加一条系统消息。
    /// </summary>
    public string? RecallPrompt { get; set; }

    /// <summary>
    /// 发送时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<ChatGroupActionLog> ChatGroupActionLogs { get; set; } = new List<ChatGroupActionLog>();

    /// <summary>
    /// 按用户伪删除的标记（仅删除者本人看不到这条消息）。
    /// </summary>
    public virtual ICollection<ChatMessageDeletion> ChatMessageDeletions { get; set; } = new List<ChatMessageDeletion>();

    public virtual ICollection<ChatMessageReceipt> ChatMessageReceipts { get; set; } = new List<ChatMessageReceipt>();

    public virtual ChatConversation Conversation { get; set; } = null!;

    public virtual ICollection<ChatMessage> InverseReplyToMessage { get; set; } = new List<ChatMessage>();

    public virtual ChatMessage? ReplyToMessage { get; set; }

    public virtual User SenderUser { get; set; } = null!;
}
