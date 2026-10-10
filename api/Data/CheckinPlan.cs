using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 打卡计划表
/// </summary>
public partial class CheckinPlan
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 计划所属用户ID
    /// </summary>
    public ulong UserId { get; set; }

    /// <summary>
    /// 打卡计划标题
    /// </summary>
    public string Title { get; set; } = null!;

    /// <summary>
    /// 打卡计划描述
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// 计划开始日期
    /// </summary>
    public DateOnly StartDate { get; set; }

    /// <summary>
    /// 计划结束日期（可选）
    /// </summary>
    public DateOnly? EndDate { get; set; }

    /// <summary>
    /// 是否启用：1启用，0停用
    /// </summary>
    public bool? IsActive { get; set; }

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
    /// 打卡模式：0-默认模式，1-时间段打卡模式
    /// </summary>
    public byte CheckinMode { get; set; }

    public virtual ICollection<CheckinPlanTimeSlot> CheckinPlanTimeSlots { get; set; } = new List<CheckinPlanTimeSlot>();

    public virtual ICollection<Checkin> Checkins { get; set; } = new List<Checkin>();

    public virtual User User { get; set; } = null!;
}
