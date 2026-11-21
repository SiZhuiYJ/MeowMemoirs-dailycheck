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
    static readonly Regex TimeRangeRegex = new(@"^([01]?\d|2[0-3]):([0-5]\d)-([01]?\d|2[0-3]):([0-5]\d)$", RegexOptions.Compiled);
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

    const int MaxOcrFileBytes = 30 * 1024 * 1024;
    static readonly string[] OcrExtensions = { ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp" };

    /// <summary>
    /// 导入预检（Excel）：只解析文件并返回预览，不写数据库。
    /// 前端先拿这个结果让用户确认识别有没有问题，确认后再调 <see cref="ImportSchedule"/> 正式保存。
    /// </summary>
    /// <param name="file">课表 Excel（.xlsx / .xls）</param>
    /// <param name="scheduleName">课表名称（可选，不传则取文件内标题或文件名）</param>
    /// <param name="startTime">开课日期 yyyy-MM-dd（可选）</param>
    /// <param name="weekCount">学期周数（可选）</param>
    [HttpPost("Import/Preview")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<ScheduleImportPreviewDto>> PreviewImport(
        IFormFile? file,
        [FromForm] string? scheduleName,
        [FromForm] string? startTime,
        [FromForm] int? weekCount)
    {
        var (plan, error) = await BuildExcelImportPlanAsync(file, scheduleName, startTime, weekCount);
        if (plan is null) return BadRequest(new { message = error });
        return Ok(ToPreview(plan));
    }

    /// <summary>
    /// 导入预检（图片 / PDF 兜底 OCR）：识别截图里的课表并返回预览，不写数据库。
    /// 需要服务器安装 poppler / tesseract（含 chi_sim 语言包），见 TimetableOcr 注释。
    /// </summary>
    /// <param name="file">课表截图或 PDF（.pdf/.png/.jpg/.jpeg/.webp/.bmp）</param>
    /// <param name="scheduleName">课表名称（可选）</param>
    /// <param name="startTime">开课日期 yyyy-MM-dd（可选）</param>
    /// <param name="weekCount">学期周数（可选）</param>
    [HttpPost("Import/Ocr/Preview")]
    [RequestSizeLimit(MaxOcrFileBytes)]
    public async Task<ActionResult<ScheduleImportPreviewDto>> PreviewOcrImport(
        IFormFile? file,
        [FromForm] string? scheduleName,
        [FromForm] string? startTime,
        [FromForm] int? weekCount)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "请选择课表截图或 PDF" });

        var extension = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
        if (!OcrExtensions.Contains(extension))
            return BadRequest(new { message = "仅支持 PDF / PNG / JPG / JPEG / WEBP / BMP" });
        if (file.Length > MaxOcrFileBytes)
            return BadRequest(new { message = "文件不能超过 30MB" });

        var temp = Path.Combine(Path.GetTempPath(),
            "timetable-ocr-upload-" + Guid.NewGuid().ToString("N") + extension);
        try
        {
            await using (var stream = System.IO.File.Create(temp))
            {
                await file.CopyToAsync(stream);
            }

            ParsedTimetable parsed;
            try
            {
                parsed = await TimetableOcr.ParseAsync(temp, extension);
            }
            catch (Exception ex)
            {
                return BadRequest(new { message = "OCR 识别失败：" + ex.Message });
            }
            if (parsed.Slots.Count == 0)
                return BadRequest(new { message = "没有从图片里识别到课程，请换一张更清晰的课表截图" });

            var fallbackName = Path.GetFileNameWithoutExtension(file.FileName) ?? "OCR 导入的课表";
            var (plan, error) = BuildPlanFromParsed(
                parsed, scheduleName, startTime, weekCount, fallbackName,
                extraWarnings: new[] { "本次结果来自图片/PDF 文字识别（OCR），可能有错别字，请重点核对课程名、地点和教师" });
            if (plan is null) return BadRequest(new { message = error });
            return Ok(ToPreview(plan));
        }
        finally
        {
            try { System.IO.File.Delete(temp); } catch { /* 清理失败无所谓 */ }
        }
    }

    /// <summary>
    /// 按预检结果正式保存课表（OCR / 图片流程用；前端把预检返回的课程原样传回来）。
    /// Excel 流程也可以用它，避免重复上传解析。
    /// </summary>
    [HttpPost("Import/Confirm")]
    public async Task<ActionResult<ScheduleDetailDto>> ConfirmImport([FromBody] ScheduleImportConfirmDto dto)
    {
        var userId = GetUserId();
        var (plan, error) = BuildPlanFromConfirm(dto);
        if (plan is null) return BadRequest(new { message = error });

        var detail = await SavePlanAsync(userId, plan);
        return detail is null ? NotFound(new { message = "导入后读取课表失败" }) : Ok(detail);
    }

    /// <summary>
    /// 作息表列表：作息表模板在前，再补上从已有课表里去重提取的历史作息。
    /// 导入 / 新建课表时可以让用户选一套复用。
    /// </summary>
    [HttpGet("Timetables")]
    public async Task<ActionResult<List<ScheduleTimetableDto>>> GetTimetables()
    {
        var userId = GetUserId();
        var result = new List<ScheduleTimetableDto>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var templates = await _db.TimetableTemplates
            .Where(t => t.UserId == userId && !t.IsDeleted)
            .OrderByDescending(t => t.UpdatedAt)
            .ToListAsync();
        foreach (var template in templates)
        {
            var times = JsonSerializer.Deserialize<List<string>>(template.TimesJson, JsonOpts) ?? new List<string>();
            if (times.Count == 0) continue;
            if (!seen.Add(string.Join('\u0001', times))) continue;
            result.Add(new ScheduleTimetableDto
            {
                Id = template.Id,
                Name = template.Name,
                Times = times,
                FromSchedule = false,
                UpdatedAt = template.UpdatedAt,
            });
        }

        var schedules = await _db.Schedules
            .Where(s => s.UserId == userId && !s.IsDeleted)
            .OrderByDescending(s => s.UpdatedAt)
            .Select(s => new { s.ScheduleName, s.TimetableJson, s.UpdatedAt })
            .ToListAsync();
        foreach (var schedule in schedules)
        {
            var times = JsonSerializer.Deserialize<List<string>>(schedule.TimetableJson, JsonOpts) ?? new List<string>();
            if (times.Count == 0) continue;
            if (!seen.Add(string.Join('\u0001', times))) continue;
            result.Add(new ScheduleTimetableDto
            {
                Id = 0,
                Name = schedule.ScheduleName,
                Times = times,
                FromSchedule = true,
                UpdatedAt = schedule.UpdatedAt,
            });
        }

        return Ok(result.Take(50).ToList());
    }

    /// <summary>新建作息表模板。</summary>
    [HttpPost("Timetables")]
    public async Task<ActionResult<ScheduleTimetableDto>> CreateTimetable([FromBody] SaveTimetableDto dto)
    {
        var userId = GetUserId();
        var name = (dto.Name ?? string.Empty).Trim();
        if (name.Length == 0) return BadRequest(new { message = "作息表名称不能为空" });
        if (name.Length > 100) return BadRequest(new { message = "作息表名称不能超过 100 个字符" });
        var times = NormalizeTimetable(dto.Times);
        if (times is null) return BadRequest(new { message = "作息时间不能为空，且每节格式应为 HH:mm-HH:mm" });

        var now = DateTime.UtcNow;
        var entity = new TimetableTemplate
        {
            UserId = userId,
            Name = name,
            TimesJson = JsonSerializer.Serialize(times, JsonOpts),
            IsDeleted = false,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.TimetableTemplates.Add(entity);
        await _db.SaveChangesAsync();
        return Ok(new ScheduleTimetableDto
        {
            Id = entity.Id,
            Name = entity.Name,
            Times = times,
            FromSchedule = false,
            UpdatedAt = entity.UpdatedAt,
        });
    }

    /// <summary>修改作息表模板。</summary>
    [HttpPut("Timetables/{id:ulong}")]
    public async Task<ActionResult<ScheduleTimetableDto>> UpdateTimetable(ulong id, [FromBody] SaveTimetableDto dto)
    {
        var userId = GetUserId();
        var entity = await _db.TimetableTemplates
            .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId && !t.IsDeleted);
        if (entity is null) return NotFound(new { message = "未找到作息表" });

        var name = (dto.Name ?? string.Empty).Trim();
        if (name.Length == 0) return BadRequest(new { message = "作息表名称不能为空" });
        if (name.Length > 100) return BadRequest(new { message = "作息表名称不能超过 100 个字符" });
        var times = NormalizeTimetable(dto.Times);
        if (times is null) return BadRequest(new { message = "作息时间不能为空，且每节格式应为 HH:mm-HH:mm" });

        entity.Name = name;
        entity.TimesJson = JsonSerializer.Serialize(times, JsonOpts);
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new ScheduleTimetableDto
        {
            Id = entity.Id,
            Name = entity.Name,
            Times = times,
            FromSchedule = false,
            UpdatedAt = entity.UpdatedAt,
        });
    }

    /// <summary>删除作息表模板（伪删除）。</summary>
    [HttpDelete("Timetables/{id:ulong}")]
    public async Task<IActionResult> DeleteTimetable(ulong id)
    {
        var userId = GetUserId();
        var entity = await _db.TimetableTemplates
            .FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId && !t.IsDeleted);
        if (entity is null) return NotFound(new { message = "未找到作息表" });
        entity.IsDeleted = true;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { message = "已删除" });
    }

    /// <summary>
    /// 从 Excel 导入课表：解析文件 → 新建一张课表 + 课程 + 时间段，返回课表详情。
    ///
    /// 支持 .xlsx / .xls；解析规则与前端 demo 一致（自动识别通用横排 / 教务系统竖排、
    /// 合并单元格、一格多课、周次等）。缺少的信息用默认值补齐（作息时间、周数 20）。
    /// 建议先调 <see cref="PreviewImport"/> 让用户确认后再调用本接口。
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
        var (plan, error) = await BuildExcelImportPlanAsync(file, scheduleName, startTime, weekCount);
        if (plan is null) return BadRequest(new { message = error });

        var detail = await SavePlanAsync(userId, plan);
        return detail is null ? NotFound(new { message = "导入后读取课表失败" }) : Ok(detail);
    }

    /// <summary>把导入计划写库（新建课表 + 课程 + 时间段），返回详情。</summary>
    async Task<ScheduleDetailDto?> SavePlanAsync(ulong userId, ImportPlan plan)
    {
        var now = DateTime.UtcNow;
        await using var transaction = await _db.Database.BeginTransactionAsync();

        var schedule = new Schedule
        {
            UserId = userId,
            ScheduleName = plan.Name,
            StartTime = plan.StartDate,
            WeekCount = plan.WeekCount,
            TimetableJson = JsonSerializer.Serialize(plan.Timetable, JsonOpts),
            UpdatedAt = now,
            CreatedAt = now,
            IsDeleted = false,
        };
        _db.Schedules.Add(schedule);
        await _db.SaveChangesAsync();

        foreach (var coursePlan in plan.Courses)
        {
            var course = new Course
            {
                ScheduleId = schedule.Id,
                CourseName = coursePlan.CourseName,
                Color = coursePlan.Color,
                UpdatedAt = now,
                CreatedAt = now,
                IsDeleted = false,
            };
            _db.Courses.Add(course);
            await _db.SaveChangesAsync();

            foreach (var time in coursePlan.Times)
            {
                _db.CourseTimes.Add(new CourseTime
                {
                    CourseId = course.Id,
                    Location = time.Location,
                    Teacher = time.Teacher,
                    WeekListJson = JsonSerializer.Serialize(time.WeekList, JsonOpts),
                    SectionListJson = JsonSerializer.Serialize(time.SectionList, JsonOpts),
                    DayOfWeek = time.DayOfWeek,
                    UpdatedAt = now,
                    CreatedAt = now,
                    IsDeleted = false,
                });
            }
        }

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        return await BuildDetailAsync(userId, schedule.Id);
    }

    /// <summary>解析 Excel → 导入计划。</summary>
    async Task<(ImportPlan? plan, string? error)> BuildExcelImportPlanAsync(
        IFormFile? file,
        string? scheduleName,
        string? startTime,
        int? weekCount)
    {
        if (file is null || file.Length == 0)
            return (null, "请选择要导入的 Excel 文件");

        var extension = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
        if (extension is not (".xlsx" or ".xls"))
            return (null, "仅支持 .xlsx / .xls 文件（.csv 请先用 Excel 另存为 xlsx）");
        if (file.Length > 10 * 1024 * 1024)
            return (null, "文件不能超过 10MB");

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
            return (null, $"解析失败：{ex.Message}");
        }

        return BuildPlanFromParsed(parsed, scheduleName, startTime, weekCount,
            Path.GetFileNameWithoutExtension(file.FileName) ?? "导入的课表");
    }

    /// <summary>解析结果（Excel / OCR 共用）→ 导入计划。</summary>
    (ImportPlan? plan, string? error) BuildPlanFromParsed(
        ParsedTimetable parsed,
        string? scheduleName,
        string? startTime,
        int? weekCount,
        string fallbackName,
        string[]? extraWarnings = null)
    {
        if (parsed.Slots.Count == 0)
            return (null, "没有从文件里识别到课程，请检查这张表是不是课表");

        var warnings = new List<string>();
        if (extraWarnings is { Length: > 0 }) warnings.AddRange(extraWarnings);

        var name = (scheduleName ?? string.Empty).Trim();
        if (name.Length == 0) name = (parsed.Title ?? string.Empty).Trim();
        if (name.Length == 0)
        {
            name = fallbackName;
            if (name.Length > 0) warnings.Add($"未识别到课表名称，默认使用「{name}」");
        }
        if (name.Length == 0) name = "导入的课表";
        if (name.Length > 100) name = name[..100];

        DateOnly startDate;
        if (!string.IsNullOrWhiteSpace(startTime))
        {
            if (!DateOnly.TryParseExact(startTime.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out startDate))
                return (null, "开课日期格式应为 yyyy-MM-dd");
        }
        else
        {
            startDate = parsed.SuggestedStartDate ?? ThisMonday();
            if (parsed.SuggestedStartDate is null)
                warnings.Add($"没有识别到学期信息，开课日期默认用本周一（{startDate:yyyy-MM-dd}）");
        }

        var maxWeekInFile = parsed.Slots
            .Select(s => TimetableExcelParser.ParseWeekList(s.Weeks) is { Count: > 0 } list ? list.Max() : 0)
            .DefaultIfEmpty(0)
            .Max();

        var weeks = weekCount ?? Math.Max(20, maxWeekInFile);
        if (weeks < 1 || weeks > MaxWeekCount)
            return (null, $"学期周数需在 1-{MaxWeekCount} 之间");
        if (weeks < maxWeekInFile) weeks = maxWeekInFile;

        var sectionCount = Math.Clamp(parsed.MaxSection, 1, MaxSections);
        var fileTimes = parsed.Times?.Where(t => !string.IsNullOrWhiteSpace(t)).ToList();
        var timetableFromFile = fileTimes is { Count: >= 4 };
        var timetable = timetableFromFile
            ? fileTimes!
            : TimetableExcelParser.DefaultTimetable(sectionCount);
        // 文件作息比课程节次短时用默认作息补齐；文件作息更长时以作息表节数为准。
        if (timetable.Count < sectionCount)
        {
            var fallbackTimes = TimetableExcelParser.DefaultTimetable(sectionCount);
            for (var i = timetable.Count; i < sectionCount; i++) timetable.Add(fallbackTimes[i]);
        }
        else if (sectionCount < timetable.Count)
        {
            sectionCount = Math.Clamp(timetable.Count, 1, MaxSections);
        }
        if (parsed.SuggestedStartDate is not null)
            warnings.Add($"文件里的学期：{parsed.SemesterLabel ?? "未识别"}");
        warnings.Add(timetableFromFile
            ? $"已从文件读取 {timetable.Count} 节作息时间（可在预检里修改或换用已保存的作息）"
            : $"文件里没有作息时间，已使用默认 {sectionCount} 节时间（可在预检里换用已保存的作息或手动修改）");

        var palette = new[]
        {
            "#9b4f93", "#4f9b93", "#9b6b4f", "#4f6b9b", "#7a4f9b",
            "#9b4f5a", "#4f9b6b", "#8f9b4f", "#4f8a9b", "#9b874f",
        };
        var allWeeks = Enumerable.Range(1, weeks).ToList();
        var courses = new List<PlanCourse>();
        var courseIndex = 0;

        foreach (var group in parsed.Slots.GroupBy(s => s.Course.Trim()))
        {
            var courseName = group.Key.Length > 100 ? group.Key[..100] : group.Key;
            var times = new List<PlanTime>();
            var missingTeacher = false;
            var missingLocation = false;
            var missingWeeks = false;

            foreach (var slot in group)
            {
                var sections = Enumerable.Range(slot.PeriodStart, slot.PeriodEnd - slot.PeriodStart + 1)
                    .Where(v => v >= 1 && v <= MaxSections)
                    .Distinct()
                    .OrderBy(v => v)
                    .ToList();
                if (sections.Count == 0) continue;

                var weekList = TimetableExcelParser.ParseWeekList(slot.Weeks);
                if (weekList is { Count: > 0 })
                {
                    weekList = weekList.Where(w => w >= 1 && w <= weeks).Distinct().OrderBy(w => w).ToList();
                }
                else
                {
                    weekList = allWeeks;
                    missingWeeks = true;
                }
                if (weekList.Count == 0) weekList = allWeeks;

                var teacher = (slot.Teacher ?? string.Empty).Trim();
                var location = (slot.Location ?? string.Empty).Trim();
                if (teacher.Length == 0) missingTeacher = true;
                if (location.Length == 0) missingLocation = true;

                times.Add(new PlanTime(
                    Math.Clamp(slot.DayOfWeek, 1, 7),
                    weekList,
                    sections,
                    location,
                    teacher));
            }

            if (times.Count == 0) continue;
            var color = palette[courseIndex++ % palette.Length];
            courses.Add(new PlanCourse(courseName, color, times));

            if (missingTeacher) warnings.Add($"「{courseName}」缺少任课教师（已留空）");
            if (missingLocation) warnings.Add($"「{courseName}」缺少上课地点（已留空）");
            if (missingWeeks) warnings.Add($"「{courseName}」未识别到周次（已按第 1-{weeks} 周处理）");
        }

        if (courses.Count == 0)
            return (null, "识别到的内容里没有有效课程");

        var conflicts = DetectImportConflicts(courses);
        var plan = new ImportPlan(name, parsed.SemesterLabel, startDate, weeks, sectionCount,
            timetable, timetableFromFile, courses, warnings, conflicts);
        return (plan, null);
    }

    /// <summary>预检结果（前端回传）→ 导入计划。</summary>
    (ImportPlan? plan, string? error) BuildPlanFromConfirm(ScheduleImportConfirmDto dto)
    {
        if (dto is null) return (null, "请求内容为空");
        var courses = dto.Courses ?? new List<CourseDto>();
        if (courses.Count == 0) return (null, "没有要导入的课程");

        var name = (dto.ScheduleName ?? string.Empty).Trim();
        if (name.Length == 0) name = "导入的课表";
        if (name.Length > 100) name = name[..100];

        DateOnly startDate;
        if (!string.IsNullOrWhiteSpace(dto.StartTime))
        {
            if (!DateOnly.TryParseExact(dto.StartTime.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out startDate))
                return (null, "开课日期格式应为 yyyy-MM-dd");
        }
        else
        {
            startDate = ThisMonday();
        }

        var weeks = dto.WeekCount ?? 20;
        if (weeks < 1 || weeks > MaxWeekCount)
            return (null, $"学期周数需在 1-{MaxWeekCount} 之间");

        var warnings = new List<string>();
        var maxSection = courses
            .SelectMany(c => c.Times ?? new List<CourseTimeDto>())
            .SelectMany(t => t.SectionList ?? new List<int>())
            .DefaultIfEmpty(0)
            .Max();
        var incoming = dto.Timetable?.Where(t => !string.IsNullOrWhiteSpace(t)).ToList();
        // 节次数取「课程用到的最大节次」和「用户选择的作息表节数」中较大的：
        // 用户可能选了一套 12 节的作息，但课程只排到第 6 节，作息表仍应完整保留。
        var sectionCount = Math.Clamp(Math.Max(maxSection, incoming?.Count ?? 0), 1, MaxSections);
        var defaultTimetable = TimetableExcelParser.DefaultTimetable(sectionCount);
        var timetable = incoming is { Count: > 0 } ? incoming.Take(sectionCount).ToList() : new List<string>();
        for (var i = timetable.Count; i < sectionCount; i++)
            timetable.Add(defaultTimetable[i]);
        var allWeeks = Enumerable.Range(1, weeks).ToList();
        var palette = new[]
        {
            "#9b4f93", "#4f9b93", "#9b6b4f", "#4f6b9b", "#7a4f9b",
            "#9b4f5a", "#4f9b6b", "#8f9b4f", "#4f8a9b", "#9b874f",
        };

        var planCourses = new List<PlanCourse>();
        var index = 0;
        foreach (var course in courses)
        {
            var courseName = (course.CourseName ?? string.Empty).Trim();
            if (courseName.Length == 0) continue;
            if (courseName.Length > 100) courseName = courseName[..100];

            var times = new List<PlanTime>();
            foreach (var time in course.Times ?? new List<CourseTimeDto>())
            {
                var sections = (time.SectionList ?? new List<int>())
                    .Where(v => v >= 1 && v <= MaxSections).Distinct().OrderBy(v => v).ToList();
                if (sections.Count == 0) continue;
                var weekList = (time.WeekList ?? new List<int>())
                    .Where(v => v >= 1 && v <= weeks).Distinct().OrderBy(v => v).ToList();
                if (weekList.Count == 0) weekList = allWeeks;
                var location = (time.Location ?? string.Empty).Trim();
                var teacher = (time.Teacher ?? string.Empty).Trim();
                if (teacher.Length == 0) warnings.Add($"「{courseName}」缺少任课教师（已留空）");
                if (location.Length == 0) warnings.Add($"「{courseName}」缺少上课地点（已留空）");
                times.Add(new PlanTime(
                    Math.Clamp(time.DayOfWeek, 1, 7),
                    weekList,
                    sections,
                    location,
                    teacher));
            }
            if (times.Count == 0) continue;
            var color = string.IsNullOrWhiteSpace(course.Color) || !ColorRegex.IsMatch(course.Color)
                ? palette[index % palette.Length]
                : course.Color!;
            index++;
            planCourses.Add(new PlanCourse(courseName, color, times));
        }

        if (planCourses.Count == 0) return (null, "没有有效课程");
        warnings.Add("课表已按预检结果保存，可随时在课表设置里修改");

        var conflicts = DetectImportConflicts(planCourses);
        var plan = new ImportPlan(name, null, startDate, weeks, sectionCount,
            timetable, true, planCourses, warnings, conflicts);
        return (plan, null);
    }

    /// <summary>把导入计划转成预览 DTO（课程/时间段 ID 都是 0，因为还没写库）。</summary>
    static ScheduleImportPreviewDto ToPreview(ImportPlan plan)
    {
        return new ScheduleImportPreviewDto
        {
            ScheduleName = plan.Name,
            SemesterLabel = plan.SemesterLabel,
            StartTime = plan.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            WeekCount = plan.WeekCount,
            SectionCount = plan.SectionCount,
            Timetable = plan.Timetable,
            TimetableFromFile = plan.TimetableFromFile,
            TimeCount = plan.Courses.Sum(c => c.Times.Count),
            Warnings = plan.Warnings,
            Conflicts = plan.Conflicts,
            Courses = plan.Courses.Select(c => new CourseDto
            {
                CourseName = c.CourseName,
                Color = c.Color,
                Times = c.Times.Select(t => new CourseTimeDto
                {
                    Location = t.Location,
                    Teacher = t.Teacher,
                    WeekList = t.WeekList,
                    SectionList = t.SectionList,
                    DayOfWeek = t.DayOfWeek,
                }).ToList(),
            }).ToList(),
        };
    }

    /// <summary>粗查冲突：同一天、节次重叠、且周次有交集。</summary>
    static List<string> DetectImportConflicts(List<PlanCourse> courses)
    {
        var flat = courses
            .SelectMany(c => c.Times.Select(t => (c.CourseName, Time: t)))
            .ToList();
        var conflicts = new List<string>();
        for (var i = 0; i < flat.Count; i++)
        {
            for (var j = i + 1; j < flat.Count; j++)
            {
                var (nameA, a) = flat[i];
                var (nameB, b) = flat[j];
                if (a.DayOfWeek != b.DayOfWeek) continue;
                if (a.SectionList.Max() < b.SectionList.Min() || b.SectionList.Max() < a.SectionList.Min())
                    continue;
                if (!a.WeekList.Intersect(b.WeekList).Any()) continue;
                var dayText = a.DayOfWeek is >= 1 and <= 7 ? "周" + "一二三四五六日"[a.DayOfWeek - 1] : $"周{a.DayOfWeek}";
                conflicts.Add($"{dayText} 第{a.SectionList.Min()}-{a.SectionList.Max()}节：「{nameA}」与「{nameB}」时间冲突");
                if (conflicts.Count >= 20)
                {
                    conflicts.Add("…（冲突过多，仅显示前 20 条）");
                    return conflicts;
                }
            }
        }
        return conflicts;
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
            var match = TimeRangeRegex.Match(item);
            if (!match.Success) return null;

            // 还要校验结束晚于开始（允许 8:00-8:45 这种单位数小时，但 25:00 / 08:00-08:00 不合法）
            var startMinutes = int.Parse(match.Groups[1].Value) * 60 + int.Parse(match.Groups[2].Value);
            var endMinutes = int.Parse(match.Groups[3].Value) * 60 + int.Parse(match.Groups[4].Value);
            if (endMinutes <= startMinutes) return null;

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

/// <summary>导入计划（预检和正式导入共用）。</summary>
internal sealed record ImportPlan(
    string Name,
    string? SemesterLabel,
    DateOnly StartDate,
    int WeekCount,
    int SectionCount,
    List<string> Timetable,
    bool TimetableFromFile,
    List<PlanCourse> Courses,
    List<string> Warnings,
    List<string> Conflicts);

/// <summary>计划中的一门课。</summary>
internal sealed record PlanCourse(string CourseName, string Color, List<PlanTime> Times);

/// <summary>计划中的一段上课时间。</summary>
internal sealed record PlanTime(int DayOfWeek, List<int> WeekList, List<int> SectionList, string Location, string Teacher);
