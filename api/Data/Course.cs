using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 课程（课表下的一门课，具体上课时间在 course_times 表里，可有多段）。
/// </summary>
public partial class Course
{
    /// <summary>主键 ID</summary>
    public ulong Id { get; set; }

    /// <summary>所属课表 ID</summary>
    public ulong ScheduleId { get; set; }

    /// <summary>课程名称</summary>
    public string CourseName { get; set; } = null!;

    /// <summary>课程颜色（十六进制，如 #9b4f93）</summary>
    public string Color { get; set; } = null!;

    /// <summary>备注</summary>
    public string? Remark { get; set; }

    /// <summary>是否伪删除：0正常，1已删除</summary>
    public bool IsDeleted { get; set; }

    /// <summary>创建时间</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>更新时间</summary>
    public DateTime UpdatedAt { get; set; }

    public ICollection<CourseTime> CourseTimes { get; set; } = new List<CourseTime>();

    /// <summary>所属课表（导航属性）</summary>
    public Schedule? Schedule { get; set; }
}
