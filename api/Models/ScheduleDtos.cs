using System;
using System.Collections.Generic;

namespace api.Models;

/// <summary>
/// 课表概要（列表页使用）。
/// </summary>
public class ScheduleSummaryDto
{
    /// <summary>课表 ID</summary>
    public ulong Id { get; set; }

    /// <summary>课表名称</summary>
    public string ScheduleName { get; set; } = string.Empty;

    /// <summary>开课日期（yyyy-MM-dd）</summary>
    public string StartTime { get; set; } = string.Empty;

    /// <summary>学期总周数</summary>
    public int WeekCount { get; set; }

    /// <summary>作息时间表（每个元素是一节课的时间段，如 "08:00-08:45"）</summary>
    public List<string> Timetable { get; set; } = new();

    /// <summary>备注</summary>
    public string? Remark { get; set; }

    /// <summary>课程数量</summary>
    public int CourseCount { get; set; }

    /// <summary>创建时间</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>更新时间</summary>
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// 课表详情（含课程与上课时间段，课表页/小程序课表页使用）。
/// </summary>
public class ScheduleDetailDto : ScheduleSummaryDto
{
    /// <summary>课程列表</summary>
    public List<CourseDto> Courses { get; set; } = new();
}

/// <summary>
/// 课程。
/// </summary>
public class CourseDto
{
    /// <summary>课程 ID</summary>
    public ulong Id { get; set; }

    /// <summary>所属课表 ID</summary>
    public ulong ScheduleId { get; set; }

    /// <summary>课程名称</summary>
    public string CourseName { get; set; } = string.Empty;

    /// <summary>课程颜色（十六进制）</summary>
    public string Color { get; set; } = string.Empty;

    /// <summary>备注</summary>
    public string? Remark { get; set; }

    /// <summary>上课时间段</summary>
    public List<CourseTimeDto> Times { get; set; } = new();
}

/// <summary>
/// 课程时间段。
/// </summary>
public class CourseTimeDto
{
    /// <summary>时间段 ID</summary>
    public ulong Id { get; set; }

    /// <summary>所属课程 ID</summary>
    public ulong CourseId { get; set; }

    /// <summary>上课地点</summary>
    public string Location { get; set; } = string.Empty;

    /// <summary>任课教师</summary>
    public string Teacher { get; set; } = string.Empty;

    /// <summary>周次（如 [1,2,3]）</summary>
    public List<int> WeekList { get; set; } = new();

    /// <summary>节次（如 [1,2]）</summary>
    public List<int> SectionList { get; set; } = new();

    /// <summary>星期几：1-7（周一到周日）</summary>
    public int DayOfWeek { get; set; }

    /// <summary>备注</summary>
    public string? Remark { get; set; }
}

/// <summary>
/// 新建 / 编辑课表请求。
/// </summary>
public class ScheduleEditDto
{
    /// <summary>课表 ID（0 或省略表示新建）</summary>
    public ulong Id { get; set; }

    /// <summary>课表名称</summary>
    public string ScheduleName { get; set; } = string.Empty;

    /// <summary>开课日期（yyyy-MM-dd）</summary>
    public string StartTime { get; set; } = string.Empty;

    /// <summary>学期总周数</summary>
    public int WeekCount { get; set; } = 20;

    /// <summary>作息时间表（每节课的时间段）</summary>
    public List<string> Timetable { get; set; } = new();

    /// <summary>备注</summary>
    public string? Remark { get; set; }
}

/// <summary>
/// 新建 / 编辑课程请求（包含该课程的全部上课时间段）。
/// </summary>
public class CourseEditDto
{
    /// <summary>课程 ID（0 或省略表示新建）</summary>
    public ulong Id { get; set; }

    /// <summary>课程名称</summary>
    public string CourseName { get; set; } = string.Empty;

    /// <summary>课程颜色（十六进制，如 #9b4f93）</summary>
    public string Color { get; set; } = "#9b4f93";

    /// <summary>备注</summary>
    public string? Remark { get; set; }

    /// <summary>上课时间段（至少一条）</summary>
    public List<CourseTimeEditDto> Times { get; set; } = new();
}

/// <summary>
/// 新建 / 编辑课程时间段请求。
/// </summary>
public class CourseTimeEditDto
{
    /// <summary>时间段 ID（0 或省略表示新增）</summary>
    public ulong Id { get; set; }

    /// <summary>上课地点</summary>
    public string Location { get; set; } = string.Empty;

    /// <summary>任课教师</summary>
    public string Teacher { get; set; } = string.Empty;

    /// <summary>周次列表</summary>
    public List<int> WeekList { get; set; } = new();

    /// <summary>节次列表</summary>
    public List<int> SectionList { get; set; } = new();

    /// <summary>星期几：1-7</summary>
    public int DayOfWeek { get; set; }

    /// <summary>备注</summary>
    public string? Remark { get; set; }
}

/// <summary>
/// 导入预检结果（不写库）：前端展示给用户确认「识别对不对」。
/// </summary>
public class ScheduleImportPreviewDto
{
    /// <summary>默认课表名称（用户可改）</summary>
    public string ScheduleName { get; set; } = string.Empty;

    /// <summary>从文件里识别到的学期（可能为空）</summary>
    public string? SemesterLabel { get; set; }

    /// <summary>开课日期（yyyy-MM-dd）</summary>
    public string StartTime { get; set; } = string.Empty;

    /// <summary>学期总周数</summary>
    public int WeekCount { get; set; }

    /// <summary>节次数</summary>
    public int SectionCount { get; set; }

    /// <summary>作息时间表</summary>
    public List<string> Timetable { get; set; } = new();

    /// <summary>课程数</summary>
    public int CourseCount => Courses.Count;

    /// <summary>上课时间段总数</summary>
    public int TimeCount { get; set; }

    /// <summary>课程列表（ID 均为 0，因为还没入库）</summary>
    public List<CourseDto> Courses { get; set; } = new();

    /// <summary>需要注意/确认的提示（缺教师、缺地点、周次缺失、默认日期等）</summary>
    public List<string> Warnings { get; set; } = new();

    /// <summary>预检出来的时间冲突（同一天 + 节次重叠 + 周次有交集）</summary>
    public List<string> Conflicts { get; set; } = new();
}

/// <summary>
/// 按预检结果正式保存课表（OCR / 图片流程用）。
/// 前端把预检返回的 courses 原样传回来，服务端校验后入库。
/// </summary>
public class ScheduleImportConfirmDto
{
    /// <summary>课表名称</summary>
    public string ScheduleName { get; set; } = string.Empty;

    /// <summary>开课日期（yyyy-MM-dd，可选）</summary>
    public string? StartTime { get; set; }

    /// <summary>学期周数（可选，默认 20）</summary>
    public int? WeekCount { get; set; }

    /// <summary>作息时间表（可选；不传则按节次数生成默认值）</summary>
    public List<string>? Timetable { get; set; }

    /// <summary>课程列表（结构与预检返回的 courses 一致）</summary>
    public List<CourseDto> Courses { get; set; } = new();
}
