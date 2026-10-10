using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 打卡计划时间段配置表（每日重复）
/// </summary>
public partial class CheckinPlanTimeSlot
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 所属打卡计划ID
    /// </summary>
    public ulong PlanId { get; set; }

    /// <summary>
    /// 时间段名称，如“早晨”、“下午”
    /// </summary>
    public string? SlotName { get; set; }

    /// <summary>
    /// 开始时间（如 09:00:00）
    /// </summary>
    public TimeOnly StartTime { get; set; }

    /// <summary>
    /// 结束时间（如 10:00:00）
    /// </summary>
    public TimeOnly EndTime { get; set; }

    /// <summary>
    /// 排序序号，用于界面展示顺序
    /// </summary>
    public ushort OrderNum { get; set; }

    /// <summary>
    /// 是否启用：1启用，0停用
    /// </summary>
    public bool? IsActive { get; set; }

    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<Checkin> Checkins { get; set; } = new List<Checkin>();

    public virtual CheckinPlan Plan { get; set; } = null!;
}
