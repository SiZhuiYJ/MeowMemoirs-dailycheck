using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace api.Controllers;

/// <summary>
/// 客户端埋点接收接口。
///
/// 设计取舍：
/// • POST 允许匿名——「登录过期」恰恰发生在令牌失效之后，
///   此时如果要求鉴权，最需要的那几条日志反而写不进来；
///   因此只做体积/条数限制，不落库、不返回敏感信息。
/// • 存储为按天滚动的 JSONL 文件（errorLog/client/），
///   可以直接 grep/tail，不需要改数据库结构。
/// • GET 需要登录，避免日志被未授权读取。
/// </summary>
[ApiController]
[Route("mm/[controller]")]
public class TelemetryController : ControllerBase
{
    /// <summary>单次请求体上限（256KB）。</summary>
    const int MaxBodyBytes = 256 * 1024;

    /// <summary>单批最多接收的事件数。</summary>
    const int MaxEventsPerBatch = 200;

    /// <summary>GET 最近日志时最多返回的行数。</summary>
    const int MaxRecentLines = 500;

    static readonly SemaphoreSlim WriteLock = new(1, 1);

    readonly string _logDirectory;

    public TelemetryController()
    {
        _logDirectory = Path.Combine(Directory.GetCurrentDirectory(), "errorLog", "client");
    }

    /// <summary>
    /// 接收客户端埋点事件（允许匿名）。
    /// </summary>
    [HttpPost("events")]
    [AllowAnonymous]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> PostEvents()
    {
        string body;
        using (var reader = new StreamReader(Request.Body, Encoding.UTF8))
        {
            body = await reader.ReadToEndAsync();
        }

        if (string.IsNullOrWhiteSpace(body))
            return BadRequest(new { message = "empty body" });

        if (Encoding.UTF8.GetByteCount(body) > MaxBodyBytes)
            return StatusCode(413, new { message = "payload too large" });

        JsonElement root;
        try
        {
            root = JsonSerializer.Deserialize<JsonElement>(body);
        }
        catch (JsonException)
        {
            return BadRequest(new { message = "invalid json" });
        }

        var receivedAt = DateTime.UtcNow;
        var remoteIp = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "";

        var lines = new List<string>();
        // 支持两种格式：{client, events:[...]} 批量体，以及顶层直接是数组
        JsonElement? events = null;
        JsonElement? client = null;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("events", out var eventsElement)
            && eventsElement.ValueKind == JsonValueKind.Array)
        {
            events = eventsElement;
            if (root.TryGetProperty("client", out var clientElement)) client = clientElement;
        }
        else if (root.ValueKind == JsonValueKind.Array)
        {
            events = root;
        }

        if (events.HasValue)
        {
            foreach (var item in events.Value.EnumerateArray().Take(MaxEventsPerBatch))
            {
                var line = new
                {
                    receivedAt = receivedAt.ToString("O"),
                    ip = remoteIp,
                    client = client.HasValue ? (object)client.Value : null,
                    @event = item
                };
                lines.Add(JsonSerializer.Serialize(line));
            }
        }
        else
        {
            // 兼容单条事件上报
            lines.Add(JsonSerializer.Serialize(new
            {
                receivedAt = receivedAt.ToString("O"),
                ip = remoteIp,
                client = (object?)null,
                @event = root
            }));
        }

        if (lines.Count == 0)
            return Ok(new { accepted = 0 });

        try
        {
            Directory.CreateDirectory(_logDirectory);
            var filePath = Path.Combine(_logDirectory, $"client-{receivedAt:yyyyMMdd}.log");
            var content = string.Join(Environment.NewLine, lines) + Environment.NewLine;

            await WriteLock.WaitAsync();
            try
            {
                await System.IO.File.AppendAllTextAsync(filePath, content, Encoding.UTF8);
            }
            finally
            {
                WriteLock.Release();
            }
        }
        catch (Exception ex)
        {
            // 埋点写入失败绝不拖累业务，但要能在服务端日志看到
            Console.WriteLine($"[Telemetry] 写入失败: {ex.Message}");
            return StatusCode(500, new { message = "failed to persist" });
        }

        return Ok(new { accepted = lines.Count });
    }

    /// <summary>
    /// 读取最近接收到的客户端埋点（需登录），便于直接排查。
    /// </summary>
    /// <param name="lines">返回的最大行数，默认 100。</param>
    /// <param name="level">按级别过滤，例如 error。</param>
    /// <param name="category">按分类过滤，例如 auth / file / app。</param>
    [HttpGet("recent")]
    [Authorize]
    public async Task<IActionResult> GetRecent(int lines = 100, string? level = null, string? category = null)
    {
        if (!Directory.Exists(_logDirectory))
            return Ok(new { files = Array.Empty<string>(), events = Array.Empty<object>() });

        var take = Math.Clamp(lines, 1, MaxRecentLines);
        var files = Directory.GetFiles(_logDirectory, "client-*.log").OrderBy(x => x).ToArray();
        if (files.Length == 0)
            return Ok(new { files, events = Array.Empty<object>() });

        var all = new List<string>();
        // 从最新文件往前读，凑够 take 条即可
        for (var i = files.Length - 1; i >= 0 && all.Count < take; i--)
        {
            var fileLines = await System.IO.File.ReadAllLinesAsync(files[i]);
            for (var j = fileLines.Length - 1; j >= 0 && all.Count < take; j--)
            {
                all.Add(fileLines[j]);
            }
        }

        var result = new List<JsonElement>();
        foreach (var line in all)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                var parsed = JsonSerializer.Deserialize<JsonElement>(line);
                if (level != null || category != null)
                {
                    if (!parsed.TryGetProperty("event", out var ev)) continue;
                    if (level != null && (!ev.TryGetProperty("level", out var lv)
                        || !string.Equals(lv.GetString(), level, StringComparison.OrdinalIgnoreCase))) continue;
                    if (category != null && (!ev.TryGetProperty("category", out var cat)
                        || !string.Equals(cat.GetString(), category, StringComparison.OrdinalIgnoreCase))) continue;
                }
                result.Add(parsed);
            }
            catch (JsonException)
            {
                // 跳过损坏行
            }
        }

        return Ok(new { files, events = result });
    }
}
