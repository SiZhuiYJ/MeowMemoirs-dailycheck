using System;

namespace api.Models;

/// <summary>
/// 创建打卡计划的请求参数。
/// </summary>
public class CreatePlanRequest
{
    /// <summary>
    /// 打卡计划标题。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 计划描述，可为空。
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// 计划开始日期，不传则默认为当天。
    /// </summary>
    public DateOnly? StartDate { get; set; }

    /// <summary>
    /// 计划结束日期，可为空。
    /// </summary>
    public DateOnly? EndDate { get; set; }

    /// <summary>
    /// 打卡时间段列表
    /// </summary>
    public List<TimeSlotDto>? TimeSlots { get; set; }
}
/// <summary>
/// 更新打卡计划的请求参数。
/// </summary>
public class UpdatePlanRequest
{
    /// <summary>
    /// 打卡计划唯一标识。
    /// </summary>
    public ulong Id { get; set; }
    /// <summary>
    /// 打卡计划标题。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 计划描述，可为空。
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// 是否处于启用状态。
    /// </summary>
    public bool IsActive { get; set; }

    /// <summary>
    /// 计划开始日期，不传则默认为当天。
    /// </summary>
    public DateOnly? StartDate { get; set; }

    /// <summary>
    /// 计划结束日期，可为空。
    /// </summary>
    public DateOnly? EndDate { get; set; }

    /// <summary>
    /// 打卡时间段列表
    /// </summary>
    public List<TimeSlotDto>? TimeSlots { get; set; }
}
/// <summary>
/// 打卡计划概要信息，用于列表展示。
/// </summary>
public class PlanSummary
{
    /// <summary>
    /// 计划唯一标识。
    /// </summary>
    public long Id { get; set; }

    /// <summary>
    /// 打卡模式：0-默认模式，1-时间段打卡模式
    /// </summary>
    public byte CheckinMode { get; set; }

    /// <summary>
    /// 计划标题。
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// 计划描述，可为空。
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// 计划开始日期。
    /// </summary>
    public DateOnly StartDate { get; set; }

    /// <summary>
    /// 计划结束日期，可为空。
    /// </summary>
    public DateOnly? EndDate { get; set; }

    /// <summary>
    /// 是否处于启用状态。
    /// </summary>
    public bool? IsActive { get; set; }

    /// <summary>
    /// 打卡时间段列表
    /// </summary>
    public List<TimeSlotDto> TimeSlots { get; set; } = new();
}

/// <summary>
/// 打卡时间段数据传输对象
/// </summary>
public class TimeSlotDto
{
    /// <summary>
    /// 时间段ID（创建时为空，更新时必填）
    /// </summary>
    public ulong? Id { get; set; }

    /// <summary>
    /// 时间段名称，如“早晨”
    /// </summary>
    public string? SlotName { get; set; }

    /// <summary>
    /// 开始时间（HH:mm:ss）
    /// </summary>
    public TimeOnly StartTime { get; set; }

    /// <summary>
    /// 结束时间（HH:mm:ss）
    /// </summary>
    public TimeOnly EndTime { get; set; }

    /// <summary>
    /// 排序序号
    /// </summary>
    public ushort OrderNum { get; set; }

    /// <summary>
    /// 是否启用
    /// </summary>
    public bool IsActive { get; set; } = true;
}
