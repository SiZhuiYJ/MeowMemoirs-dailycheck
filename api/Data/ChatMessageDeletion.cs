using System;

namespace api.Data;

/// <summary>
/// 聊天消息按用户伪删除标记表。
///
/// 一条消息在同一会话里对「别人」仍然正常可见，只有执行删除的用户看不到它。
/// 这里保存的每一行就是一枚「删除标记」：<c>(message_id, user_id)</c> 唯一，
/// 查询消息时用 NOT EXISTS 过滤即可，不会物理删除 <c>chat_messages</c> 里的数据。
/// </summary>
public partial class ChatMessageDeletion
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 被隐藏的消息ID
    /// </summary>
    public ulong MessageId { get; set; }

    /// <summary>
    /// 执行隐藏的用户ID（仅该用户不可见）
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 删除原因说明
    /// </summary>
    public string? Reason { get; set; }

    /// <summary>
    /// 删除（隐藏）时间
    /// </summary>
    public DateTime DeletedAt { get; set; }

    public virtual ChatMessage Message { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
