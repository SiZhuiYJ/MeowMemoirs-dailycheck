using System;
using System.Net;
using System.Net.Sockets;

namespace api.Infrastructure;

/// <summary>
/// IP 地址归一化与内网 / 回环判定工具。
/// </summary>
internal static class IpAddressUtil
{
    /// <summary>
    /// IPv4-mapped IPv6（<c>::ffff:1.2.3.4</c>）归一化为 IPv4；其它地址原样返回。
    /// </summary>
    /// <param name="address">待归一化的地址。</param>
    /// <returns>归一化后的地址。</returns>
    internal static IPAddress Normalize(IPAddress address)
    {
        if (address.AddressFamily == AddressFamily.InterNetworkV6 && address.IsIPv4MappedToIPv6)
            return address.MapToIPv4();

        return address;
    }

    /// <summary>
    /// 解析并归一化 IP 字符串（容忍 <c>[IPv6]</c> / <c>[IPv6]:port</c> 写法）；非法返回 false。
    /// </summary>
    /// <param name="raw">IP 字符串。</param>
    /// <param name="address">解析成功的地址。</param>
    /// <returns>是否解析成功。</returns>
    internal static bool TryParse(string? raw, out IPAddress address)
    {
        address = IPAddress.None;

        if (string.IsNullOrWhiteSpace(raw))
            return false;

        var value = raw.Trim();

        // 兼容反向代理偶尔带上的方括号（[2001:db8::1] 或 [2001:db8::1]:443）。
        if (value.StartsWith('['))
        {
            var close = value.IndexOf(']');
            if (close > 1)
                value = value[1..close];
        }

        if (!IPAddress.TryParse(value, out var parsed))
            return false;

        address = Normalize(parsed);
        return true;
    }

    /// <summary>
    /// 是否回环 / 私有地址：
    /// 127.0.0.0/8、::1、10/8、172.16/12、192.168/16、fc00::/7、fe80::/10。
    /// IPv4-mapped IPv6 会先归一化。
    /// </summary>
    /// <param name="address">待判定的地址。</param>
    /// <returns>是回环或私有地址时返回 true。</returns>
    internal static bool IsPrivateOrLoopback(IPAddress address)
    {
        address = Normalize(address);

        if (IPAddress.IsLoopback(address))
            return true;

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var bytes = address.GetAddressBytes();
            return bytes[0] == 10
                || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
                || (bytes[0] == 192 && bytes[1] == 168);
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var bytes = address.GetAddressBytes();
            if (bytes.Length != 16)
                return false;

            // fc00::/7：唯一本地地址（fc00::/8 与 fd00::/8）。
            if ((bytes[0] & 0xFE) == 0xFC)
                return true;

            // fe80::/10：链路本地地址。
            if (bytes[0] == 0xFE && (bytes[1] & 0xC0) == 0x80)
                return true;
        }

        return false;
    }
}
