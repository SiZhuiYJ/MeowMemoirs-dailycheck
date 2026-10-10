using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 打卡记录表
/// </summary>
public partial class Checkin
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
    /// 关联的打卡时间段ID
    /// </summary>
    public ulong? TimeSlotId { get; set; }

    /// <summary>
    /// 打卡用户ID
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 打卡日期（仅日期）
    /// </summary>
    public DateOnly CheckDate { get; set; }

    /// <summary>
    /// 打卡图片URL数组(JSON)
    /// </summary>
    public string? Images { get; set; }

    /// <summary>
    /// 打卡备注
    /// </summary>
    public string? Note { get; set; }

    /// <summary>
    /// 打卡状态：0错过(红)、1成功(绿)、2补签(黄)
    /// </summary>
    public sbyte Status { get; set; }

    /// <summary>
    /// 是否伪删除：0正常，1已删除
    /// </summary>
    public bool IsDeleted { get; set; }

    /// <summary>
    /// 伪删除时间
    /// </summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>
    /// 创建时间
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新时间
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Normalized time_slot_id for uniqueness
    /// </summary>
    public ulong? TimeSlotIdKey { get; set; }

    public virtual CheckinPlan Plan { get; set; } = null!;

    public virtual CheckinPlanTimeSlot? TimeSlot { get; set; }

    public virtual User User { get; set; } = null!;
}
