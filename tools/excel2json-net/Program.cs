// 课表 Excel → JSON（.NET 10 + NPOI 2.8，Apache-2.0，可商用）
//
//   dotnet run --project tools/excel2json-net -- tools/excel2json/real-timetable.xls
//
// 为什么用 NPOI：教务系统导出的课表常是 BIFF 老格式 .xls，ClosedXML 只支持 xlsx。
// 解析思路与前端 TypeScript 版完全一致：
//   1. 合并区展开成完整网格（边界取"使用区 ∪ 合并区"的并集）
//   2. 自动探测表头 / 节次列 / 大节列（支持 "1-2节" 与 中文小节 "一…十二"）
//   3. 单元格支持两种格式：多行 课程/地点/教师，或 课程/课程号/(x-y节)周次/校区 地点/教师/…
//   4. 相邻的同门课合并成一段，冲突检测会核对周次是否有交集
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using NPOI.SS.UserModel;
using NPOI.SS.Util;

Console.OutputEncoding = Encoding.UTF8;

var path = args.Length > 0
    ? args[0]
    : Path.Combine("tools", "excel2json", "real-timetable.xls");
path = Path.GetFullPath(path);
Console.WriteLine($"📄 读取 {path}");

var swParse = System.Diagnostics.Stopwatch.StartNew();
IWorkbook wb;
using (var fs = File.OpenRead(path))
{
    wb = WorkbookFactory.Create(fs);
}
var sheet = wb.GetSheetAt(0);

// ---- 0. 网格边界 = 使用区 ∪ 合并区 ----
var merges = new List<CellRangeAddress>();
for (int i = 0; i < sheet.NumMergedRegions; i++)
    merges.Add(sheet.GetMergedRegion(i));

int maxRow = sheet.LastRowNum;
int maxCol = 0;
for (int r = 0; r <= sheet.LastRowNum; r++)
{
    var row = sheet.GetRow(r);
    if (row is not null) maxCol = Math.Max(maxCol, row.LastCellNum - 1);
}
foreach (var m in merges)
{
    maxRow = Math.Max(maxRow, m.LastRow);
    maxCol = Math.Max(maxCol, m.LastColumn);
}

string CellText(int r, int c) => sheet.GetRow(r)?.GetCell(c)?.ToString() ?? "";

var grid = new string[maxRow + 1, maxCol + 1];
for (int r = 0; r <= maxRow; r++)
    for (int c = 0; c <= maxCol; c++)
        grid[r, c] = CellText(r, c);

// ---- 1. 展开合并单元格 ----
foreach (var m in merges)
{
    var v = grid[m.FirstRow, m.FirstColumn];
    for (int r = m.FirstRow; r <= m.LastRow; r++)
        for (int c = m.FirstColumn; c <= m.LastColumn; c++)
            grid[r, c] = v;
}

// ---- 2. 表头 / 星期列 ----
static int DayOf(string label)
{
    var m = Regex.Match(label, @"星期\s*([一二三四五六日天])");
    if (!m.Success) return 0;
    return "一二三四五六日天".IndexOf(m.Groups[1].Value) switch
    {
        0 => 1, 1 => 2, 2 => 3, 3 => 4, 4 => 5, 5 => 6, _ => 7,
    };
}

int headerRow = -1;
for (int r = 0; r <= maxRow && headerRow < 0; r++)
{
    int hits = 0;
    for (int c = 0; c <= maxCol; c++)
        if (DayOf(grid[r, c]) > 0) hits++;
    if (hits >= 2) headerRow = r;
}
if (headerRow < 0) throw new InvalidOperationException("找不到表头：需要至少两个“星期X”列");

var dayCols = new List<(int col, int day, string label)>();
for (int c = 0; c <= maxCol; c++)
{
    var d = DayOf(grid[headerRow, c]);
    if (d > 0) dayCols.Add((c, d, grid[headerRow, c].Trim()));
}
if (dayCols.Count < 2) throw new InvalidOperationException("“星期”列少于 2 个");

// ---- 3. 节次解析（1-2节 / 中文小节）----
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
    var n = "一二三四五六七八九".IndexOf(s[0]) + 1;
    return n;
}

static (int start, int end)? ParsePeriod(string label)
{
    var text = label.Trim();
    if (text.Length == 0) return null;
    var nums = Regex.Matches(text, @"\d+").Select(x => int.Parse(x.Value)).ToList();
    if (nums.Count > 0)
    {
        int start = nums.Min(), end = nums.Max();
        if (start < 1 || end > 30) return null; // 表尾说明行里的年份
        return (start, end);
    }
    if (Regex.IsMatch(text, @"^[一二三四五六七八九十]+$"))
    {
        var n = CnToNumber(text);
        if (n >= 1 && n <= 30) return (n, n);
    }
    return null;
}

// 自动选节次列：星期列左边、最像节次的那一列
int AutoPeriodColumn()
{
    int best = -1;
    double bestScore = 0;
    int firstDay = dayCols[0].col;
    for (int c = 0; c < firstDay; c++)
    {
        int nonEmpty = 0, parsed = 0;
        for (int r = headerRow + 1; r <= maxRow; r++)
        {
            var v = grid[r, c].Trim();
            if (v.Length == 0) continue;
            nonEmpty++;
            if (ParsePeriod(v) is not null) parsed++;
        }
        if (nonEmpty < 2) continue;
        var score = (double)parsed / nonEmpty;
        if (score >= bestScore) { bestScore = score; best = c; }
    }
    return bestScore >= 0.5 ? best : -1;
}

var periodCol = AutoPeriodColumn();
var sectionCol = -1;
if (periodCol > 0)
{
    int hits = 0, total = 0;
    for (int r = headerRow + 1; r <= maxRow; r++)
    {
        var v = grid[r, periodCol - 1].Trim();
        if (v.Length == 0) continue;
        total++;
        if (Regex.IsMatch(v, "^(上午|下午|晚上|中午|早晨)$")) hits++;
    }
    if (total >= 2 && (double)hits / total >= 0.6) sectionCol = periodCol - 1;
}

// ---- 4. 行 → 节次 / 大节 ----
var rowPeriod = new Dictionary<int, (int start, int end)>();
var rowSection = new Dictionary<int, string>();
(int start, int end)? last = null;
var lastSection = "";
for (int r = headerRow + 1; r <= maxRow; r++)
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

// ---- 5. 单元格内容解析 ----
var slashRe = new Regex(
    @"^(.+?)\s*\/\s*([A-Za-z]{1,4}\d{4,})\s*\/\s*(?:\((\d+)\s*-\s*(\d+)\s*节\))?\s*([^/]*)\s*\/\s*([^/]*)\s*\/\s*([^/]*)");

string? NormalizeLocation(string value)
{
    var text = value.Trim();
    if (text.Length == 0) return null;
    var stripped = Regex.Replace(text, @"^[\u4e00-\u9fa5]{2,8}校区\s*", "").Trim();
    return stripped.Length > 0 ? stripped : text;
}

List<Entry> ParseCell(string raw)
{
    var text = raw.Replace("\r\n", "\n").Replace('\r', '\n').Trim();
    if (text.Length == 0) return [];
    if (slashRe.IsMatch(text))
    {
        var list = new List<Entry>();
        foreach (var line in text.Split('\n').Select(x => x.Trim()).Where(x => x.Length > 0))
        {
            var m = slashRe.Match(line);
            if (!m.Success) { list.Add(new Entry(line, null, null, null, null, null, null)); continue; }
            list.Add(new Entry(
                Course: m.Groups[1].Value.Trim(),
                Code: m.Groups[2].Value,
                PeriodStart: m.Groups[3].Success ? int.Parse(m.Groups[3].Value) : null,
                PeriodEnd: m.Groups[4].Success ? int.Parse(m.Groups[4].Value) : null,
                Weeks: m.Groups[5].Value.Trim() is { Length: > 0 } w ? w : null,
                Location: NormalizeLocation(m.Groups[6].Value),
                Teacher: m.Groups[7].Value.Trim() is { Length: > 0 } t ? t : null));
        }
        return list;
    }
    // 通用格式：多行 = 课程 / 地点 / 教师
    var lines = text.Split('\n').Select(x => x.Trim()).Where(x => x.Length > 0).ToArray();
    if (lines.Length == 0) return [];
    return [new Entry(lines[0], null, null, null, null,
        lines.Length > 1 ? lines[1] : null, lines.Length > 2 ? lines[2] : null)];
}

// ---- 6. 遍历数据区 ----
var rawSlots = new List<Slot>();
var seen = new HashSet<string>();
for (int r = headerRow + 1; r <= maxRow; r++)
{
    if (!rowPeriod.TryGetValue(r, out var rp)) continue;
    foreach (var (col, day, label) in dayCols)
    {
        var raw = grid[r, col].Trim();
        if (raw.Length == 0) continue;
        var merge = merges.FirstOrDefault(m => r >= m.FirstRow && r <= m.LastRow && col >= m.FirstColumn && col <= m.LastColumn);
        if (merge is not null)
        {
            if (!(merge.FirstRow == r && merge.FirstColumn == col)) continue; // 被纵向合并覆盖
            if (merge.LastColumn - merge.FirstColumn >= 1) continue;          // 横跨多列 = 标题/说明
        }
        foreach (var e in ParseCell(raw))
        {
            if (string.IsNullOrWhiteSpace(e.Course)) continue;
            int start = e.PeriodStart ?? rp.start;
            int end = e.PeriodEnd ?? rp.end;
            var key = $"{day}:{start}-{end}:{e.Course}:{e.Weeks}";
            if (!seen.Add(key)) continue;
            rowSection.TryGetValue(r, out var section);
            rawSlots.Add(new Slot(day, label, start, end, e.Course, e.Code, e.Teacher, e.Location, e.Weeks, section, raw));
        }
    }
}

// ---- 7. 相邻同门课合并（先按课程分组）----
string GroupKey(Slot s) => string.Join('\u0001', s.DayOfWeek, s.Course, s.Teacher ?? "", s.Location ?? "", s.Weeks ?? "");
var merged = new List<Slot>();
foreach (var group in rawSlots.GroupBy(GroupKey))
{
    var ordered = group.OrderBy(s => s.PeriodStart).ToList();
    var acc = new List<Slot>();
    foreach (var slot in ordered)
    {
        var prev = acc.Count > 0 ? acc[^1] : null;
        if (prev is not null && slot.PeriodStart <= prev.PeriodEnd + 1)
        {
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

// ---- 8. 冲突检测（周次有交集才算）----
static HashSet<int>? ParseWeeks(string? weeks)
{
    if (string.IsNullOrWhiteSpace(weeks)) return null;
    var text = weeks.Replace("周", "").Replace(" ", "").Replace("\u3000", "");
    if (text.Length == 0) return null;
    var set = new HashSet<int>();
    var matched = false;
    foreach (Match m in Regex.Matches(text, @"(\d+)(?:-(\d+))?(?:\((单|双)\)|(单|双))?"))
    {
        matched = true;
        int a = int.Parse(m.Groups[1].Value);
        int b = m.Groups[2].Success ? int.Parse(m.Groups[2].Value) : a;
        var parity = m.Groups[3].Success ? m.Groups[3].Value : m.Groups[4].Value;
        for (int w = a; w <= b; w++)
        {
            if (parity == "单" && w % 2 == 0) continue;
            if (parity == "双" && w % 2 == 1) continue;
            set.Add(w);
        }
    }
    return matched && set.Count > 0 ? set : null;
}

var conflicts = new List<string>();
for (int i = 0; i < slots.Count; i++)
{
    for (int j = i + 1; j < slots.Count; j++)
    {
        var a = slots[i];
        var b = slots[j];
        if (a.DayOfWeek != b.DayOfWeek) continue;
        if (Math.Max(a.PeriodStart, b.PeriodStart) > Math.Min(a.PeriodEnd, b.PeriodEnd)) continue;
        var wa = ParseWeeks(a.Weeks);
        var wb2 = ParseWeeks(b.Weeks);
        if (wa is not null && wb2 is not null && !wa.Overlaps(wb2)) continue;
        conflicts.Add($"{a.DayLabel} 第{a.PeriodStart}-{a.PeriodEnd}节：{a.Course} 与 {b.Course} 冲突");
    }
}

var result = new ParseResult(
    sheet.SheetName,
    dayCols.Select(d => new DayInfo(d.day, d.label)).ToList(),
    slots,
    conflicts);

var parseMs = swParse.Elapsed.TotalMilliseconds;
var json = JsonSerializer.Serialize(result, new JsonSerializerOptions
{
    WriteIndented = true,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,     // 与前端输出字段名一致
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, // 中文不转义成 \uXXXX
});
var outPath = Path.Combine(Path.GetDirectoryName(path)!, "timetable.dotnet.json");
File.WriteAllText(outPath, json);

Console.WriteLine($"✅ {slots.Count} 条课时，冲突 {conflicts.Count} 条（解析 {parseMs:F1} ms）");
foreach (var s in slots)
    Console.WriteLine($"{s.DayLabel} 第{s.PeriodStart}-{s.PeriodEnd}节 {s.Section ?? ""} {s.Course} {s.Location} {s.Teacher} {s.Weeks}");
Console.WriteLine($"✅ 已写入 {outPath}");

internal record Entry(string Course, string? Code, int? PeriodStart, int? PeriodEnd, string? Weeks, string? Location, string? Teacher);
internal record Slot(int DayOfWeek, string DayLabel, int PeriodStart, int PeriodEnd, string Course, string? Code, string? Teacher, string? Location, string? Weeks, string? Section, string Raw);
internal record DayInfo(int DayOfWeek, string Label);
internal record ParseResult(string Sheet, List<DayInfo> Days, List<Slot> Slots, List<string> Conflicts);
