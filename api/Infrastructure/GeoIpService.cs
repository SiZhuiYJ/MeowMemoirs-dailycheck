using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using MaxMind.Db;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace api.Infrastructure;

/// <summary>
/// GeoIP 归属地类型。
/// </summary>
public enum GeoIpKind
{
    /// <summary>
    /// 中国大陆 IP（GeoCN 命中）。
    /// </summary>
    Domestic,

    /// <summary>
    /// 境外 IP（库已加载但未命中）。
    /// </summary>
    Overseas,

    /// <summary>
    /// 内网 / 回环地址。
    /// </summary>
    Private,

    /// <summary>
    /// 无法判断（非法 IP，或 GeoCN 库未加载）。
    /// </summary>
    Unknown
}

/// <summary>
/// 一次 GeoIP 解析结果。
/// </summary>
/// <param name="Kind">归属地类型。</param>
/// <param name="IsDomestic">是否中国大陆 IP。</param>
/// <param name="Province">省（简称，仅国内）。</param>
/// <param name="City">市（简称，仅国内，可能为空）。</param>
/// <param name="District">区县（简称，仅国内，可能为空）。</param>
/// <param name="Isp">运营商（仅国内，可能为空）。</param>
/// <param name="Location">展示串：国内「河南 · 郑州」、境外「境外」、内网「本地网络」、库未加载「未知位置」。</param>
public sealed record GeoIpLocation(
    GeoIpKind Kind,
    bool IsDomestic,
    string? Province,
    string? City,
    string? District,
    string? Isp,
    string Location);

/// <summary>
/// GeoIP 离线解析服务接口。
/// </summary>
public interface IGeoIpService
{
    /// <summary>
    /// GeoCN 库是否已成功加载。
    /// </summary>
    bool IsReady { get; }

    /// <summary>
    /// 解析 IP 归属地。永不抛异常：NULL / 非法 IP 返回 <see cref="GeoIpKind.Unknown"/>。
    /// </summary>
    /// <param name="ip">待解析的 IP 字符串（v4 / v6 均可）。</param>
    /// <returns>解析结果。</returns>
    GeoIpLocation Resolve(string? ip);
}

/// <summary>
/// 基于 MaxMind.Db + GeoCN 离线库的 GeoIP 解析服务。
/// 单例注册：启动时加载一次 mmdb 与省市区映射表，查询只走内存（Reader 线程安全）。
/// 数据缺失时只打印 warning，不影响登录主流程。
/// </summary>
public sealed class GeoIpService : IGeoIpService, IDisposable
{
    /// <summary>库未加载 / 非法 IP 时的兜底结果。</summary>
    static readonly GeoIpLocation UnknownLocation = new(
        GeoIpKind.Unknown, false, null, null, null, null, "未知位置");

    /// <summary>内网 / 回环地址的结果。</summary>
    static readonly GeoIpLocation PrivateLocation = new(
        GeoIpKind.Private, false, null, null, null, null, "本地网络");

    /// <summary>境外地址的结果。</summary>
    static readonly GeoIpLocation OverseasLocation = new(
        GeoIpKind.Overseas, false, null, null, null, null, "境外");

    readonly ILogger<GeoIpService> _logger;
    readonly Reader? _reader;
    readonly IReadOnlyDictionary<int, string> _divisionFull;
    readonly IReadOnlyDictionary<int, string> _divisionShort;

    /// <summary>
    /// 构造时加载一次 GeoCN 库与省市区映射表；任何失败只记录 warning。
    /// </summary>
    /// <param name="configuration">应用配置（GeoIp 配置节）。</param>
    /// <param name="logger">日志。</param>
    public GeoIpService(IConfiguration configuration, ILogger<GeoIpService> logger)
    {
        _logger = logger;

        var section = configuration.GetSection("GeoIp");
        var enabled = section.GetValue("Enabled", true);
        var databasePath = ResolvePath(section.GetValue<string>("DatabasePath"), "Resources/ipTo/GeoCN.mmdb");
        var divisionFullPath = ResolvePath(section.GetValue<string>("DivisionFullPath"), "Resources/ipTo/full.txt");
        var divisionShortPath = ResolvePath(section.GetValue<string>("DivisionShortPath"), "Resources/ipTo/short.txt");

        _divisionFull = LoadDivisionMap(divisionFullPath, '\t');
        _divisionShort = LoadDivisionMap(divisionShortPath, "  ");

        if (!enabled)
        {
            _logger.LogWarning("[GeoIp] GeoIp:Enabled=false，登录地点统一记为“未知位置”");
            return;
        }

        if (!File.Exists(databasePath))
        {
            _logger.LogWarning("[GeoIp] GeoCN 库不存在：{Path}，登录地点统一记为“未知位置”", databasePath);
            return;
        }

        try
        {
            _reader = new Reader(databasePath);
            _logger.LogInformation(
                "[GeoIp] GeoCN 库已加载：{Path}（IPVersion={IPVersion}，省市区映射 {Count} 条）",
                databasePath,
                _reader.Metadata.IPVersion,
                _divisionShort.Count);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[GeoIp] GeoCN 库加载失败：{Path}，登录地点统一记为“未知位置”", databasePath);
            _reader = null;
        }
    }

    /// <summary>
    /// GeoCN 库是否已成功加载。
    /// </summary>
    public bool IsReady => _reader != null;

    /// <summary>
    /// 解析 IP 归属地。永不抛异常：NULL / 非法 IP 返回 <see cref="GeoIpKind.Unknown"/>。
    /// 判定顺序：非法 IP → Unknown；回环/私有地址 → Private；
    /// GeoCN 命中 → Domestic；未命中且库就绪 → Overseas；库未加载 → Unknown。
    /// </summary>
    /// <param name="ip">待解析的 IP 字符串（v4 / v6 均可）。</param>
    /// <returns>解析结果。</returns>
    public GeoIpLocation Resolve(string? ip)
    {
        if (string.IsNullOrWhiteSpace(ip))
            return UnknownLocation;

        try
        {
            if (!IPAddress.TryParse(ip.Trim(), out var address))
                return UnknownLocation;

            // IPv4-mapped IPv6（::ffff:1.2.3.4）先归一化成 IPv4。
            address = IpAddressUtil.Normalize(address);

            if (IpAddressUtil.IsPrivateOrLoopback(address))
                return PrivateLocation;

            var reader = _reader;
            if (reader == null)
                return UnknownLocation;

            Dictionary<string, object>? record;
            try
            {
                record = reader.Find<Dictionary<string, object>>(address, null);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[GeoIp] GeoCN 查询失败 ip={Ip}", ip);
                return UnknownLocation;
            }

            if (record == null)
                return OverseasLocation;

            if (!record.TryGetValue("division_code", out var rawCode) || rawCode == null)
                return OverseasLocation;

            int code;
            try
            {
                code = Convert.ToInt32(rawCode, CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return OverseasLocation;
            }

            if (code <= 0)
                return OverseasLocation;

            // 区域编码规则：省 = code / 10000 * 10000，市 = code / 100 * 100，区 = code。
            var provinceCode = code / 10000 * 10000;
            var cityCode = code / 100 * 100;

            var province = LookupDivision(provinceCode);
            var city = cityCode != provinceCode ? LookupDivision(cityCode) : null;
            var district = code != provinceCode && code != cityCode ? LookupDivision(code) : null;

            // 直辖市去重：省名 == 市名时只保留省名（北京市 / 北京市 → 北京市）。
            if (!string.IsNullOrEmpty(city) && string.Equals(city, province, StringComparison.Ordinal))
                city = null;
            if (!string.IsNullOrEmpty(district) &&
                (string.Equals(district, province, StringComparison.Ordinal) ||
                 string.Equals(district, city, StringComparison.Ordinal)))
            {
                district = null;
            }

            var isp = record.TryGetValue("isp", out var rawIsp) ? rawIsp as string : null;
            isp = string.IsNullOrWhiteSpace(isp) ? null : isp.Trim();

            // 展示串：国内「省 · 市」；市为空只显省；名称缺失兜底「国内」。
            var location = string.IsNullOrEmpty(province)
                ? "国内"
                : string.IsNullOrEmpty(city) ? province : $"{province} · {city}";

            return new GeoIpLocation(GeoIpKind.Domestic, true, province, city, district, isp, location);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[GeoIp] 解析 IP 归属地失败 ip={Ip}", ip);
            return UnknownLocation;
        }
    }

    /// <summary>
    /// 释放 MaxMind Reader（单例随应用生命周期存在，进程退出时由容器调用）。
    /// </summary>
    public void Dispose()
    {
        _reader?.Dispose();
    }

    /// <summary>编码 → 名称：优先简称表，回退全名表。</summary>
    string? LookupDivision(int code)
    {
        if (_divisionShort.TryGetValue(code, out var shortName) && !string.IsNullOrWhiteSpace(shortName))
            return shortName;

        if (_divisionFull.TryGetValue(code, out var fullName) && !string.IsNullOrWhiteSpace(fullName))
            return fullName;

        return null;
    }

    /// <summary>把配置里的相对路径解析成相对程序目录的绝对路径。</summary>
    static string ResolvePath(string? configuredPath, string fallbackRelativePath)
    {
        var path = string.IsNullOrWhiteSpace(configuredPath) ? fallbackRelativePath : configuredPath.Trim();
        return Path.IsPathRooted(path) ? path : Path.Combine(AppContext.BaseDirectory, path);
    }

    /// <summary>
    /// 加载「编码 → 名称」映射表；分隔符分别对应 full.txt（制表符）与 short.txt（两个空格）。
    /// 文件不存在或单行格式非法时跳过，不抛异常。
    /// </summary>
    static IReadOnlyDictionary<int, string> LoadDivisionMap(string path, char separator)
        => LoadDivisionMap(path, separator.ToString());

    /// <summary>
    /// 加载「编码 → 名称」映射表；分隔符分别对应 full.txt（制表符）与 short.txt（两个空格）。
    /// 文件不存在或单行格式非法时跳过，不抛异常。
    /// </summary>
    static IReadOnlyDictionary<int, string> LoadDivisionMap(string path, string separator)
    {
        var map = new Dictionary<int, string>();

        if (!File.Exists(path))
            return map;

        try
        {
            foreach (var line in File.ReadLines(path))
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;

                var index = line.IndexOf(separator, StringComparison.Ordinal);
                if (index <= 0)
                    continue;

                var codeText = line[..index].Trim();
                if (!int.TryParse(codeText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var code))
                    continue;

                var name = line[(index + separator.Length)..].Trim();
                if (name.Length == 0)
                    continue;

                map[code] = name;
            }
        }
        catch (Exception)
        {
            // 映射表缺失/读取失败不阻断登录，按「名称缺失」处理。
        }

        return map;
    }
}
