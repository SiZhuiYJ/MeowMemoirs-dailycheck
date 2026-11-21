using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace api.Infrastructure;

/// <summary>
/// 课表图片 / PDF 兜底识别（OCR）。
///
/// 流程：PDF → pdftoppm 渲染成 PNG（每页 300dpi）→ tesseract（chi_sim+eng, psm 6）输出 TSV
///      → 按文字框坐标重建二维网格 → 复用 <see cref="TimetableExcelParser.ParseGrid"/> 归一化。
///
/// 依赖服务器上有 poppler（pdftoppm）和 tesseract（含 chi_sim 语言包）：
///   pkg install poppler tesseract poppler-data
///   curl -L -o $PREFIX/share/tessdata/chi_sim.traineddata \
///     https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/chi_sim.traineddata
///
/// 只做「兜底」：OCR 一定有错字，结果交给前端预检让用户核对后再入库。
/// </summary>
public static class TimetableOcr
{
    const int RenderDpi = 300;
    const int MaxPages = 5;
    static readonly TimeSpan PageTimeout = TimeSpan.FromSeconds(120);

    /// <summary>调试用：最近一次 OCR 的工作目录（KEEP_OCR_TEMP=1 时不会删除）。</summary>
    public static string? LastWorkDir { get; private set; }

    static readonly Regex DayRegex = new(@"星期\s*([一二三四五六日天])", RegexOptions.Compiled);
    static readonly Regex CjkRegex = new(@"[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]", RegexOptions.Compiled);

    /// <summary>识别图片 / PDF 课表。extension 为小写扩展名（含点）。</summary>
    public static async Task<ParsedTimetable> ParseAsync(string filePath, string extension)
    {
        var work = Path.Combine(Path.GetTempPath(), "timetable-ocr-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        LastWorkDir = work;
        try
        {
            var pageImages = new List<string>();
            if (extension == ".pdf")
            {
                var pattern = Path.Combine(work, "page");
                var result = await RunAsync("pdftoppm",
                    $"-r {RenderDpi} -png -f 1 -l {MaxPages} \"{filePath}\" \"{pattern}\"", PageTimeout);
                if (result.ExitCode != 0)
                    throw new InvalidOperationException("PDF 渲染失败：" + Short(result.StdErr));
                pageImages.AddRange(Directory.GetFiles(work, "page*.png").OrderBy(p => p, StringComparer.Ordinal));
            }
            else
            {
                pageImages.Add(filePath);
            }

            if (pageImages.Count == 0)
                throw new InvalidOperationException("文件里没有可识别的页面（扫描件或空 PDF？）");

            var perPage = new List<ParsedTimetable>();
            var notes = new List<string>();
            foreach (var image in pageImages)
            {
                try
                {
                    var cleaned = await PreprocessAsync(image, work);
                    var lines = await OcrLinesAsync(cleaned, work);
                    if (lines.Count < 5)
                    {
                        notes.Add($"{Path.GetFileName(image)}: 只识别到 {lines.Count} 行文字");
                        continue;
                    }
                    var grid = BuildGrid(lines);
                    perPage.Add(TimetableExcelParser.ParseGrid(grid));
                }
                catch (Exception ex)
                {
                    notes.Add($"{Path.GetFileName(image)}: {ex.Message}");
                }
            }

            if (perPage.Count == 0)
                throw new InvalidOperationException("没有识别出课表" +
                    (notes.Count > 0 ? "（" + string.Join("；", notes) + "）" : ""));

            return MergePages(perPage);
        }
        finally
        {
            if (Environment.GetEnvironmentVariable("KEEP_OCR_TEMP") != "1")
            {
                try { Directory.Delete(work, true); } catch { /* 清理失败无所谓 */ }
            }
        }
    }

    /// <summary>多页合并：拼 slots / 去重 / 取最大节次。</summary>
    static ParsedTimetable MergePages(List<ParsedTimetable> pages)
    {
        var first = pages[0];
        var seen = new HashSet<string>();
        var slots = new List<ParsedSlot>();
        foreach (var page in pages)
        {
            foreach (var slot in page.Slots)
            {
                var key = string.Join('\u0001', slot.DayOfWeek, slot.PeriodStart, slot.PeriodEnd,
                    slot.Course, slot.Weeks ?? "");
                if (seen.Add(key)) slots.Add(slot);
            }
        }
        slots = slots
            .OrderBy(s => s.DayOfWeek)
            .ThenBy(s => s.PeriodStart)
            .ThenBy(s => s.Course, StringComparer.Ordinal)
            .ToList();
        var maxSection = slots.Count == 0 ? 0 : slots.Max(s => s.PeriodEnd);
        return first with { Slots = slots, MaxSection = maxSection };
    }

    // ---------- tesseract ----------
    public sealed record OcrWord(string Text, double Left, double Top, double Width, double Height)
    {
        public double CenterX => Left + Width / 2;
        public double CenterY => Top + Height / 2;
    }

    /// <summary>
    /// 预处理：灰度阈值 + 去掉表格线。
    ///
    /// tesseract 对穿过文字的表格线很敏感（会把「星期一」切成「星期」+ 噪声），
    /// 这里把「一行/一列里暗像素超过 50%」的直线擦成白色，再交给 tesseract；
    /// 不依赖 OpenCV，只用项目已有的 ImageSharp。
    /// </summary>
    static async Task<string> PreprocessAsync(string imagePath, string workDir)
    {
        using var image = await Image.LoadAsync<Rgba32>(imagePath);
        var width = image.Width;
        var height = image.Height;
        if (width < 50 || height < 50) return imagePath;

        var darkRows = new int[height];
        var darkCols = new int[width];
        image.ProcessPixelRows(accessor =>
        {
            for (var y = 0; y < height; y++)
            {
                var row = accessor.GetRowSpan(y);
                var count = 0;
                foreach (var pixel in row)
                    if (IsDark(pixel)) count++;
                darkRows[y] = count;
                // 同一行里顺便累计列
                for (var x = 0; x < width; x++)
                    if (IsDark(row[x])) darkCols[x]++;
            }
        });

        var lineRows = new List<int>();
        for (var y = 0; y < height; y++)
            if (darkRows[y] > width * 0.5) lineRows.Add(y);
        var lineCols = new List<int>();
        for (var x = 0; x < width; x++)
            if (darkCols[x] > height * 0.5) lineCols.Add(x);

        if (lineRows.Count == 0 && lineCols.Count == 0) return imagePath;

        var white = new Rgba32(255, 255, 255);
        image.ProcessPixelRows(accessor =>
        {
            foreach (var y in lineRows)
            {
                for (var dy = -2; dy <= 2; dy++)
                {
                    var yy = y + dy;
                    if (yy < 0 || yy >= height) continue;
                    accessor.GetRowSpan(yy).Fill(white);
                }
            }
            if (lineCols.Count > 0)
            {
                for (var y = 0; y < height; y++)
                {
                    var row = accessor.GetRowSpan(y);
                    foreach (var x in lineCols)
                    {
                        for (var dx = -2; dx <= 2; dx++)
                        {
                            var xx = x + dx;
                            if (xx >= 0 && xx < width) row[xx] = white;
                        }
                    }
                }
            }
        });

        var cleaned = Path.Combine(workDir, Path.GetFileNameWithoutExtension(imagePath) + ".clean.png");
        await image.SaveAsPngAsync(cleaned);
        return cleaned;
    }

    static bool IsDark(Rgba32 pixel)
    {
        var luminance = 0.299 * pixel.R + 0.587 * pixel.G + 0.114 * pixel.B;
        return luminance < 170;
    }

    /// <summary>OCR 的一行文字（同一 tesseract line_num 的 word 集合）</summary>
    public sealed record OcrLine(List<OcrWord> Words)
    {
        public double Top => Words.Min(w => w.Top);
        public double Bottom => Words.Max(w => w.Top + w.Height);
        public double CenterY => (Top + Bottom) / 2;
        public string Text => string.Join(" ", Words.Select(w => w.Text));
    }

    static async Task<List<OcrLine>> OcrLinesAsync(string imagePath, string workDir)
    {
        var baseName = Path.Combine(workDir, Path.GetFileNameWithoutExtension(imagePath));
        var tsvPath = baseName + ".tsv";
        var result = await RunAsync("tesseract",
            $"\"{imagePath}\" \"{baseName}\" -l chi_sim+eng --psm 6 tsv", PageTimeout);
        if (result.ExitCode != 0)
        {
            var message = Short(result.StdErr);
            if (message.Contains("Failed loading language") || message.Contains("chi_sim"))
                throw new InvalidOperationException("服务器缺少 tesseract 中文语言包（chi_sim）");
            if (message.Contains("not found") || message.Contains("No such file"))
                throw new InvalidOperationException("服务器未安装 tesseract / poppler，无法 OCR");
            throw new InvalidOperationException("OCR 失败：" + message);
        }
        if (!File.Exists(tsvPath)) throw new InvalidOperationException("OCR 没有输出结果");

        var groups = new SortedDictionary<(int block, int par, int line), List<OcrWord>>();
        foreach (var raw in File.ReadLines(tsvPath).Skip(1))
        {
            var cols = raw.Split('\t');
            if (cols.Length < 12 || cols[0] != "5") continue; // level 5 = word
            var text = cols[11].Trim();
            if (text.Length == 0) continue;
            if (!int.TryParse(cols[2], out var block)) continue;
            if (!int.TryParse(cols[3], out var par)) continue;
            if (!int.TryParse(cols[4], out var line)) continue;
            // TSV 列：0 level, 1 page, 2 block, 3 par, 4 line, 5 word, 6 left, 7 top, 8 width, 9 height, 10 conf, 11 text
            if (!double.TryParse(cols[6], NumberStyles.Float, CultureInfo.InvariantCulture, out var left)) continue;
            if (!double.TryParse(cols[7], NumberStyles.Float, CultureInfo.InvariantCulture, out var top)) continue;
            if (!double.TryParse(cols[8], NumberStyles.Float, CultureInfo.InvariantCulture, out var width)) continue;
            if (!double.TryParse(cols[9], NumberStyles.Float, CultureInfo.InvariantCulture, out var height)) continue;
            var key = (block, par, line);
            if (!groups.TryGetValue(key, out var list)) groups[key] = list = new List<OcrWord>();
            list.Add(new OcrWord(text, left, top, Math.Max(width, 1), Math.Max(height, 1)));
        }

        // tesseract 的 line 分组顺序不一定按 y：按行内最小 top 重新排序
        return groups.Values
            .Select(words => new OcrLine(words))
            .OrderBy(line => line.Top)
            .ToList();
    }

    // ---------- 文字框 → 网格 ----------
    sealed record Token(string Text, double Left, double Top, double Width, double Height)
    {
        public double CenterX => Left + Width / 2;
        public double CenterY => Top + Height / 2;
        public double Right => Left + Width;
        public double Bottom => Top + Height;
    }

    /// <summary>OCR 行 → 二维网格（第 0 行是表头或标题行；之后每个节次一行）。</summary>
    public static string[,] BuildGrid(List<OcrLine> lines)
    {
        if (lines.Count == 0) throw new InvalidOperationException("没有识别到文字");

        // 1. 每行把相邻字符合并成 token（tesseract 中文常按单字输出）
        var lineTokens = lines.Select(line => MergeTokens(line.Words)).ToList();

        // 2. 找表头：包含「星期X」最多的那一行
        var headerIndex = -1;
        List<Token>? headerTokens = null;
        for (var i = 0; i < lineTokens.Count; i++)
        {
            var dayCount = lineTokens[i].Count(t => DayRegex.IsMatch(t.Text));
            if (headerIndex < 0 || dayCount > headerTokens!.Count(t => DayRegex.IsMatch(t.Text)))
            {
                if (dayCount >= 2)
                {
                    headerIndex = i;
                    headerTokens = lineTokens[i];
                }
            }
        }
        if (headerIndex < 0 || headerTokens is null)
            throw new InvalidOperationException("识别不到「星期一…星期日」表头，请换一张更清晰的课表截图");

        var dayCols = headerTokens
            .Select(t => (token: t, day: DayOf(t.Text)))
            .Where(x => x.day > 0)
            .OrderBy(x => x.token.CenterX)
            .ToList();
        if (dayCols.Count < 2) throw new InvalidOperationException("表头里的星期列太少");

        var dayCenters = dayCols.Select(x => x.token.CenterX).ToList();
        var spacing = Median(dayCenters.Zip(dayCenters.Skip(1), (a, b) => b - a).ToList());
        if (spacing <= 0) throw new InvalidOperationException("表头列间距异常");
        var tableLeft = dayCenters[0] - spacing / 2;

        // 3. 表头之后的每行，提取「节次」（左侧列里能解析成 1..30 的数字）
        var bodyLines = Enumerable.Range(headerIndex + 1, lineTokens.Count - headerIndex - 1)
            .Select(i => new { Index = i, Tokens = lineTokens[i], Line = lines[i] })
            .ToList();

        var anchors = new List<(double centerY, string label)>();
        foreach (var body in bodyLines)
        {
            var leftTokens = body.Tokens.Where(t => t.CenterX < tableLeft).ToList();
            var period = leftTokens.FirstOrDefault(t => ParsePeriodText(t.Text) is not null);
            if (period is not null)
                anchors.Add((body.Line.CenterY, period.Text.Trim()));
        }
        if (anchors.Count < 2)
            throw new InvalidOperationException("识别不到节次列（1、2、3…），请让截图包含完整的节次列");

        // 4. 行带：相邻锚点取中点；表头到第一个锚点之间也归第一行
        var headerBottom = headerTokens.Max(t => t.Bottom);
        var bands = new List<(double top, double bottom)>();
        for (var i = 0; i < anchors.Count; i++)
        {
            var top = i == 0 ? (headerBottom + anchors[0].centerY) / 2 : (anchors[i - 1].centerY + anchors[i].centerY) / 2;
            var bottom = i == anchors.Count - 1
                ? anchors[^1].centerY + (anchors[^1].centerY - anchors[^2].centerY) / 2
                : (anchors[i].centerY + anchors[i + 1].centerY) / 2;
            bands.Add((top, bottom));
        }

        // 5. 网格：表头 + 标题行（表头之前的行塞进第 0 列），之后每个节次一行
        var preHeaderTexts = lineTokens.Take(headerIndex)
            .Select(tokens => JoinTokens(tokens))
            .Where(text => text.Length > 0)
            .ToList();
        var grid = new string[preHeaderTexts.Count + 1 + bands.Count, dayCols.Count + 1];
        for (var r = 0; r < grid.GetLength(0); r++)
            for (var c = 0; c < grid.GetLength(1); c++)
                grid[r, c] = "";

        for (var i = 0; i < preHeaderTexts.Count; i++) grid[i, 0] = preHeaderTexts[i];
        var headerRow = preHeaderTexts.Count;
        for (var i = 0; i < dayCols.Count; i++) grid[headerRow, i + 1] = "星期" + "一二三四五六日天"[dayCols[i].day - 1];

        // 6. 表头以下每一行文字落到对应的行带 + 天列；同一格多行文字用换行拼接
        var cellLines = new Dictionary<(int row, int col), List<string>>();
        foreach (var body in bodyLines)
        {
            var band = -1;
            for (var i = 0; i < bands.Count; i++)
            {
                if (body.Line.CenterY >= bands[i].top && body.Line.CenterY < bands[i].bottom) { band = i; break; }
            }
            if (band < 0) continue;

            for (var c = 0; c < dayCols.Count; c++)
            {
                var left = c == 0 ? tableLeft : (dayCenters[c - 1] + dayCenters[c]) / 2;
                var right = c == dayCols.Count - 1
                    ? dayCenters[^1] + spacing / 2
                    : (dayCenters[c] + dayCenters[c + 1]) / 2;
                var tokens = body.Tokens
                    .Where(t => t.CenterX >= left && t.CenterX < right)
                    .ToList();
                if (tokens.Count == 0) continue;
                var text = JoinTokens(tokens);
                if (text.Length == 0) continue;
                var key = (band, c);
                if (!cellLines.TryGetValue(key, out var list)) cellLines[key] = list = new List<string>();
                list.Add(text);
            }
        }

        for (var r = 0; r < bands.Count; r++) grid[headerRow + 1 + r, 0] = anchors[r].label;
        foreach (var ((r, c), texts) in cellLines)
            grid[headerRow + 1 + r, c + 1] = string.Join("\n", texts);

        return grid;
    }

    /// <summary>把一行里的字符合并成 token：中文单字间距很小，按最大字高做阈值。</summary>
    static List<Token> MergeTokens(List<OcrWord> words)
    {
        var tokens = new List<Token>();
        Token? current = null;
        foreach (var word in words.OrderBy(w => w.Left))
        {
            if (current is not null)
            {
                var gap = word.Left - current.Right;
                var maxGap = Math.Max(current.Height, word.Height) * 0.9;
                if (gap <= maxGap)
                {
                    current = current with
                    {
                        Text = current.Text + word.Text,
                        Width = Math.Max(current.Right, word.Left + word.Width) - current.Left,
                        Height = Math.Max(current.Height, word.Height),
                    };
                    continue;
                }
            }
            if (current is not null) tokens.Add(current);
            current = new Token(word.Text, word.Left, word.Top, word.Width, word.Height);
        }
        if (current is not null) tokens.Add(current);
        return tokens;
    }

    static string JoinTokens(List<Token> tokens)
    {
        var sb = new StringBuilder();
        Token? prev = null;
        foreach (var token in tokens.OrderBy(t => t.Left))
        {
            if (prev is not null)
            {
                var gap = token.Left - prev.Right;
                var noSpace = gap <= Math.Min(prev.Height, token.Height) * 0.6;
                var bothCjk = CjkRegex.IsMatch(prev.Text) && CjkRegex.IsMatch(token.Text);
                if (!noSpace && !bothCjk) sb.Append(' ');
            }
            sb.Append(token.Text);
            prev = token;
        }
        return sb.ToString().Trim();
    }

    static List<Token> FindPeriodColumn(List<Token> leftTokens)
    {
        if (leftTokens.Count == 0) return new List<Token>();
        // 按 x 中心聚类
        var sorted = leftTokens.OrderBy(t => t.CenterX).ToList();
        var medianH = Median(sorted.Select(t => t.Height).ToList());
        var clusters = new List<List<Token>>();
        foreach (var token in sorted)
        {
            var cluster = clusters.LastOrDefault();
            if (cluster is not null && token.CenterX - cluster[^1].CenterX <= medianH * 2.5) cluster.Add(token);
            else clusters.Add(new List<Token> { token });
        }
        List<Token>? best = null;
        var bestScore = 0.0;
        foreach (var cluster in clusters)
        {
            var parsed = cluster.Count(t => ParsePeriodText(t.Text) is not null);
            var score = (double)parsed / cluster.Count;
            if (parsed >= 2 && score > bestScore)
            {
                bestScore = score;
                best = cluster;
            }
        }
        return best ?? new List<Token>();
    }

    // ---------- 小工具 ----------
    static int DayOf(string text)
    {
        var m = DayRegex.Match(text);
        if (!m.Success) return 0;
        return "一二三四五六日天".IndexOf(m.Groups[1].Value) switch
        {
            0 => 1, 1 => 2, 2 => 3, 3 => 4, 4 => 5, 5 => 6, _ => 7,
        };
    }

    static (int start, int end)? ParsePeriodText(string text)
    {
        var m = Regex.Match(text, @"\d+");
        if (!m.Success) return null;
        var value = int.Parse(m.Value, CultureInfo.InvariantCulture);
        return value is >= 1 and <= 30 ? (value, value) : null;
    }

    static double Median(List<double> values)
    {
        if (values.Count == 0) return 0;
        var arr = values.OrderBy(v => v).ToList();
        return arr[arr.Count / 2];
    }

    static string Short(string text)
    {
        var line = text.Split('\n').FirstOrDefault(l => l.Trim().Length > 0) ?? "未知错误";
        return line.Trim().Length > 200 ? line.Trim()[..200] : line.Trim();
    }

    sealed record ProcessResult(int ExitCode, string StdOut, string StdErr);

    static async Task<ProcessResult> RunAsync(string fileName, string arguments, TimeSpan timeout)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        using var process = new Process { StartInfo = psi };
        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"无法启动 {fileName}：{ex.Message}");
        }
        var stdOut = process.StandardOutput.ReadToEndAsync();
        var stdErr = process.StandardError.ReadToEndAsync();
        var completed = await Task.Run(() => process.WaitForExit((int)timeout.TotalMilliseconds));
        if (!completed)
        {
            try { process.Kill(true); } catch { }
            throw new InvalidOperationException($"OCR 超时（{timeout.TotalSeconds:F0}s）");
        }
        return new ProcessResult(process.ExitCode, await stdOut, await stdErr);
    }
}
