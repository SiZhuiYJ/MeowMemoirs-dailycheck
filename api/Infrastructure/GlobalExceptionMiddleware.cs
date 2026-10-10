using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace api.Infrastructure;

/// <summary>
/// 全局异常处理中间件，用于捕获并未处理的异常并记录到文件日志。
/// </summary>
public class GlobalExceptionMiddleware
{
    private const int ClientClosedRequestStatusCode = 499;

    private readonly RequestDelegate _next;
    private readonly ILogger<GlobalExceptionMiddleware> _logger;
    private readonly string _logDirectory;

    public GlobalExceptionMiddleware(RequestDelegate next, ILogger<GlobalExceptionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
        _logDirectory = Path.Combine(Directory.GetCurrentDirectory(), "errorLog");
        if (!Directory.Exists(_logDirectory))
        {
            Directory.CreateDirectory(_logDirectory);
        }
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            if (!context.Response.HasStarted)
            {
                context.Response.StatusCode = ClientClosedRequestStatusCode;
            }
        }
        catch (Exception ex)
        {
            await HandleExceptionAsync(context, ex);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception ex)
    {
        _logger.LogError(ex, "An unhandled exception occurred.");

        if (context.Response.HasStarted)
        {
            return;
        }

        // 记录到文件
        try
        {
            string fileName = $"error-{DateTime.Now:yyyyMMdd}.log";
            string filePath = Path.Combine(_logDirectory, fileName);
            string logContent = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {context.Request.Method} {context.Request.Path}\n" +
                                $"Error: {ex.Message}\n" +
                                $"StackTrace: {ex.StackTrace}\n" +
                                "--------------------------------------------------\n";

            await File.AppendAllTextAsync(filePath, logContent, Encoding.UTF8);
        }
        catch (Exception logEx)
        {
            // 如果写日志也失败，至少在控制台输出
            Console.WriteLine($"Failed to write error log: {logEx.Message}");
        }

        context.Response.ContentType = "application/json";
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;

        await context.Response.WriteAsJsonAsync(new
        {
            StatusCode = context.Response.StatusCode,
            Message = "Internal Server Error. Please check logs for details."
        });
    }
}
