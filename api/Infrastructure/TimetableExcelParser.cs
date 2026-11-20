using System.Globalization;
using System.Text.RegularExpressions;
using NPOI.SS.UserModel;
using NPOI.SS.Util;

namespace api.Infrastructure;

/// <summary>从 Excel 里解析出的一条课时记录（一门课在某天某节段）。</summary>
public sealed record ParsedSlot(
    int DayOfWeek,
    int PeriodStart,
    int PeriodEnd,
    string Course,
    string? Teacher,
    string? Location,
    string? Weeks,
    string? Section);

/// <summary>Excel 解析结果。</summary>
public sealed record ParsedTimetable(
    string? Title,
    string? SemesterLabel,
    DateOnly? SuggestedStartDate,
    int MaxSection,
    List<ParsedSlot> Slots);

/// <summary>
/// 课表 Excel 解析器（NPOI，支持 .xls / .xlsx）。
///
/// 支持两类常见课表：
///   A. 通用横排：行 = 节次（"1-2节"），列 = 星期一…星期日，单元格多行写 课程/地点/教师
///   B. 教务系统竖排：大节列（上午/下午/晚上）+ 中文小节列（一…十二），
///      单元格为 `课程/课程号/(x-y节)周次/校区 地点/教师/…`，一格可叠多门课
///
/// 解析思路：合并单元格展开成网格 → 自动找表头（星期X）→ 自动选节次列（1-2节 或 一…十二）
/// → 逐格解析 → 相邻同门课合并。算法与前端 TS 版一致。
/// </summary>
public static class TimetableExcelParser
{
    const int MaxSections = 30;
    static readonly Regex SlashEntryRe = new(
        @"^(.+?)\s*/\s*([A-Za-z]{1,4}\d{4,})\s*/\s*(?:\((\d+)\s*-\s*(\d+)\s*节\))?\s*([^/]*)\s*/\s*([^/]*)\s*/\s*([^/]*)",
        RegexOptions.Compiled);
    static readonly Regex CourseStartRe = new(
        @"^[^/]+\/\s*[A-Za-z]{1,4}\d{4,}\s*\/",
        RegexOptions.Compiled);

    public static ParsedTimetable Parse(Stream stream)
    {
        IWorkbook wb;
        wb = WorkbookFactory.Create(stream);
        var sheet = wb.GetSheetAt(0) ?? throw new InvalidOperationException("Excel 里没有工作表");
        return ParseSheet(sheet);
    }

    static ParsedTimetable ParseSheet(ISheet sheet)
    {
        // ---- 0. 网格边界 = 使用区 ∪ 合并区 ----
        var merges = new List<CellRangeAddress>();
        for (var i = 0; i < sheet.NumMergedRegions; i++) merges.Add(sheet.GetMergedRegion(i));

        var maxRow = sheet.LastRowNum;
        var maxCol = 0;
        for (var r = 0; r <= sheet.LastRowNum; r++)
        {
            var row = sheet.GetRow(r);
            if (row is not null) maxCol = Math.Max(maxCol, row.LastCellNum - 1);
        }
        foreach (var m in merges)
        {
            maxRow = Math.Max(maxRow, m.LastRow);
            maxCol = Math.Max(maxCol, m.LastColumn);
        }
        if (maxRow < 1 || maxCol < 1) throw new InvalidOperationException("Excel 内容太少，识别不了课表");

        var grid = new string[maxRow + 1, maxCol + 1];
        for (var r = 0; r <= maxRow; r++)
            for (var c = 0; c <= maxCol; c++)
                grid[r, c] = sheet.GetRow(r)?.GetCell(c)?.ToString() ?? "";

        // ---- 1. 展开合并单元格 ----
        foreach (var m in merges)
        {
            var v = grid[m.FirstRow, m.FirstColumn];
            for (var r = m.FirstRow; r <= m.LastRow; r++)
                for (var c = m.FirstColumn; c <= m.LastColumn; c++)
                    grid[r, c] = v;
        }

        // ---- 2. 表头 / 星期列 ----
        var headerRow = -1;
        for (var r = 0; r <= maxRow && headerRow < 0; r++)
        {
            var hits = 0;
            for (var c = 0; c <= maxCol; c++)
                if (DayOf(grid[r, c]) > 0) hits++;
            if (hits >= 2) headerRow = r;
        }
        if (headerRow < 0) throw new InvalidOperationException("找不到表头：需要至少两个「星期X」列");

        var dayCols = new List<(int col, int day, string label)>();
        for (var c = 0; c <= maxCol; c++)
        {
            var d = DayOf(grid[headerRow, c]);
            if (d > 0) dayCols.Add((c, d, grid[headerRow, c].Trim()));
        }
        if (dayCols.Count < 2) throw new InvalidOperationException("表头里的「星期」列少于 2 个");

        // ---- 3. 自动选节次列 / 大节列 ----
        var firstDayCol = dayCols[0].col;
        var periodCol = AutoPeriodColumn(grid, headerRow, maxRow, firstDayCol);
        var sectionCol = -1;
        if (periodCol > 0 && IsSectionColumn(grid, headerRow, maxRow, periodCol - 1)) sectionCol = periodCol - 1;

        // ---- 4. 行 → 节次 / 大节 ----
        var rowPeriod = new Dictionary<int, (int start, int end)>();
        var rowSection = new Dictionary<int, string>();
        (int start, int end)? last = null;
        var lastSection = "";
        for (var r = headerRow + 1; r <= maxRow; r++)
        {
            (int start, int end)? range;
            if (periodCol >= 0)
            {
                range = ParsePeriod(grid[r, periodCol]) ?? last;
                if (range is not null) last = range;
            }
            else
            {
                range = (r - headerRow, r - headerRow);
            }
            if (range is not null) rowPeriod[r] = range.Value;

            if (sectionCol >= 0)
            {
                var v = grid[r, sectionCol].Trim();
                if (v.Length > 0) lastSection = v;
                if (lastSection.Length > 0) rowSection[r] = lastSection;
            }
        }

        // ---- 5. 逐格解析 ----
        var rawSlots = new List<ParsedSlot>();
        var seen = new HashSet<string>();
        for (var r = headerRow + 1; r <= maxRow; r++)
        {
            if (!rowPeriod.TryGetValue(r, out var rp)) continue;
            foreach (var (col, day, label) in dayCols)
            {
                var raw = grid[r, col].Trim();
                if (raw.Length == 0) continue;

                var merge = merges.FirstOrDefault(m =>
                    r >= m.FirstRow && r <= m.LastRow && col >= m.FirstColumn && col <= m.LastColumn);
                if (merge is not null)
                {
                    if (!(merge.FirstRow == r && merge.FirstColumn == col)) continue; // 被纵向合并覆盖
                    if (merge.LastColumn - merge.FirstColumn >= 1) continue;          // 横跨多列 = 标题/说明
                }

                foreach (var e in ParseCell(raw))
                {
                    if (string.IsNullOrWhiteSpace(e.Course)) continue;
                    var start = e.PeriodStart ?? rp.start;
                    var end = e.PeriodEnd ?? rp.end;
                    var key = $"{day}:{start}-{end}:{e.Course}:{e.Weeks}";
                    if (!seen.Add(key)) continue;
                    rowSection.TryGetValue(r, out var section);
                    rawSlots.Add(new ParsedSlot(day, start, end, e.Course, e.Teacher, e.Location, e.Weeks, section));
                }
            }
        }

        // ---- 6. 相邻同门课合并 ----
        string GroupKey(ParsedSlot s) => string.Join('\u0001',
            s.DayOfWeek, s.Course, s.Teacher ?? "", s.Location ?? "", s.Weeks ?? "");
        var merged = new List<ParsedSlot>();
        foreach (var group in rawSlots.GroupBy(GroupKey))
        {
            var ordered = group.OrderBy(s => s.PeriodStart).ToList();
            var acc = new List<ParsedSlot>();
            foreach (var slot in ordered)
            {
                if (acc.Count > 0 && slot.PeriodStart <= acc[^1].PeriodEnd + 1)
                {
                    var prev = acc[^1];
                    acc[^1] = prev with { PeriodEnd = Math.Max(prev.PeriodEnd, slot.PeriodEnd) };
                    continue;
                }
                acc.Add(slot);
            }
            merged.AddRange(acc);
        }
        var slots = merged
            .OrderBy(s => s.DayOfWeek)
            .ThenBy(s => s.PeriodStart)
            .ThenBy(s => s.Course, StringComparer.Ordinal)
            .ToList();

        // ---- 7. 标题 / 学期 ----
        (string? title, string? semester, DateOnly? startDate) = ParseHeaderInfo(grid, headerRow);
        var maxSection = slots.Count == 0 ? 0 : slots.Max(s => s.PeriodEnd);

        return new ParsedTimetable(title, semester, startDate, maxSection, slots);
    }

    // ---------- 表头信息 ----------
    static (string? title, string? semester, DateOnly? startDate) ParseHeaderInfo(string[,] grid, int headerRow)
    {
        string? title = null;
        string? semester = null;
        DateOnly? startDate = null;
        var rowCount = grid.GetLength(0);
        var colCount = grid.GetLength(1);
        for (var r = 0; r < Math.Min(headerRow, 4); r++)
        {
            for (var c = 0; c < colCount; c++)
            {
                var text = grid[r, c]?.Trim() ?? "";
                if (text.Length == 0) continue;
                if (title is null && text.Contains("课表") && text.Length <= 80) title = text;
                if (semester is null)
                {
                    var m = Regex.Match(text, @"(\d{4})[-—](\d{4})\s*(?:学年|年)?\s*(第?[一二1-2]学期)");
                    if (m.Success)
                    {
                        semester = $"{m.Groups[1].Value}-{m.Groups[2].Value}学年{m.Groups[3].Value}学期";
                        var firstYear = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
                        var isFirst = m.Groups[3].Value.Contains('一') || m.Groups[3].Value.Contains('1');
                        startDate = isFirst
                            ? new DateOnly(firstYear, 9, 1)
                            : new DateOnly(firstYear + 1, 2, 20);
                    }
                }
            }
        }
        return (title, semester, startDate);
    }

    // ---------- 单元格解析 ----------
    sealed record Entry(
        string Course,
        string? Teacher,
        string? Location,
        string? Weeks,
        int? PeriodStart,
        int? PeriodEnd);

    static List<Entry> ParseCell(string raw)
    {
        var text = raw.Replace("\r\n", "\n").Replace('\r', '\n').Trim();
        if (text.Length == 0) return new List<Entry>();

        // 教务系统格式：含分隔符 / 且出现课程号
        if (text.Contains('/') && Regex.IsMatch(text, @"[A-Za-z]{1,4}\d{4,}"))
        {
            var groups = new List<string>();
            foreach (var line in text.Split('\n').Select(x => x.Trim()).Where(x => x.Length > 0))
            {
                if (groups.Count == 0 || CourseStartRe.IsMatch(line)) groups.Add(line);
                else groups[^1] += line; // 折行拼回去
            }
            var entries = new List<Entry>();
            foreach (var entry in groups)
            {
                var m = SlashEntryRe.Match(entry);
                if (!m.Success)
                {
                    entries.Add(new Entry(entry, null, null, null, null, null));
                    continue;
                }
                var weeks = m.Groups[5].Value.Trim();
                entries.Add(new Entry(
                    m.Groups[1].Value.Trim(),
                    m.Groups[7].Value.Trim() is { Length: > 0 } t ? t : null,
                    NormalizeLocation(m.Groups[6].Value),
                    weeks.Length > 0 ? weeks : null,
                    m.Groups[3].Success ? int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture) : null,
                    m.Groups[4].Success ? int.Parse(m.Groups[4].Value, CultureInfo.InvariantCulture) : null));
            }
            return entries;
        }

        // 通用格式：多行 = 课程/地点/教师；单行 "课程/地点/教师"
        var lines = text.Split('\n').Select(x => x.Trim()).Where(x => x.Length > 0).ToArray();
        if (lines.Length == 1 && lines[0].Contains('/'))
        {
            var parts = lines[0].Split('/').Select(x => x.Trim()).Where(x => x.Length > 0).ToArray();
            return new List<Entry>
            {
                new(parts[0], parts.Length > 2 ? parts[2] : null, parts.Length > 1 ? parts[1] : null, null, null, null)
            };
        }
        if (lines.Length == 0) return new List<Entry>();
        return new List<Entry>
        {
            new(lines[0], lines.Length > 2 ? lines[2] : null, lines.Length > 1 ? lines[1] : null, null, null, null)
        };
    }

    static string? NormalizeLocation(string value)
    {
        var text = value.Trim();
        if (text.Length == 0) return null;
        var stripped = Regex.Replace(text, @"^[\u4e00-\u9fa5]{2,8}校区\s*", "").Trim();
        return stripped.Length > 0 ? stripped : text;
    }

    // ---------- 节次 / 星期 / 大节 ----------
    static int DayOf(string label)
    {
        var m = Regex.Match(label, @"星期\s*([一二三四五六日天])");
        if (!m.Success) return 0;
        return "一二三四五六日天".IndexOf(m.Groups[1].Value) switch
        {
            0 => 1, 1 => 2, 2 => 3, 3 => 4, 4 => 5, 5 => 6, _ => 7,
        };
    }

    static (int start, int end)? ParsePeriod(string label)
    {
        var text = label.Trim();
        if (text.Length == 0) return null;
        var nums = Regex.Matches(text, @"\d+").Select(x => int.Parse(x.Value, CultureInfo.InvariantCulture)).ToList();
        if (nums.Count > 0)
        {
            var start = nums.Min();
            var end = nums.Max();
            if (start < 1 || end > MaxSections) return null; // 表尾说明行里的年份
            return (start, end);
        }
        if (Regex.IsMatch(text, @"^[一二三四五六七八九十]+$"))
        {
            var n = CnToNumber(text);
            if (n >= 1 && n <= MaxSections) return (n, n);
        }
        return null;
    }

    static int CnToNumber(string text)
    {
        var s = text.Trim();
        if (s.Length == 0) return 0;
        if (s == "十") return 10;
        var idx = s.IndexOf('十');
        if (idx >= 0)
        {
            var head = s[..idx];
            var tail = s[(idx + 1)..];
            var tens = head.Length > 0 ? "一二三四五六七八九".IndexOf(head[0]) + 1 : 1;
            var ones = tail.Length > 0 ? "一二三四五六七八九".IndexOf(tail[0]) + 1 : 0;
            return tens * 10 + ones;
        }
        return "一二三四五六七八九".IndexOf(s[0]) + 1;
    }

    static int AutoPeriodColumn(string[,] grid, int headerRow, int maxRow, int firstDayCol)
    {
        var best = -1;
        double bestScore = 0;
        for (var c = 0; c < firstDayCol; c++)
        {
            int nonEmpty = 0, parsed = 0;
            for (var r = headerRow + 1; r <= maxRow; r++)
            {
                var v = grid[r, c].Trim();
                if (v.Length == 0) continue;
                nonEmpty++;
                if (ParsePeriod(v) is not null) parsed++;
            }
            if (nonEmpty < 2) continue;
            var score = (double)parsed / nonEmpty;
            if (score >= bestScore)
            {
                bestScore = score;
                best = c;
            }
        }
        return bestScore >= 0.5 ? best : -1;
    }

    static bool IsSectionColumn(string[,] grid, int headerRow, int maxRow, int c)
    {
        if (c < 0) return false;
        int hits = 0, total = 0;
        for (var r = headerRow + 1; r <= maxRow; r++)
        {
            var v = grid[r, c].Trim();
            if (v.Length == 0) continue;
            total++;
            if (Regex.IsMatch(v, "^(上午|下午|晚上|中午|早晨)$")) hits++;
        }
        return total >= 2 && (double)hits / total >= 0.6;
    }

    // ---------- 周次 ----------
    /// <summary>"1-4周,6-17周" / "8周" / "1-3周,6周,9-17周(单)" → 周次集合；解析不了返回 null</summary>
    public static List<int>? ParseWeekList(string? weeks)
    {
        if (string.IsNullOrWhiteSpace(weeks)) return null;
        var text = weeks.Replace("周", "").Replace(" ", "").Replace("\u3000", "");
        if (text.Length == 0) return null;
        var set = new SortedSet<int>();
        var matched = false;
        foreach (Match m in Regex.Matches(text, @"(\d+)(?:-(\d+))?(?:\((单|双)\)|(单|双))?"))
        {
            matched = true;
            var a = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
            var b = m.Groups[2].Success ? int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) : a;
            var parity = m.Groups[3].Success ? m.Groups[3].Value : m.Groups[4].Value;
            for (var w = a; w <= b; w++)
            {
                if (parity == "单" && w % 2 == 0) continue;
                if (parity == "双" && w % 2 == 1) continue;
                set.Add(w);
            }
        }
        return matched && set.Count > 0 ? set.ToList() : null;
    }

    /// <summary>默认作息时间（没有来源数据时使用；第 1 节 08:00 起，上午 4 节 / 下午 4 节 / 晚上 4 节）。</summary>
    public static List<string> DefaultTimetable(int sectionCount)
    {
        var blocks = new[]
        {
            ("08:00", "08:45"), ("08:55", "09:40"), ("10:00", "10:45"), ("10:55", "11:40"),
            ("14:00", "14:45"), ("14:55", "15:40"), ("16:00", "16:45"), ("16:55", "17:40"),
            ("19:00", "19:45"), ("19:55", "20:40"), ("20:50", "21:35"), ("21:45", "22:30"),
        };
        var list = new List<string>();
        for (var i = 0; i < sectionCount; i++)
        {
            if (i < blocks.Length) list.Add($"{blocks[i].Item1}-{blocks[i].Item2}");
            else
            {
                // 超长课表：从最后一节顺延 45 分钟 + 10 分钟课间
                var lastStart = TimeOnly.ParseExact(blocks[^1].Item1, "HH:mm", CultureInfo.InvariantCulture);
                var offset = (i - blocks.Length + 1) * 55;
                var start = lastStart.AddMinutes(offset);
                list.Add($"{start:HH:mm}-{start.AddMinutes(45):HH:mm}");
            }
        }
        return list;
    }
}
