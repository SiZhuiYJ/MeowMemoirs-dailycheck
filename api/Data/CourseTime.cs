using System;

namespace api.Data;

/// <summary>
/// 课程时间段（一门课可以有多段：不同周次/星期/节次/地点）。
/// </summary>
public partial class CourseTime
{
    /// <summary>主键 ID</summary>
    public ulong Id { get; set; }

    /// <summary>所属课程 ID</summary>
    public ulong CourseId { get; set; }

    /// <summary>上课地点</summary>
    public string Location { get; set; } = null!;

    /// <summary>任课教师</summary>
    public string Teacher { get; set; } = null!;

    /// <summary>周次列表（JSON 数组字符串，如 [1,2,3]）</summary>
    public string WeekListJson { get; set; } = null!;

    /// <summary>节次列表（JSON 数组字符串，如 [1,2]）</summary>
    public string SectionListJson { get; set; } = null!;

    /// <summary>星期几：1-7（周一到周日）</summary>
    public int DayOfWeek { get; set; }

    /// <summary>备注</summary>
    public string? Remark { get; set; }

    /// <summary>是否伪删除：0正常，1已删除</summary>
    public bool IsDeleted { get; set; }

    /// <summary>创建时间</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>更新时间</summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>所属课程（导航属性）</summary>
    public Course? Course { get; set; }
}
