using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using api.Data;
using api.Infrastructure;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace api.Controllers;

/// <summary>
/// 课表接口（Schedule / Course / CourseTime 三层模型）。
///
/// 数据来源：原「MeowMemoirs 课表项目」的 Schedule + Course + CourseTime 结构，
/// 已迁移进当前后端（表：schedules / courses / course_times）。
///
/// 权限：所有接口都需要登录（JWT），并且只能操作当前用户自己的课表。
/// 删除：全部使用 is_deleted 伪删除，查询时过滤。
/// </summary>
[ApiController]
[Route("mm/[controller]")]
[Authorize]
public class ScheduleController(DailyCheckDbContext db) : ControllerBase
{
    readonly DailyCheckDbContext _db = db;

    static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);
    static readonly Regex TimeRangeRegex = new(@"^\d{1,2}:\d{2}-\d{1,2}:\d{2}$", RegexOptions.Compiled);
    static readonly Regex ColorRegex = new(@"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", RegexOptions.Compiled);

    const int MaxWeekCount = 100;
    const int MaxSections = 30;

    /// <summary>
    /// 获取当前用户的课表列表（概要，不含课程明细）。
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<ScheduleSummaryDto>>> GetMySchedules()
    {
        var userId = GetUserId();
        var schedules = await _db.Schedules
            .Where(s => s.UserId == userId && !s.IsDeleted)
            .OrderBy(s => s.Id)
            .ToListAsync();

        var ids = schedules.Select(s => s.Id).ToList();
        var courseCounts = ids.Count == 0
            ? new Dictionary<ulong, int>()
            : await _db.Courses
                .Where(c => ids.Contains(c.ScheduleId) && !c.IsDeleted)
                .GroupBy(c => c.ScheduleId)
                .Select(g => new { ScheduleId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.ScheduleId, x => x.Count);

        return Ok(schedules.Select(s => ToSummary(s, courseCounts.GetValueOrDefault(s.Id))).ToList());
    }

    /// <summary>
    /// 获取课表详情：课表信息 + 课程列表 + 每门课的上课时间段。
    /// </summary>
    [HttpGet("{id:ulong}")]
    public async Task<ActionResult<ScheduleDetailDto>> GetSchedule(ulong id)
    {
        var detail = await BuildDetailAsync(GetUserId(), id);
        return detail == null ? NotFound(new { message = "未找到课表" }) : Ok(detail);
    }

    /// <summary>
    /// 新建或更新课表（id = 0 表示新建）。
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<ScheduleDetailDto>> SaveSchedule([FromBody] ScheduleEditDto dto)
    {
        var userId = GetUserId();

        var name = (dto.ScheduleName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(name))
            return BadRequest(new { message = "课表名称不能为空" });
        if (name.Length > 100)
            return BadRequest(new { message = "课表名称不能超过 100 个字符" });

        if (!DateOnly.TryParseExact((dto.StartTime ?? string.Empty).Trim(), "yyyy-MM-dd",
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var startDate))
            return BadRequest(new { message = "开课日期格式应为 yyyy-MM-dd" });

        if (dto.WeekCount < 1 || dto.WeekCount > MaxWeekCount)
            return BadRequest(new { message = $"学期周数需在 1-{MaxWeekCount} 之间" });

        var timetable = NormalizeTimetable(dto.Timetable);
        if (timetable == null)
            return BadRequest(new { message = "作息时间不能为空，且每节格式应为 HH:mm-HH:mm" });

        Schedule schedule;
        if (dto.Id > 0)
        {
            var existing = await _db.Schedules
                .FirstOrDefaultAsync(s => s.Id == dto.Id && s.UserId == userId && !s.IsDeleted);
            if (existing == null) return NotFound(new { message = "未找到课表" });
            schedule = existing;
        }
        else
        {
            schedule = new Schedule { UserId = userId, CreatedAt = DateTime.UtcNow };
            _db.Schedules.Add(schedule);
        }

        var now = DateTime.UtcNow;
        schedule.ScheduleName = name;
        schedule.StartTime = startDate;
        schedule.WeekCount = dto.WeekCount;
        schedule.TimetableJson = JsonSerializer.Serialize(timetable, JsonOpts);
        schedule.Remark = TrimOrNull(dto.Remark);
        schedule.UpdatedAt = now;
        schedule.IsDeleted = false;

        await _db.SaveChangesAsync();

        var detail = await BuildDetailAsync(userId, schedule.Id);
        return detail == null ? NotFound(new { message = "未找到课表" }) : Ok(detail);
    }

    /// <summary>
    /// 从 Excel 导入课表：解析文件 → 新建一张课表 + 课程 + 时间段，返回课表详情。
    ///
    /// 支持 .xlsx / .xls；解析规则与前端 demo 一致（自动识别通用横排 / 教务系统竖排、
    /// 合并单元格、一格多课、周次等）。缺少的信息用默认值补齐（作息时间 12 节、周数 20）。
    /// </summary>
    /// <param name="file">课表 Excel（.xlsx / .xls）</param>
    /// <param name="scheduleName">课表名称，不传则取文件里的标题或文件名</param>
    /// <param name="startTime">开课日期 yyyy-MM-dd，不传则取文件里的学期或本周一</param>
    /// <param name="weekCount">学期周数，不传则按文件里的最大周次（至少 20）</param>
    [HttpPost("Import")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<ScheduleDetailDto>> ImportSchedule(
        IFormFile? file,
        [FromForm] string? scheduleName,
        [FromForm] string? startTime,
        [FromForm] int? weekCount)
    {
        var userId = GetUserId();
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "请选择要导入的 Excel 文件" });

        var extension = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
        if (extension is not (".xlsx" or ".xls"))
            return BadRequest(new { message = "仅支持 .xlsx / .xls 文件（.csv 请先用 Excel 另存为 xlsx）" });
        if (file.Length > 10 * 1024 * 1024)
            return BadRequest(new { message = "文件不能超过 10MB" });

        ParsedTimetable parsed;
        try
        {
            using var memory = new MemoryStream();
            await using (var input = file.OpenReadStream())
            {
                await input.CopyToAsync(memory);
            }
            memory.Position = 0;
            parsed = TimetableExcelParser.Parse(memory);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = $"解析失败：{ex.Message}" });
        }

        if (parsed.Slots.Count == 0)
            return BadRequest(new { message = "没有从文件里识别到课程，请检查这张表是不是课表" });

        var name = (scheduleName ?? string.Empty).Trim();
        if (name.Length == 0) name = (parsed.Title ?? string.Empty).Trim();
        if (name.Length == 0) name = Path.GetFileNameWithoutExtension(file.FileName);
        if (name.Length == 0) name = "导入的课表";
        if (name.Length > 100) name = name[..100];

        DateOnly startDate;
        if (!string.IsNullOrWhiteSpace(startTime))
        {
            if (!DateOnly.TryParseExact(startTime.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out startDate))
                return BadRequest(new { message = "开课日期格式应为 yyyy-MM-dd" });
        }
        else
        {
            startDate = parsed.SuggestedStartDate ?? ThisMonday();
        }

        var maxWeekInFile = parsed.Slots
            .Select(s => TimetableExcelParser.ParseWeekList(s.Weeks) is { Count: > 0 } list ? list.Max() : 0)
            .DefaultIfEmpty(0)
            .Max();

        var weeks = weekCount ?? Math.Max(20, maxWeekInFile);
        if (weeks < 1 || weeks > MaxWeekCount)
            return BadRequest(new { message = $"学期周数需在 1-{MaxWeekCount} 之间" });
        if (weeks < maxWeekInFile) weeks = maxWeekInFile;

        var sectionCount = Math.Clamp(parsed.MaxSection, 1, MaxSections);
        var timetable = TimetableExcelParser.DefaultTimetable(sectionCount);

        var now = DateTime.UtcNow;
        await using var transaction = await _db.Database.BeginTransactionAsync();

        var schedule = new Schedule
        {
            UserId = userId,
            ScheduleName = name,
            StartTime = startDate,
            WeekCount = weeks,
            TimetableJson = JsonSerializer.Serialize(timetable, JsonOpts),
            UpdatedAt = now,
            CreatedAt = now,
            IsDeleted = false,
        };
        _db.Schedules.Add(schedule);
        await _db.SaveChangesAsync();

        var palette = new[]
        {
            "#9b4f93", "#4f9b93", "#9b6b4f", "#4f6b9b", "#7a4f9b",
            "#9b4f5a", "#4f9b6b", "#8f9b4f", "#4f8a9b", "#9b874f",
        };
        var allWeeks = Enumerable.Range(1, weeks).ToList();
        var courseIndex = 0;

        foreach (var group in parsed.Slots.GroupBy(s => s.Course.Trim()))
        {
            var course = new Course
            {
                ScheduleId = schedule.Id,
                CourseName = group.Key.Length > 100 ? group.Key[..100] : group.Key,
                Color = palette[courseIndex++ % palette.Length],
                UpdatedAt = now,
                CreatedAt = now,
                IsDeleted = false,
            };
            _db.Courses.Add(course);
            await _db.SaveChangesAsync();

            foreach (var slot in group)
            {
                var sections = Enumerable.Range(slot.PeriodStart, slot.PeriodEnd - slot.PeriodStart + 1)
                    .Where(v => v >= 1 && v <= MaxSections)
                    .Distinct()
                    .OrderBy(v => v)
                    .ToList();
                if (sections.Count == 0) continue;

                var weekList = TimetableExcelParser.ParseWeekList(slot.Weeks);
                weekList = weekList is { Count: > 0 }
                    ? weekList.Where(w => w >= 1 && w <= weeks).Distinct().OrderBy(w => w).ToList()
                    : allWeeks;
                if (weekList.Count == 0) weekList = allWeeks;

                _db.CourseTimes.Add(new CourseTime
                {
                    CourseId = course.Id,
                    Location = (slot.Location ?? string.Empty).Trim(),
                    Teacher = (slot.Teacher ?? string.Empty).Trim(),
                    WeekListJson = JsonSerializer.Serialize(weekList, JsonOpts),
                    SectionListJson = JsonSerializer.Serialize(sections, JsonOpts),
                    DayOfWeek = Math.Clamp(slot.DayOfWeek, 1, 7),
                    UpdatedAt = now,
                    CreatedAt = now,
                    IsDeleted = false,
                });
            }
        }

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        var detail = await BuildDetailAsync(userId, schedule.Id);
        return detail is null ? NotFound(new { message = "导入后读取课表失败" }) : Ok(detail);
    }

    static DateOnly ThisMonday()
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        var offset = ((int)today.DayOfWeek + 6) % 7;
        return today.AddDays(-offset);
    }

    /// <summary>
    /// 删除课表（伪删除，同时伪删除其下课程与时间段）。
    /// </summary>
    [HttpDelete("{id:ulong}")]
    public async Task<IActionResult> DeleteSchedule(ulong id)
    {
        var userId = GetUserId();
        var schedule = await _db.Schedules
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId && !s.IsDeleted);
        if (schedule == null) return NotFound(new { message = "未找到课表" });

        var now = DateTime.UtcNow;
        schedule.IsDeleted = true;
        schedule.UpdatedAt = now;

        var courses = await _db.Courses.Where(c => c.ScheduleId == id).ToListAsync();
        var courseIds = courses.Select(c => c.Id).ToList();
        var times = courseIds.Count == 0
            ? new List<CourseTime>()
            : await _db.CourseTimes.Where(t => courseIds.Contains(t.CourseId)).ToListAsync();

        foreach (var course in courses)
        {
            course.IsDeleted = true;
            course.UpdatedAt = now;
        }
        foreach (var time in times)
        {
            time.IsDeleted = true;
            time.UpdatedAt = now;
        }

        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// 获取某门课程的详情（含全部时间段）。
    /// </summary>
    [HttpGet("{id:ulong}/Course/{courseId:ulong}")]
    public async Task<ActionResult<CourseDto>> GetCourse(ulong id, ulong courseId)
    {
        var userId = GetUserId();
        var scheduleOk = await _db.Schedules
            .AnyAsync(s => s.Id == id && s.UserId == userId && !s.IsDeleted);
        if (!scheduleOk) return NotFound(new { message = "未找到课表" });

        var course = await _db.Courses
            .FirstOrDefaultAsync(c => c.Id == courseId && c.ScheduleId == id && !c.IsDeleted);
        if (course == null) return NotFound(new { message = "未找到课程" });

        var times = await _db.CourseTimes
            .Where(t => t.CourseId == course.Id && !t.IsDeleted)
            .OrderBy(t => t.Id)
            .ToListAsync();

        return Ok(ToCourseDto(course, times));
    }

    /// <summary>
    /// 新建或更新课程（id = 0 表示新建；times 会整体替换，未出现的旧时间段会被伪删除）。
    /// </summary>
    [HttpPost("{id:ulong}/Course")]
    public async Task<ActionResult<CourseDto>> SaveCourse(ulong id, [FromBody] CourseEditDto dto)
    {
        var userId = GetUserId();
        var schedule = await _db.Schedules
            .FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId && !s.IsDeleted);
        if (schedule == null) return NotFound(new { message = "未找到课表" });

        var name = (dto.CourseName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(name))
            return BadRequest(new { message = "课程名称不能为空" });
        if (name.Length > 100)
            return BadRequest(new { message = "课程名称不能超过 100 个字符" });

        var color = string.IsNullOrWhiteSpace(dto.Color) ? "#9b4f93" : dto.Color!.Trim();
        if (!ColorRegex.IsMatch(color))
            return BadRequest(new { message = "课程颜色格式应为 #RGB 或 #RRGGBB" });

        var times = dto.Times ?? new List<CourseTimeEditDto>();
        if (times.Count == 0)
            return BadRequest(new { message = "至少需要一个上课时间段" });

        var now = DateTime.UtcNow;
        Course course;
        if (dto.Id > 0)
        {
            var existing = await _db.Courses
                .FirstOrDefaultAsync(c => c.Id == dto.Id && c.ScheduleId == id && !c.IsDeleted);
            if (existing == null) return NotFound(new { message = "未找到课程" });
            course = existing;
        }
        else
        {
            course = new Course { ScheduleId = id, CreatedAt = now };
            _db.Courses.Add(course);
        }

        course.CourseName = name;
        course.Color = color;
        course.Remark = TrimOrNull(dto.Remark);
        course.UpdatedAt = now;
        course.IsDeleted = false;

        // 先保存拿到课程 ID（新建时）
        await _db.SaveChangesAsync();

        var existingTimes = await _db.CourseTimes.Where(t => t.CourseId == course.Id).ToListAsync();
        var touched = new HashSet<CourseTime>();

        foreach (var item in times)
        {
            var location = (item.Location ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(location))
                return BadRequest(new { message = "上课地点不能为空" });
            if (location.Length > 255)
                return BadRequest(new { message = "上课地点不能超过 255 个字符" });

            var teacher = (item.Teacher ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(teacher))
                return BadRequest(new { message = "任课教师不能为空" });
            if (teacher.Length > 100)
                return BadRequest(new { message = "任课教师不能超过 100 个字符" });

            if (item.DayOfWeek < 1 || item.DayOfWeek > 7)
                return BadRequest(new { message = "星期几需在 1-7 之间" });

            var weeks = (item.WeekList ?? new List<int>())
                .Where(v => v >= 1).Distinct().OrderBy(v => v).ToList();
            if (weeks.Count == 0)
                return BadRequest(new { message = "周次不能为空" });
            if (weeks.Any(v => v > schedule.WeekCount))
                return BadRequest(new { message = $"周次不能超过课表总周数（{schedule.WeekCount}）" });

            var sections = (item.SectionList ?? new List<int>())
                .Where(v => v >= 1).Distinct().OrderBy(v => v).ToList();
            if (sections.Count == 0)
                return BadRequest(new { message = "节次不能为空" });
            if (sections.Any(v => v > MaxSections))
                return BadRequest(new { message = $"节次不能超过 {MaxSections}" });

            CourseTime time;
            if (item.Id > 0)
            {
                var existingTime = existingTimes.FirstOrDefault(t => t.Id == item.Id && !t.IsDeleted);
                if (existingTime == null) return BadRequest(new { message = "时间段不存在或已被删除" });
                time = existingTime;
            }
            else
            {
                time = new CourseTime { CourseId = course.Id, CreatedAt = now };
                _db.CourseTimes.Add(time);
            }

            time.Location = location;
            time.Teacher = teacher;
            time.WeekListJson = JsonSerializer.Serialize(weeks, JsonOpts);
            time.SectionListJson = JsonSerializer.Serialize(sections, JsonOpts);
            time.DayOfWeek = item.DayOfWeek;
            time.Remark = TrimOrNull(item.Remark);
            time.UpdatedAt = now;
            time.IsDeleted = false;
            touched.Add(time);
        }

        foreach (var old in existingTimes.Where(t => !t.IsDeleted && !touched.Contains(t)))
        {
            old.IsDeleted = true;
            old.UpdatedAt = now;
        }

        await _db.SaveChangesAsync();

        var savedTimes = await _db.CourseTimes
            .Where(t => t.CourseId == course.Id && !t.IsDeleted)
            .OrderBy(t => t.Id)
            .ToListAsync();
        return Ok(ToCourseDto(course, savedTimes));
    }

    /// <summary>
    /// 删除课程（伪删除，同时伪删除其下时间段）。
    /// </summary>
    [HttpDelete("{id:ulong}/Course/{courseId:ulong}")]
    public async Task<IActionResult> DeleteCourse(ulong id, ulong courseId)
    {
        var userId = GetUserId();
        var scheduleOk = await _db.Schedules
            .AnyAsync(s => s.Id == id && s.UserId == userId && !s.IsDeleted);
        if (!scheduleOk) return NotFound(new { message = "未找到课表" });

        var course = await _db.Courses
            .FirstOrDefaultAsync(c => c.Id == courseId && c.ScheduleId == id && !c.IsDeleted);
        if (course == null) return NotFound(new { message = "未找到课程" });

        var now = DateTime.UtcNow;
        course.IsDeleted = true;
        course.UpdatedAt = now;

        var times = await _db.CourseTimes.Where(t => t.CourseId == course.Id).ToListAsync();
        foreach (var time in times)
        {
            time.IsDeleted = true;
            time.UpdatedAt = now;
        }

        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ---------------- 内部工具 ----------------

    async Task<ScheduleDetailDto?> BuildDetailAsync(ulong userId, ulong scheduleId)
    {
        var schedule = await _db.Schedules
            .FirstOrDefaultAsync(s => s.Id == scheduleId && s.UserId == userId && !s.IsDeleted);
        if (schedule == null) return null;

        var courses = await _db.Courses
            .Where(c => c.ScheduleId == schedule.Id && !c.IsDeleted)
            .OrderBy(c => c.Id)
            .ToListAsync();

        var courseIds = courses.Select(c => c.Id).ToList();
        var times = courseIds.Count == 0
            ? new List<CourseTime>()
            : await _db.CourseTimes
                .Where(t => courseIds.Contains(t.CourseId) && !t.IsDeleted)
                .OrderBy(t => t.Id)
                .ToListAsync();
        var timeMap = times.ToLookup(t => t.CourseId);

        var detail = new ScheduleDetailDto
        {
            Id = schedule.Id,
            ScheduleName = schedule.ScheduleName,
            StartTime = schedule.StartTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            WeekCount = schedule.WeekCount,
            Timetable = ParseStringArray(schedule.TimetableJson),
            Remark = schedule.Remark,
            CourseCount = courses.Count,
            CreatedAt = schedule.CreatedAt,
            UpdatedAt = schedule.UpdatedAt,
            Courses = courses.Select(c => ToCourseDto(c, timeMap[c.Id].ToList())).ToList(),
        };
        return detail;
    }

    static ScheduleSummaryDto ToSummary(Schedule schedule, int courseCount) => new()
    {
        Id = schedule.Id,
        ScheduleName = schedule.ScheduleName,
        StartTime = schedule.StartTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        WeekCount = schedule.WeekCount,
        Timetable = ParseStringArray(schedule.TimetableJson),
        Remark = schedule.Remark,
        CourseCount = courseCount,
        CreatedAt = schedule.CreatedAt,
        UpdatedAt = schedule.UpdatedAt,
    };

    static CourseDto ToCourseDto(Course course, List<CourseTime> times) => new()
    {
        Id = course.Id,
        ScheduleId = course.ScheduleId,
        CourseName = course.CourseName,
        Color = course.Color,
        Remark = course.Remark,
        Times = times.Select(ToTimeDto).ToList(),
    };

    static CourseTimeDto ToTimeDto(CourseTime time) => new()
    {
        Id = time.Id,
        CourseId = time.CourseId,
        Location = time.Location,
        Teacher = time.Teacher,
        WeekList = ParseIntArray(time.WeekListJson),
        SectionList = ParseIntArray(time.SectionListJson),
        DayOfWeek = time.DayOfWeek,
        Remark = time.Remark,
    };

    /// <summary>校验并规范化作息时间表；格式不合法返回 null。</summary>
    static List<string>? NormalizeTimetable(List<string>? timetable)
    {
        if (timetable == null || timetable.Count == 0 || timetable.Count > MaxSections) return null;
        var result = new List<string>(timetable.Count);
        foreach (var raw in timetable)
        {
            var item = (raw ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(item) || !TimeRangeRegex.IsMatch(item)) return null;
            result.Add(item);
        }
        return result;
    }

    static List<string> ParseStringArray(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<string>();
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json, JsonOpts) ?? new List<string>();
        }
        catch (JsonException)
        {
            return new List<string>();
        }
    }

    static List<int> ParseIntArray(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<int>();
        try
        {
            return JsonSerializer.Deserialize<List<int>>(json, JsonOpts) ?? new List<int>();
        }
        catch (JsonException)
        {
            return new List<int>();
        }
    }

    static string? TrimOrNull(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return value.Trim();
    }

    ulong GetUserId()
    {
        var idClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var subClaim = User.FindFirstValue("sub");
        var value = idClaim ?? subClaim;
        return value == null ? throw new InvalidOperationException("User id not found in token") : ulong.Parse(value);
    }
}
