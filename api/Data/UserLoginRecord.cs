using System;

namespace api.Data;

/// <summary>
/// 用户登录记录表（含IP归属地）
/// </summary>
public partial class UserLoginRecord
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
    /// 目标登录设备ID（user_login_devices.id）
    /// </summary>
    public ulong DeviceId { get; set; }

    /// <summary>
    /// 设备会话标识（JWT sid，刷新沿用）
    /// </summary>
    public string SessionId { get; set; } = null!;

    /// <summary>
    /// 登录方式：password/email-code/wechat/register/email-change
    /// </summary>
    public string LoginType { get; set; } = null!;

    /// <summary>
    /// 客户端平台：mp-weixin/h5/app/unknown
    /// </summary>
    public string Platform { get; set; } = null!;

    /// <summary>
    /// 设备展示名，如 iPhone 13 · 微信
    /// </summary>
    public string Device { get; set; } = null!;

    /// <summary>
    /// User-Agent（截断后）
    /// </summary>
    public string? UserAgent { get; set; }

    /// <summary>
    /// 登录IP（v4/v6）
    /// </summary>
    public string? Ip { get; set; }

    /// <summary>
    /// 归一化登录地点：河南 · 郑州 / 境外 / 本地网络 / 未知位置
    /// </summary>
    public string? Location { get; set; }

    /// <summary>
    /// 省（仅国内）
    /// </summary>
    public string? Province { get; set; }

    /// <summary>
    /// 市（仅国内，可能为空）
    /// </summary>
    public string? City { get; set; }

    /// <summary>
    /// 区县（仅国内，可能为空）
    /// </summary>
    public string? District { get; set; }

    /// <summary>
    /// 运营商（仅国内，可能为空）
    /// </summary>
    public string? Isp { get; set; }

    /// <summary>
    /// 是否中国大陆IP：1是，0否
    /// </summary>
    public bool IsDomestic { get; set; }

    /// <summary>
    /// 登录时间（UTC）
    /// </summary>
    public DateTime LoginAt { get; set; }

    /// <summary>
    /// 退出/被撤销时间（UTC，NULL=未退出）
    /// </summary>
    public DateTime? LogoutAt { get; set; }
}
