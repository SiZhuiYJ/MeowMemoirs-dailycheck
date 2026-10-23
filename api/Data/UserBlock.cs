using System;

namespace api.Data;

/// <summary>
/// 用户拉黑关系表（按拉黑方方向存储）。
///
/// 语义：<see cref="UserId"/> 拉黑了 <see cref="BlockedUserId"/>。
/// 只影响被拉黑方对拉黑方的社交行为（加好友、单聊、搜索），
/// 主页仍可查看；好友关系与群聊成员关系都不做删除。
/// </summary>
public partial class UserBlock
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 拉黑方用户ID
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 被拉黑用户ID
    /// </summary>
    public ulong BlockedUserId { get; set; }

    /// <summary>
    /// 拉黑时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual User User { get; set; } = null!;

    public virtual User BlockedUser { get; set; } = null!;
}
