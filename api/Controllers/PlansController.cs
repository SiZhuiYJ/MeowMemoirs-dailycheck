using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using api.Data;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace api.Controllers;

/// <summary>
/// 打卡计划管理接口，提供完整的计划生命周期管理功能。
/// 支持创建、查询、更新、删除打卡计划，以及时间段配置管理。
/// 实现计划的启用/禁用控制，支持灵活的时间段设置和排序。
/// </summary>
/// <remarks>
/// 核心功能模块：
/// • 计划创建：支持基础信息和时间段配置
/// • 计划查询：获取用户所有有效计划列表
/// • 计划更新：修改计划信息和时间段设置
/// • 计划删除：软删除机制保护数据完整性
/// • 时间段管理：灵活的时间段配置和排序
/// • 状态控制：启用/禁用计划状态管理
/// 
/// 打卡模式支持：
/// • 默认模式：一天一次打卡
/// • 时间段模式：一天多个时间段分别打卡
/// 
/// 数据一致性保证：
/// • 时间段重叠检测
/// • 时间顺序验证
/// • 关联数据级联处理
/// • 软删除数据保护
/// </remarks>
[ApiController]
[Route("mm/[controller]")]
[Authorize]
public class PlansController(DailyCheckDbContext db) : ControllerBase
{
    readonly DailyCheckDbContext _db = db;

    /// <summary>
    /// 获取当前登录用户的打卡计划列表接口。
    /// 返回用户所有未删除的打卡计划，按开始日期升序排列。
    /// 每个计划包含关联的时间段配置信息。
    /// </summary>
    /// <remarks>
    /// 返回数据结构：
    /// [
    ///   {
    ///     "Id": 1,
    ///     "Title": "每日学习计划",
    ///     "Description": "坚持每日学习",
    ///     "StartDate": "2024-01-01",
    ///     "EndDate": "2024-12-31",
    ///     "IsActive": true,
    ///     "CheckinMode": 1,
    ///     "TimeSlots": [
    ///       {
    ///         "Id": 101,
    ///         "SlotName": "早晨",
    ///         "StartTime": "08:00:00",
    ///         "EndTime": "10:00:00",
    ///        "OrderNum": 1,
    ///        "IsActive": true
    ///      }
    ///    ]
    ///   }
    /// ]
    /// 查询条件：
    /// • 仅返回当前用户的计划
    /// • 过滤已删除的计划
    /// • 按开始日期升序排列
    /// • 包含活跃的时间段信息
    /// 应用场景：
    /// • 用户计划管理首页
    /// • 打卡选择界面
    /// • 计划统计分析
    /// • 历史计划回顾
    /// </remarks>
    /// <returns>
    /// 成功时返回200 OK，包含计划概要列表；
    /// 每个计划项包含基本属性和时间段详情。
    /// </returns>
    /// <response code="200">获取计划列表成功</response>
    [HttpGet]
    public async Task<ActionResult<List<PlanSummary>>> GetMyPlans()
    {
        var userId = GetUserId();
        var plans = await _db.CheckinPlans
            .Include(x => x.CheckinPlanTimeSlots)
            .Where(x => x.UserId == userId && !x.IsDeleted)
            .OrderBy(x => x.StartDate)
            .Select(x => new PlanSummary
            {
                Id = (long)x.Id,
                CheckinMode = x.CheckinMode,
                Title = x.Title,
                Description = x.Description,
                StartDate = x.StartDate,
                EndDate = x.EndDate,
                IsActive = x.IsActive,
                TimeSlots = x.CheckinPlanTimeSlots
                    .Where(ts => ts.IsActive == true)
                    .OrderBy(ts => ts.OrderNum)
                    .ThenBy(ts => ts.StartTime)
                    .Select(ts => new TimeSlotDto
                    {
                        Id = ts.Id,
                        SlotName = ts.SlotName,
                        StartTime = ts.StartTime,
                        EndTime = ts.EndTime,
                        OrderNum = ts.OrderNum,
                        IsActive = ts.IsActive ?? true
                    }).ToList()
            })
            .ToListAsync();

        return Ok(plans);
    }


    /// <summary>
    /// 获取当前登录用户的单个打卡计划详情。
    /// </summary>
    /// <param name="planId">计划ID。</param>
    /// <returns>计划详情。</returns>
    [HttpGet("{planId}")]
    public async Task<ActionResult<PlanSummary>> GetPlanById(ulong planId)
    {
        var userId = GetUserId();
        var plan = await _db.CheckinPlans
            .Include(x => x.CheckinPlanTimeSlots)
            .Where(x => x.Id == planId && x.UserId == userId && !x.IsDeleted)
            .Select(x => new PlanSummary
            {
                Id = (long)x.Id,
                CheckinMode = x.CheckinMode,
                Title = x.Title,
                Description = x.Description,
                StartDate = x.StartDate,
                EndDate = x.EndDate,
                IsActive = x.IsActive,
                TimeSlots = x.CheckinPlanTimeSlots
                    .Where(ts => ts.IsActive == true)
                    .OrderBy(ts => ts.OrderNum)
                    .ThenBy(ts => ts.StartTime)
                    .Select(ts => new TimeSlotDto
                    {
                        Id = ts.Id,
                        SlotName = ts.SlotName,
                        StartTime = ts.StartTime,
                        EndTime = ts.EndTime,
                        OrderNum = ts.OrderNum,
                        IsActive = ts.IsActive ?? true
                    }).ToList()
            })
            .SingleOrDefaultAsync();

        return plan == null ? NotFound(new { message = "未找到计划" }) : Ok(plan);
    }

    /// <summary>
    /// 创建新的打卡计划接口。
    /// 支持设置计划标题、描述、时间范围和时间段配置。
    /// 自动验证时间段的有效性和无重叠性。
    /// 新创建的计划默认处于启用状态。
    /// </summary>
    /// <remarks>
    /// 创建流程：
    /// 1. 验证基础信息完整性
    /// 2. 时间段配置验证
    /// 3. 时间重叠检测
    /// 4. 数据库记录创建
    /// 5. 关联时间段批量插入
    /// 时间段验证规则：
    /// • 开始时间必须早于结束时间
    /// • 时间段之间不能重叠
    /// • 按开始时间排序检查
    /// • 支持时间段的启用状态设置
    /// 打卡模式判断：
    /// • 有时间段配置：CheckinMode = 1（时间段模式）
    /// • 无时间段配置：CheckinMode = 0（默认模式）
    /// 数据完整性：
    /// • 自动生成创建和更新时间戳
    /// • 设置初始启用状态
    /// • 软删除标志初始化
    /// • 用户权限自动关联
    /// </remarks>
    /// <param name="request">创建计划请求参数，包含计划基本信息和时间段配置。</param>
    /// <returns>
    /// 成功时返回201 Created，包含新创建的计划概要信息；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="201">计划创建成功</response>
    /// <response code="400">请求参数错误，如时间段设置无效</response>
    [HttpPost]
    public async Task<ActionResult<PlanSummary>> CreatePlan(CreatePlanRequest request)
    {
        var userId = GetUserId();
        var startDate = request.StartDate ?? DateOnly.FromDateTime(DateTime.UtcNow.Date);

        // 验证时间段
        if (request.TimeSlots != null && request.TimeSlots.Count > 0)
        {
            foreach (var slot in request.TimeSlots)
            {
                if (slot.StartTime >= slot.EndTime)
                {
                    return BadRequest(new { message = $"时间段 {slot.SlotName} 开始时间必须早于结束时间" });
                }
            }

            var sortedSlots = request.TimeSlots.OrderBy(s => s.StartTime).ToList();
            for (int i = 0; i < sortedSlots.Count - 1; i++)
            {
                if (sortedSlots[i].EndTime > sortedSlots[i + 1].StartTime)
                {
                    return BadRequest(new { message = "时间段存在重叠，请检查设置" });
                }
            }
        }

        var plan = new CheckinPlan
        {
            UserId = (ulong)userId,
            Title = request.Title,
            Description = request.Description,
            StartDate = startDate,
            EndDate = request.EndDate,
            IsActive = true,
            IsDeleted = false,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            CheckinMode = request.TimeSlots?.Count > 0 ? (byte)1 : (byte)0 // 根据是否有时间段配置设置打卡模式
        };

        if (request.TimeSlots != null)
        {
            foreach (var slotDto in request.TimeSlots)
            {
                plan.CheckinPlanTimeSlots.Add(new CheckinPlanTimeSlot
                {
                    SlotName = slotDto.SlotName,
                    StartTime = slotDto.StartTime,
                    EndTime = slotDto.EndTime,
                    OrderNum = slotDto.OrderNum,
                    IsActive = slotDto.IsActive,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                });
            }
        }

        _db.CheckinPlans.Add(plan);
        await _db.SaveChangesAsync();

        var result = new PlanSummary
        {
            Id = (long)plan.Id,
            Title = plan.Title,
            Description = plan.Description,
            StartDate = plan.StartDate,
            EndDate = plan.EndDate,
            IsActive = plan.IsActive,
            CheckinMode = plan.CheckinMode,
            TimeSlots = [.. plan.CheckinPlanTimeSlots.Select(ts => new TimeSlotDto
            {
                Id = ts.Id,
                SlotName = ts.SlotName,
                StartTime = ts.StartTime,
                EndTime = ts.EndTime,
                OrderNum = ts.OrderNum,
                IsActive = ts.IsActive ?? true
            })]
        };

        return CreatedAtAction(nameof(GetPlanById), new { planId = plan.Id }, result);
    }

    /// <summary>
    /// 更新指定打卡计划接口。
    /// 支持更新计划的基本信息和时间段配置。
    /// 时间段更新采用全量替换策略，会删除原有配置并重建。
    /// 自动验证时间段的有效性和无重叠性。
    /// </summary>
    /// <remarks>
    /// 更新策略说明：
    /// • 全量替换：时间段配置完全重新设置
    /// • 增量更新：计划基本信息部分更新
    /// • 数据保护：验证用户权限和计划存在性
    /// 更新内容：
    /// 基本信息更新：
    /// 
    /// • 计划标题
    /// • 计划描述
    /// • 开始和结束日期
    /// • 启用状态
    /// 时间段更新：
    /// 
    /// • 删除原有所有时间段
    /// • 创建新的时间段配置
    /// • 重新进行时间验证
    /// 
    /// 安全验证：
    /// • 用户所有权检查
    /// • 计划存在性验证
    /// • 时间段有效性验证
    /// • 重叠冲突检测
    /// </remarks>
    /// <param name="planId"></param>
    /// <param name="request">更新计划请求参数，包含计划ID和需要更新的属性。</param>
    /// <returns>
    /// 成功时返回204 No Content；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="204">计划更新成功</response>
    /// <response code="400">请求参数错误或时间段设置无效</response>
    /// <response code="404">计划不存在或无权限访问</response>
    [HttpPut("{planId}")]
    public async Task<ActionResult> UpdatePlan(ulong planId, [FromBody] UpdatePlanRequest request)
    {
        var userId = GetUserId();
        var plan = await _db.CheckinPlans
            .Include(x => x.CheckinPlanTimeSlots)
            .FirstOrDefaultAsync(x => x.Id == planId && x.UserId == userId && !x.IsDeleted);
        if (plan == null)
        {
            return NotFound(new { message = "未找到计划" });
        }

        // 验证时间段
        if (request.TimeSlots != null)
        {
            if (request.TimeSlots.Count > 0)
            {
                foreach (var slot in request.TimeSlots)
                {
                    if (slot.StartTime >= slot.EndTime)
                    {
                        return BadRequest(new { message = $"时间段 {slot.SlotName} 开始时间必须早于结束时间" });
                    }
                }

                var sortedSlots = request.TimeSlots.OrderBy(s => s.StartTime).ToList();
                for (int i = 0; i < sortedSlots.Count - 1; i++)
                {
                    if (sortedSlots[i].EndTime > sortedSlots[i + 1].StartTime)
                    {
                        return BadRequest(new { message = "时间段存在重叠，请检查设置" });
                    }
                }
            }

            // 更新时间段：先清除旧的（或者标记删除），这里选择物理删除重建，简单有效
            _db.CheckinPlanTimeSlots.RemoveRange(plan.CheckinPlanTimeSlots);

            foreach (var slotDto in request.TimeSlots)
            {
                plan.CheckinPlanTimeSlots.Add(new CheckinPlanTimeSlot
                {
                    PlanId = plan.Id,
                    SlotName = slotDto.SlotName,
                    StartTime = slotDto.StartTime,
                    EndTime = slotDto.EndTime,
                    OrderNum = slotDto.OrderNum,
                    IsActive = slotDto.IsActive,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                });
            }
        }

        plan.Title = request.Title ?? plan.Title;
        plan.Description = request.Description ?? plan.Description;
        plan.StartDate = request.StartDate ?? plan.StartDate;
        plan.EndDate = request.EndDate ?? plan.EndDate;
        plan.IsActive = request.IsActive;
        plan.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// 删除指定打卡计划接口。
    /// 采用软删除机制，仅标记计划为已删除状态。
    /// 不会影响已存在的打卡记录，但计划将不再显示在列表中。
    /// </summary>
    /// <remarks>
    /// 软删除设计：
    /// • 不真正删除数据库记录
    /// • 设置IsDeleted标志位
    /// • 保留历史打卡数据
    /// • 维护数据完整性和可追溯性
    /// 删除影响范围：
    /// 
    /// 不受影响：
    /// • 已存在的打卡记录
    /// • 历史统计数据
    /// • 相关日志信息
    /// 
    /// 受影响：
    /// • 计划不再出现在列表中
    /// • 无法基于该计划进行新打卡
    /// • 相关时间段配置隐藏
    /// 
    /// 业务考虑：
    /// • 数据审计需求
    /// • 用户误操作恢复
    /// • 统计数据连续性
    /// • 合规性要求满足
    /// </remarks>
    /// <param name="planId">要删除的打卡计划ID。</param>
    /// <returns>
    /// 成功时返回204 No Content；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="204">计划删除成功</response>
    /// <response code="404">计划不存在或无权限访问</response>
    [HttpDelete("{planId}")]
    public async Task<ActionResult> DeletePlan(ulong planId)
    {
        var userId = GetUserId();
        var plan = await _db.CheckinPlans
            .FirstOrDefaultAsync(x => x.Id == planId && x.UserId == userId && !x.IsDeleted);
        if (plan == null)
        {
            return NotFound(new { message = "未找到计划" });
        }
        plan.IsDeleted = true;
        plan.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return NoContent();
    }


    /// <summary>
    /// 兼容旧版客户端的计划删除接口（建议迁移到 DELETE /mm/plans/{planId}）。
    /// </summary>
    [HttpPost("delete")]
    [ApiExplorerSettings(IgnoreApi = true)]
    public Task<ActionResult> DeletePlanLegacy([FromQuery] ulong planId)
    {
        return DeletePlan(planId);
    }

    /// <summary>
    /// 兼容旧版客户端的计划更新接口（建议迁移到 PUT /mm/plans/{planId}）。
    /// </summary>
    [HttpPost("update")]
    [ApiExplorerSettings(IgnoreApi = true)]
    public Task<ActionResult> UpdatePlanLegacy([FromBody] UpdatePlanRequest request)
    {
        return UpdatePlan(request.Id, request);
    }


    /// <summary>
    /// 从当前访问令牌中解析用户 ID。
    /// </summary>
    /// <returns>当前登录用户的 ID。</returns>
    ulong GetUserId()
    {
        var idClaim = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        var subClaim = User.FindFirstValue("sub");
        var value = idClaim ?? subClaim;
        return value == null ? throw new InvalidOperationException("User id not found in token") : ulong.Parse(value);
    }
}
