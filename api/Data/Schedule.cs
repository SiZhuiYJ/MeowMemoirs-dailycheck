using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 课表（一个用户可以有多个学期间的课表）。
/// </summary>
public partial class Schedule
{
    /// <summary>主键 ID</summary>
    public ulong Id { get; set; }

    /// <summary>所属用户 ID</summary>
    public ulong UserId { get; set; }

    /// <summary>课表名称（如：2026 春季学期）</summary>
    public string ScheduleName { get; set; } = null!;

    /// <summary>开课日期（学期第一周的周一）</summary>
    public DateOnly StartTime { get; set; }

    /// <summary>学期总周数</summary>
    public int WeekCount { get; set; }

    /// <summary>作息时间表（JSON 数组字符串，如 ["08:00-08:45","08:55-09:40"]）</summary>
    public string TimetableJson { get; set; } = null!;

    /// <summary>备注</summary>
    public string? Remark { get; set; }

    /// <summary>是否伪删除：0正常，1已删除</summary>
    public bool IsDeleted { get; set; }

    /// <summary>创建时间</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>更新时间</summary>
    public DateTime UpdatedAt { get; set; }

    public ICollection<Course> Courses { get; set; } = new List<Course>();
}
