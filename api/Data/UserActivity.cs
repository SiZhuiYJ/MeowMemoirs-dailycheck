using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 用户行为埋点日志表
/// </summary>
public partial class UserActivity
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 用户ID（匿名操作可为空）
    /// </summary>
    public ulong? UserId { get; set; }

    /// <summary>
    /// 操作名称/事件标识
    /// </summary>
    public string Action { get; set; } = null!;

    /// <summary>
    /// 页面路径或操作路径
    /// </summary>
    public string Path { get; set; } = null!;

    /// <summary>
    /// 扩展元数据(JSON)，参数等
    /// </summary>
    public string? Metadata { get; set; }

    /// <summary>
    /// IP地址
    /// </summary>
    public string? Ip { get; set; }

    /// <summary>
    /// User-Agent信息
    /// </summary>
    public string? UserAgent { get; set; }

    /// <summary>
    /// 记录时间
    /// </summary>
    public DateTime CreatedAt { get; set; }
}
