using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 聊天文件元数据记录表，用于权限验证与文件追溯
/// </summary>
public partial class ChatFileRecord
{
    /// <summary>
    /// 自增主键
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 文件唯一标识（SHA256哈希或组合键）
    /// </summary>
    public string FileKey { get; set; } = null!;

    /// <summary>
    /// 所属会话ID
    /// </summary>
    public ulong ConversationId { get; set; }

    /// <summary>
    /// 上传者用户ID
    /// </summary>
    public ulong UploaderUserId { get; set; }

    /// <summary>
    /// 原始文件名（不含路径）
    /// </summary>
    public string? OriginalFilename { get; set; }

    /// <summary>
    /// 文件实际存储大小（字节）
    /// </summary>
    public ulong FileSize { get; set; }

    /// <summary>
    /// MIME类型
    /// </summary>
    public string ContentType { get; set; } = null!;

    /// <summary>
    /// 软删除标记：0-未删除，1-已删除
    /// </summary>
    public bool IsDeleted { get; set; }

    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual ChatConversation Conversation { get; set; } = null!;

    public virtual User UploaderUser { get; set; } = null!;
}
