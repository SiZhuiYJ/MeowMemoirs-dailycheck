using System;
using System.Text;
using Microsoft.AspNetCore.Http;

namespace api.Infrastructure;

/// <summary>
/// 客户端信息解析：真实 IP、平台与设备展示名。
///
/// <para>
/// IP 解析只信任「反向代理 / Cloudflare Tunnel」场景下的转发头：
/// 仅当直连方是回环 / 私有地址时，才读取 <c>CF-Connecting-IP</c> 或 <c>X-Forwarded-For</c>
/// 的第一段，避免公网客户端伪造 XFF 绕过登录记录。
/// </para>
/// </summary>
public static class ClientContextResolver
{
    /// <summary>
    /// 解析客户端真实 IP（v4 / v6）。
    /// 直连方为回环 / 私有地址（反向代理 / Cloudflare Tunnel）时依次信任
    /// <c>CF-Connecting-IP</c> → <c>X-Forwarded-For</c> 的第一段；否则使用 TCP 连接的对端地址。
    /// IPv4-mapped IPv6 会归一化为 IPv4，非法值丢弃。
    /// </summary>
    /// <param name="httpContext">当前 HTTP 上下文。</param>
    /// <returns>归一化后的 IP 字符串；无法取得时返回 null。</returns>
    public static string? ResolveClientIp(HttpContext httpContext)
    {
        var remote = httpContext?.Connection.RemoteIpAddress;
        if (remote == null)
            return null;

        remote = IpAddressUtil.Normalize(remote);

        // 只有直连方是代理（回环 / 私有）时才信任转发头。
        if (IpAddressUtil.IsPrivateOrLoopback(remote))
        {
            var cfConnectingIp = httpContext!.Request.Headers["CF-Connecting-IP"].ToString();
            if (IpAddressUtil.TryParse(cfConnectingIp, out var cfAddress))
                return cfAddress.ToString();

            var forwardedFor = httpContext.Request.Headers["X-Forwarded-For"].ToString();
            if (!string.IsNullOrWhiteSpace(forwardedFor))
            {
                var firstHop = forwardedFor.Split(',')[0];
                if (IpAddressUtil.TryParse(firstHop, out var forwardedAddress))
                    return forwardedAddress.ToString();
            }
        }

        return remote.ToString();
    }

    /// <summary>
    /// 解析客户端持久化设备 ID（请求头 <c>X-Device-Id</c>）。
    /// 只保留 <c>[A-Za-z0-9._:-]</c> 字符，清洗后长度必须为 8..64，否则返回 null（由调用方兜底 UA 指纹）。
    /// </summary>
    /// <param name="httpContext">当前 HTTP 上下文。</param>
    /// <returns>合法的设备 ID；未上报或不合规返回 null。</returns>
    public static string? ResolveDeviceId(HttpContext httpContext)
    {
        var raw = httpContext?.Request.Headers["X-Device-Id"].ToString();
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        var builder = new StringBuilder(raw.Length);
        foreach (var ch in raw.Trim())
        {
            if ((ch >= 'A' && ch <= 'Z') ||
                (ch >= 'a' && ch <= 'z') ||
                (ch >= '0' && ch <= '9') ||
                ch is '.' or '_' or ':' or '-')
            {
                builder.Append(ch);
            }
        }

        var value = builder.ToString();
        return value.Length is >= 8 and <= 64 ? value : null;
    }

    /// <summary>
    /// 解析客户端平台与设备展示名。
    /// 平台优先取 <c>X-Client-Platform</c>（白名单 mp-weixin / h5 / app），否则按 User-Agent 推断；
    /// 设备优先取前端上报的 <c>X-Client-Device</c> 机型，否则按 User-Agent 解析出可读名。
    /// </summary>
    /// <param name="httpContext">当前 HTTP 上下文。</param>
    /// <returns>平台标识（mp-weixin/h5/app/unknown）与设备展示名（如 iPhone 13 · 微信）。</returns>
    public static (string Platform, string Device) ResolveDevice(HttpContext httpContext)
    {
        if (httpContext == null)
            return ("unknown", "未知设备");

        var request = httpContext.Request;
        var userAgent = request.Headers.UserAgent.ToString();

        var platform = NormalizePlatform(request.Headers["X-Client-Platform"].ToString())
            ?? InferPlatform(userAgent);

        var platformLabel = platform switch
        {
            "mp-weixin" => "微信",
            "app" => "App",
            _ => string.Empty
        };

        var reportedModel = SanitizeDeviceName(request.Headers["X-Client-Device"].ToString());
        var device = reportedModel.Length > 0
            ? (platformLabel.Length > 0 ? $"{reportedModel} · {platformLabel}" : reportedModel)
            : DescribeUserAgent(userAgent);

        if (string.IsNullOrWhiteSpace(device))
            device = "未知设备";

        return (platform, device);
    }

    /// <summary>平台白名单校验；不在白名单返回 null。</summary>
    static string? NormalizePlatform(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        var value = raw.Trim().ToLowerInvariant();
        return value switch
        {
            "mp-weixin" => "mp-weixin",
            "h5" => "h5",
            "app" => "app",
            _ => null
        };
    }

    /// <summary>按 User-Agent 推断平台（兜底 unknown）。</summary>
    static string InferPlatform(string userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent))
            return "unknown";

        var ua = userAgent.ToLowerInvariant();

        if (ua.Contains("micromessenger") || ua.Contains("miniprogram"))
            return "mp-weixin";

        if (ua.Contains("okhttp") || ua.Contains("cfnetwork") || ua.Contains("dalvik"))
            return "app";

        if (ua.Contains("mozilla") || ua.Contains("chrome") || ua.Contains("safari") ||
            ua.Contains("firefox") || ua.Contains("edg/"))
        {
            return "h5";
        }

        return "unknown";
    }

    /// <summary>
    /// 清洗前端上报的机型：去掉控制字符与首尾空白，最多保留 128 字符。
    /// </summary>
    /// <param name="raw">请求头原值。</param>
    /// <returns>清洗后的机型；空值返回空串。</returns>
    static string SanitizeDeviceName(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return string.Empty;

        var builder = new StringBuilder(raw.Length);
        foreach (var ch in raw)
        {
            if (!char.IsControl(ch))
                builder.Append(ch);
        }

        var value = builder.ToString().Trim();
        return value.Length <= 128 ? value : value[..128];
    }

    /// <summary>
    /// 没有前端上报机型时，从 User-Agent 解析出可读的设备名：
    /// iOS → iPhone / iPad；Android → Android X；桌面 → 浏览器 · 系统；兜底「未知设备」。
    /// </summary>
    /// <param name="userAgent">User-Agent 原值。</param>
    /// <returns>设备展示名。</returns>
    static string DescribeUserAgent(string userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent))
            return "未知设备";

        var ua = userAgent.ToLowerInvariant();

        if (ua.Contains("iphone"))
            return "iPhone";

        if (ua.Contains("ipad"))
            return "iPad";

        if (ua.Contains("android"))
        {
            var version = ReadAndroidVersion(ua);
            return version.Length > 0 ? $"Android {version}" : "Android";
        }

        var browser = DetectDesktopBrowser(ua);
        var os = DetectDesktopOs(ua);

        if (browser.Length > 0 && os.Length > 0)
            return $"{browser} · {os}";

        if (browser.Length > 0)
            return browser;

        if (os.Length > 0)
            return os;

        return "未知设备";
    }

    /// <summary>从 UA 中读取 Android 版本号（如 13 / 14），读不到返回空串。</summary>
    static string ReadAndroidVersion(string ua)
    {
        const string marker = "android ";
        var index = ua.IndexOf(marker, StringComparison.Ordinal);
        if (index < 0)
            return string.Empty;

        var start = index + marker.Length;
        var end = start;
        while (end < ua.Length && (char.IsDigit(ua[end]) || ua[end] == '.'))
            end++;

        return end > start ? ua[start..end].TrimEnd('.') : string.Empty;
    }

    /// <summary>识别桌面浏览器名（Edge / Chrome / Firefox / Safari）。</summary>
    static string DetectDesktopBrowser(string ua)
    {
        if (ua.Contains("edg/") || ua.Contains("edge/"))
            return "Edge";

        if (ua.Contains("chrome/") || ua.Contains("crios/"))
            return "Chrome";

        if (ua.Contains("firefox/") || ua.Contains("fxios/"))
            return "Firefox";

        if (ua.Contains("safari/"))
            return "Safari";

        return string.Empty;
    }

    /// <summary>识别桌面操作系统名（Windows / macOS / Linux / Android / iOS）。</summary>
    static string DetectDesktopOs(string ua)
    {
        if (ua.Contains("windows"))
            return "Windows";

        if (ua.Contains("mac os x") || ua.Contains("macintosh"))
            return "macOS";

        if (ua.Contains("linux"))
            return "Linux";

        return string.Empty;
    }
}
