using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 用户第三方登录账号绑定表
/// </summary>
public partial class UserOauthAccount
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 关联用户ID
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 第三方登录平台类型
    /// </summary>
    public string Provider { get; set; } = null!;

    /// <summary>
    /// 第三方平台open_id
    /// </summary>
    public string OpenId { get; set; } = null!;

    /// <summary>
    /// 第三方平台union_id（可选）
    /// </summary>
    public string? UnionId { get; set; }

    /// <summary>
    /// 绑定时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual User User { get; set; } = null!;
}
