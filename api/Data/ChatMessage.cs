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
    /// 发送时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<ChatGroupActionLog> ChatGroupActionLogs { get; set; } = new List<ChatGroupActionLog>();

    public virtual ICollection<ChatMessageReceipt> ChatMessageReceipts { get; set; } = new List<ChatMessageReceipt>();

    public virtual ChatConversation Conversation { get; set; } = null!;

    public virtual ICollection<ChatMessage> InverseReplyToMessage { get; set; } = new List<ChatMessage>();

    public virtual ChatMessage? ReplyToMessage { get; set; }

    public virtual User SenderUser { get; set; } = null!;
}
