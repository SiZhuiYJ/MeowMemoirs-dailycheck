using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using api.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace api.Infrastructure;

/// <summary>
/// 更新日志读取服务：把随源码发布的 Markdown 文件解析成结构化版本条目。
/// </summary>
public interface IChangelogService
{
    /// <summary>
    /// 获取全部版本条目（按发布日期倒序，日期相同按版本号倒序）。
    /// 文件缺失 / 读取失败时返回空列表，永不抛异常。
    /// </summary>
    /// <returns>版本条目只读列表。</returns>
    IReadOnlyList<ChangelogEntry> GetEntries();
}

/// <summary>
/// 基于 <c>Resources/changelog/CHANGELOG.md</c> 的更新日志服务。
///
/// <para>
/// 为什么用 Markdown 文件而不是数据库表：更新日志是**随代码发布的内容**，
/// 和版本号 / 功能改动一起走 git 评审与回滚，不需要后台录入界面，也不需要迁移与种子数据；
/// 发布时由.csproj 的 <c>Resources\**</c> 规则自动拷进输出目录。
/// </para>
/// <para>
/// 单例注册：解析结果常驻内存，按文件「最后修改时间 + 长度」判断是否需要重新读取，
/// 因此生产环境零读取开销，开发环境改完 md 文件立刻生效。
/// </para>
/// <para>
/// Markdown 格式约定见文件头注释：
/// <c>## [1.2.0] - 2026-11-19</c> 版本标题、<c>### 新增</c> 分组、<c>- 条目</c> 列表；
/// <c>#</c> 大标题与 <c>&lt;!-- --&gt;</c> 注释会被忽略。
/// </para>
/// </summary>
public sealed class ChangelogService : IChangelogService
{
    /// <summary>默认数据文件（相对 ContentRoot；发布 / 开发目录下都有 Resources 副本）。</summary>
    const string DefaultRelativePath = "Resources/changelog/CHANGELOG.md";

    /// <summary>版本标题：## [1.2.0] - 2026-11-19（日期可省略）。</summary>
    static readonly Regex VersionHeadingRegex = new(
        """^##\s+\[(?<version>[^\]\s]+)\](?:\s*[-—–]\s*(?<date>\d{4}-\d{2}-\d{2}))?\s*$""",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>分组标题：### 新增。</summary>
    static readonly Regex SectionHeadingRegex = new(
        """^###\s+(?<title>.+?)\s*$""",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>条目：- 文本（也接受 * / + 开头）。</summary>
    static readonly Regex BulletRegex = new(
        """^\s*[-*+]\s+(?<text>.+?)\s*$""",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>条目没有 ### 分组时的兜底分组标题。</summary>
    const string FallbackSectionTitle = "变更";

    readonly ILogger<ChangelogService> _logger;
    readonly string _filePath;

    /// <summary>缓存读写锁：GetEntries 会被并发请求调用，文件只有在锁内读取。</summary>
    readonly object _sync = new();

    IReadOnlyList<ChangelogEntry> _entries = Array.Empty<ChangelogEntry>();
    DateTime _lastWriteTimeUtc = DateTime.MinValue;
    long _lastLength = -1;
    bool _loaded;
    bool _missingLogged;

    /// <summary>
    /// 创建更新日志服务。
    /// </summary>
    /// <param name="environment">宿主环境，用于定位 ContentRoot。</param>
    /// <param name="configuration">配置，支持 <c>Changelog:FilePath</c> 覆盖数据文件路径。</param>
    /// <param name="logger">日志。</param>
    public ChangelogService(
        IHostEnvironment environment,
        IConfiguration configuration,
        ILogger<ChangelogService> logger)
    {
        _logger = logger;

        var configuredPath = configuration["Changelog:FilePath"];
        var relativePath = string.IsNullOrWhiteSpace(configuredPath)
            ? DefaultRelativePath
            : configuredPath.Trim();
        _filePath = Path.IsPathRooted(relativePath)
            ? relativePath
            : Path.Combine(environment.ContentRootPath, relativePath);
    }

    /// <inheritdoc />
    public IReadOnlyList<ChangelogEntry> GetEntries()
    {
        try
        {
            if (!File.Exists(_filePath))
            {
                lock (_sync)
                {
                    if (!_missingLogged)
                    {
                        _logger.LogWarning(
                            "更新日志文件不存在：{Path}，GET /mm/Changelog 将返回空列表。",
                            _filePath);
                        _missingLogged = true;
                    }

                    _entries = Array.Empty<ChangelogEntry>();
                    _lastWriteTimeUtc = DateTime.MinValue;
                    _lastLength = -1;
                    _loaded = true;
                    return _entries;
                }
            }

            var fileInfo = new FileInfo(_filePath);
            var writeTimeUtc = fileInfo.LastWriteTimeUtc;
            var length = fileInfo.Length;

            lock (_sync)
            {
                // 常见路径：文件没变，直接返回缓存（一次 File.Exists + 属性读取）。
                if (_loaded && writeTimeUtc == _lastWriteTimeUtc && length == _lastLength)
                {
                    return _entries;
                }

                var markdown = File.ReadAllText(_filePath);
                _entries = Parse(markdown);
                _lastWriteTimeUtc = writeTimeUtc;
                _lastLength = length;
                _loaded = true;
                _missingLogged = false;

                _logger.LogInformation(
                    "更新日志已加载：{Count} 个版本（{Path}）", _entries.Count, _filePath);
                return _entries;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // 读文件失败不阻断接口：返回上一次成功解析的内容（可能为空）。
            _logger.LogError(ex, "读取更新日志文件失败：{Path}，返回已缓存内容。", _filePath);
            lock (_sync)
            {
                return _entries;
            }
        }
    }

    /// <summary>
    /// 解析 Markdown 文本。解析器刻意保持宽松：无法识别的行直接忽略，不抛异常。
    /// </summary>
    /// <param name="markdown">Markdown 全文。</param>
    /// <returns>按发布日期倒序的版本条目。</returns>
    static IReadOnlyList<ChangelogEntry> Parse(string markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown))
        {
            return Array.Empty<ChangelogEntry>();
        }

        var entries = new List<ChangelogEntry>();
        ChangelogEntry? currentEntry = null;
        ChangelogSection? currentSection = null;
        var inHtmlComment = false;

        var lines = markdown.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        foreach (var line in lines)
        {
            var trimmed = line.Trim();

            // 跳过 HTML 注释块（文件头维护说明放在注释里，避免被当成条目）。
            if (inHtmlComment)
            {
                if (trimmed.Contains("-->", StringComparison.Ordinal))
                {
                    inHtmlComment = false;
                }

                continue;
            }

            if (trimmed.StartsWith("<!--", StringComparison.Ordinal))
            {
                if (!trimmed.Contains("-->", StringComparison.Ordinal))
                {
                    inHtmlComment = true;
                }

                continue;
            }

            if (trimmed.Length == 0)
            {
                continue;
            }

            // 版本标题：开始新的版本区块（先把上一个收尾）。
            var versionMatch = VersionHeadingRegex.Match(trimmed);
            if (versionMatch.Success)
            {
                if (currentEntry != null)
                {
                    entries.Add(currentEntry);
                }

                currentEntry = new ChangelogEntry
                {
                    Version = versionMatch.Groups["version"].Value.Trim(),
                    Date = versionMatch.Groups["date"].Success
                        ? versionMatch.Groups["date"].Value
                        : null
                };
                currentSection = null;
                continue;
            }

            // 分组标题：归属当前版本。
            var sectionMatch = SectionHeadingRegex.Match(trimmed);
            if (sectionMatch.Success)
            {
                if (currentEntry != null)
                {
                    currentSection = new ChangelogSection
                    {
                        Title = sectionMatch.Groups["title"].Value.Trim()
                    };
                    currentEntry.Sections.Add(currentSection);
                }

                continue;
            }

            // 其它 Markdown 标题（# 大标题、#### 四级标题等）忽略。
            if (trimmed.StartsWith('#'))
            {
                continue;
            }

            // 条目：归属当前分组；没有分组时兜底到一个「变更」分组。
            var bulletMatch = BulletRegex.Match(trimmed);
            if (bulletMatch.Success && currentEntry != null)
            {
                if (currentSection == null)
                {
                    currentSection = new ChangelogSection { Title = FallbackSectionTitle };
                    currentEntry.Sections.Add(currentSection);
                }

                currentSection.Items.Add(bulletMatch.Groups["text"].Value.Trim());
            }
        }

        if (currentEntry != null)
        {
            entries.Add(currentEntry);
        }

        return entries
            .OrderByDescending(entry => ParseDate(entry.Date) ?? DateTime.MinValue)
            .ThenByDescending(entry => entry.Version, ChangelogVersionComparer.Instance)
            .ToList();
    }

    /// <summary>把 <c>YYYY-MM-DD</c> 解析成日期；格式非法返回 null（排序时排到最后）。</summary>
    /// <param name="date">日期字符串。</param>
    /// <returns>日期；解析失败为 null。</returns>
    static DateTime? ParseDate(string? date)
    {
        if (string.IsNullOrWhiteSpace(date))
        {
            return null;
        }

        return DateTime.TryParseExact(
            date.Trim(),
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var parsed)
            ? parsed
            : null;
    }

    /// <summary>
    /// 版本号比较器：优先按 <see cref="Version"/>（1.2.0 &gt; 1.1.9），
    /// 非数字版本（如 <c>1.2.0-beta</c>）回退到字符串比较，保证排序稳定不抛异常。
    /// </summary>
    sealed class ChangelogVersionComparer : IComparer<string>
    {
        /// <summary>共享实例。</summary>
        public static readonly ChangelogVersionComparer Instance = new();

        /// <inheritdoc />
        public int Compare(string? x, string? y)
        {
            var versionX = ParseVersion(x);
            var versionY = ParseVersion(y);
            if (versionX != null && versionY != null)
            {
                return versionX.CompareTo(versionY);
            }

            if (versionX != null)
            {
                return 1;
            }

            if (versionY != null)
            {
                return -1;
            }

            return string.Compare(x, y, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>解析数字版本号（忽略前导 v）。</summary>
        /// <param name="raw">原始版本号。</param>
        /// <returns>可比较的版本；无法解析为 null。</returns>
        static Version? ParseVersion(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return null;
            }

            var text = raw.Trim().TrimStart('v', 'V');
            return Version.TryParse(text, out var version) ? version : null;
        }
    }
}
