using System;

namespace api.Data;

/// <summary>
/// 用户登录设备表
/// </summary>
public partial class UserLoginDevice
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 用户ID
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 客户端持久化设备ID（X-Device-Id 头，或 UA 指纹兜底）
    /// </summary>
    public string DeviceKey { get; set; } = null!;

    /// <summary>
    /// 设备展示名（最近一次登录）
    /// </summary>
    public string Device { get; set; } = null!;

    /// <summary>
    /// 平台（最近一次登录）
    /// </summary>
    public string Platform { get; set; } = null!;

    /// <summary>
    /// 首次登录时间（UTC）
    /// </summary>
    public DateTime FirstLoginAt { get; set; }

    /// <summary>
    /// 最后一次登录时间（UTC）
    /// </summary>
    public DateTime LastLoginAt { get; set; }

    /// <summary>
    /// 最后活跃时间（UTC，打开小程序 / 网页时更新）
    /// </summary>
    public DateTime LastActiveAt { get; set; }

    /// <summary>
    /// 最后一次登录记录ID（user_login_records.id）
    /// </summary>
    public ulong? LastLoginRecordId { get; set; }

    /// <summary>
    /// 创建时间（UTC）
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间（UTC）
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
