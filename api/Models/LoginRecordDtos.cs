using System;
using System.Collections.Generic;

namespace api.Models;

/// <summary>
/// 登录记录分页响应。
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
    /// 当前 scope 下的记录总数。
    /// </summary>
    public int Total { get; set; }

    /// <summary>
    /// 国内登录记录总数（scope=domestic 时与 total 相同）。
    /// </summary>
    public int DomesticTotal { get; set; }

    /// <summary>
    /// 全部登录记录总数（含境外 / 内网）。
    /// </summary>
    public int AllTotal { get; set; }

    /// <summary>
    /// 当前页的登录记录，按登录时间倒序。
    /// </summary>
    public List<LoginRecordItem> Items { get; set; } = new();
}

/// <summary>
/// 单条登录记录。
/// </summary>
public class LoginRecordItem
{
    /// <summary>
    /// 记录 ID。
    /// </summary>
    public long Id { get; set; }

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
    /// 记录状态：current（当前登录）/ active（在线）/ logged_out（已退出）。
    /// </summary>
    public string Status { get; set; } = "active";

    /// <summary>
    /// 登录时间（UTC，JSON 序列化为 ISO 8601 带 Z）。
    /// </summary>
    public DateTime LoginAt { get; set; }

    /// <summary>
    /// 退出 / 被撤销时间（UTC，未退出为 null）。
    /// </summary>
    public DateTime? LogoutAt { get; set; }
}
