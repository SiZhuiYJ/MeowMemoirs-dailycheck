using System;
using System.Collections.Generic;

namespace api.Models;

/// <summary>
/// 登录记录分页响应：一台设备一行，展示该设备最后一次登录记录；计数均为设备数。
/// </summary>
public class LoginRecordListResponse
{
    /// <summary>
    /// 当前生效的记录范围：domestic（国内）/ all（全部）。
    /// </summary>
    public string Scope { get; set; } = "domestic";

    /// <summary>
    /// 当前页码（从 1 开始）。
    /// </summary>
    public int Page { get; set; } = 1;

    /// <summary>
    /// 每页数量（1..50）。
    /// </summary>
    public int PageSize { get; set; } = 20;

    /// <summary>
    /// 当前 scope 下的设备数。
    /// </summary>
    public int Total { get; set; }

    /// <summary>
    /// 最后一次登录为国内的设备数（scope=domestic 时与 total 相同）。
    /// </summary>
    public int DomesticTotal { get; set; }

    /// <summary>
    /// 全部设备数（含最后登录为境外 / 内网的设备）。
    /// </summary>
    public int AllTotal { get; set; }

    /// <summary>
    /// 当前页的登录设备（每台设备一行），按设备最后活跃时间倒序。
    /// </summary>
    public List<LoginRecordItem> Items { get; set; } = new();
}

/// <summary>
/// 单条登录记录（一台设备一行，展示该设备最后一次登录记录）。
/// </summary>
public class LoginRecordItem
{
    /// <summary>
    /// 登录设备 ID（user_login_devices.id），前端用它作为列表 key。
    /// </summary>
    public long DeviceId { get; set; }

    /// <summary>
    /// 设备展示名，如 iPhone 13 · 微信。
    /// </summary>
    public string Device { get; set; } = string.Empty;

    /// <summary>
    /// 客户端平台：mp-weixin/h5/app/unknown。
    /// </summary>
    public string Platform { get; set; } = "unknown";

    /// <summary>
    /// 登录方式：password/email-code/wechat/register/email-change。
    /// </summary>
    public string LoginType { get; set; } = string.Empty;

    /// <summary>
    /// 归一化登录地点：河南 · 郑州 / 境外 / 本地网络 / 未知位置。
    /// </summary>
    public string? Location { get; set; }

    /// <summary>
    /// 脱敏后的 IP：IPv4 只留前两段（222.137.*.*），IPv6 只留前两组（240e:476:*）；无 IP 为 null。
    /// </summary>
    public string? IpMasked { get; set; }

    /// <summary>
    /// 省（简称，仅国内）。
    /// </summary>
    public string? Province { get; set; }

    /// <summary>
    /// 市（简称，仅国内，可能为空）。
    /// </summary>
    public string? City { get; set; }

    /// <summary>
    /// 区县（简称，仅国内，可能为空）。
    /// </summary>
    public string? District { get; set; }

    /// <summary>
    /// 运营商（仅国内，可能为空）。
    /// </summary>
    public string? Isp { get; set; }

    /// <summary>
    /// 是否中国大陆 IP。
    /// </summary>
    public bool IsDomestic { get; set; }

    /// <summary>
    /// 最后活跃时间（UTC，打开小程序 / 网页时更新，登录也算活跃）。
    /// </summary>
    public DateTime LastActiveAt { get; set; }

    /// <summary>
    /// 是否是当前请求所在的设备：优先按请求头 X-Device-Id 匹配设备；
    /// 没有该头时兜底用该设备最后一条登录记录的 session_id 与当前令牌 sid 比对。
    /// </summary>
    public bool IsCurrent { get; set; }

    /// <summary>
    /// 该设备最后一次登录时间（UTC；设备从未登录过时退化为设备创建时间）。
    /// </summary>
    public DateTime LoginAt { get; set; }
}

/// <summary>
/// 「上报设备活跃」响应。
/// </summary>
public class LoginRecordActiveResponse
{
    /// <summary>
    /// 本次上报后的最后活跃时间（UTC，JSON 序列化为 ISO 8601 带 Z）。
    /// </summary>
    public DateTime LastActiveAt { get; set; }
}
