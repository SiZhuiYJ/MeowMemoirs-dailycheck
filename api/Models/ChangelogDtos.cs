using System.Collections.Generic;

namespace api.Models;

/// <summary>
/// 更新日志列表响应（GET /mm/Changelog）。
///
/// <para>
/// 数据源是仓库内的 Markdown 文件 <c>Resources/changelog/CHANGELOG.md</c>，
/// 由服务端解析成结构化 JSON，小程序 / Web 都不需要引入 Markdown 渲染器。
/// </para>
/// </summary>
public class ChangelogListResponse
{
    /// <summary>
    /// 最新版本号（排序后的第一条；没有任何更新日志时为 null）。
    /// </summary>
    public string? LatestVersion { get; set; }

    /// <summary>
    /// 最新版本的发布日期（<c>YYYY-MM-DD</c>；没有日期或没有更新日志时为 null）。
    /// </summary>
    public string? LatestDate { get; set; }

    /// <summary>
    /// 解析出的**全部**版本数量（不受 <c>limit</c> 影响，前端可用来显示「共 N 个版本」）。
    /// </summary>
    public int Total { get; set; }

    /// <summary>
    /// 当前返回的版本条目，按发布日期倒序（日期相同按版本号倒序）。
    /// </summary>
    public List<ChangelogEntry> Items { get; set; } = new();
}

/// <summary>
/// 一个版本的更新日志（对应 Markdown 里的一个 <c>## [版本号] - 日期</c> 区块）。
/// </summary>
public class ChangelogEntry
{
    /// <summary>
    /// 版本号，如 <c>1.2.0</c>。
    /// </summary>
    public string Version { get; set; } = string.Empty;

    /// <summary>
    /// 发布日期（<c>YYYY-MM-DD</c>，Markdown 标题里没写日期时为 null）。
    /// </summary>
    public string? Date { get; set; }

    /// <summary>
    /// 该版本下的分组（如「新增 / 优化 / 修复」），可能为空数组。
    /// </summary>
    public List<ChangelogSection> Sections { get; set; } = new();
}

/// <summary>
/// 更新日志的一个分组（对应 Markdown 里的一个 <c>### 标题</c>）。
/// </summary>
public class ChangelogSection
{
    /// <summary>
    /// 分组标题，如「新增」「优化」「修复」。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 分组下的条目，均为纯文本（服务端不解析 Markdown 行内标记）。
    /// </summary>
    public List<string> Items { get; set; } = new();
}
