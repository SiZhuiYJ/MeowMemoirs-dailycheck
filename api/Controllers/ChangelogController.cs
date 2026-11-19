using System;
using System.Linq;
using api.Infrastructure;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace api.Controllers;

/// <summary>
/// 更新日志接口（公开，无需登录）。
///
/// <para>
/// 数据源是随源码发布的 Markdown 文件 <c>Resources/changelog/CHANGELOG.md</c>，
/// 由 <see cref="IChangelogService"/> 解析成结构化 JSON，**不落数据库**：
/// 更新日志属于发布内容，跟版本号一起走 git 评审 / 回滚，不需要后台录入与迁移。
/// </para>
/// <para>
/// 小程序与 Web 的设置页「更新日志」共用这个接口；条目是纯文本，
/// 客户端直接渲染，不需要 Markdown 渲染器。
/// </para>
/// </summary>
[ApiController]
[Route("mm/[controller]")]
[AllowAnonymous]
public class ChangelogController(IChangelogService changelogService) : ControllerBase
{
    /// <summary>默认返回的版本条目数。</summary>
    const int DefaultLimit = 20;

    /// <summary>最多返回的版本条目数。</summary>
    const int MaxLimit = 50;

    readonly IChangelogService _changelogService = changelogService;

    /// <summary>
    /// 获取更新日志版本列表（按发布日期倒序）。
    ///
    /// <para>
    /// 公开接口，不需要访问令牌；<c>total</c> 是解析出的全部版本数（不受 <c>limit</c> 影响），
    /// <c>items</c> 才是本次返回的版本。数据文件缺失时返回 200 + 空列表，不阻断前端页面。
    /// </para>
    /// </summary>
    /// <param name="limit">最多返回的版本数，可选，默认 20，取值夹到 1..50。</param>
    /// <returns>更新日志列表（含最新版本号 / 日期）。</returns>
    /// <response code="200">获取成功（文件缺失时 items 为空数组）</response>
    [HttpGet]
    [ProducesResponseType(typeof(ChangelogListResponse), StatusCodes.Status200OK)]
    public ActionResult<ChangelogListResponse> GetChangelog([FromQuery] int? limit = null)
    {
        var entries = _changelogService.GetEntries();
        var effectiveLimit = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

        return Ok(new ChangelogListResponse
        {
            LatestVersion = entries.Count > 0 ? entries[0].Version : null,
            LatestDate = entries.Count > 0 ? entries[0].Date : null,
            Total = entries.Count,
            Items = entries.Take(effectiveLimit).ToList()
        });
    }
}
