# Excel 转 JSON（以课表为例）：纯前端 TS/JS 与 .NET 后端都能做

> 结论先行：**能，两边都能，而且都不依赖 Office / COM 组件。**
> 决定因素不是"能不能解析"，而是：文件从哪来、多大、要不要可信校验、要不要离线。
> 课表这类表格真正的难点是**合并单元格**，不是选库。

---

## 1. 两条路线怎么选

| 维度 | 纯前端（浏览器 / uni-app / 小程序） | 后端 .NET |
| --- | --- | --- |
| 解析位置 | 用户设备，选完文件立刻出结果 | 服务器，先上传再解析 |
| 上手成本 | 最低：一个 `<input type="file">` + 一个 npm 包 | 中：要建 Controller / 上传接口 |
| 隐私 | 文件不出本机（适合"课表"这种个人数据） | 文件要上传，得考虑留存与清理 |
| 可信度 | 不可信：用户可以改 JSON 再提交 | 可信：入库前统一校验 |
| 大文件 / 批量 | 受设备内存和主线程影响，需 Web Worker | 稳定，可流式、可队列 |
| 微信小程序 | 主包 2MB 限制，库要挑小的；文件用 `wx.chooseMessageFile` | 小程序 `wx.uploadFile`，逻辑全在服务端，最省事 |
| 老旧 `.xls` | SheetJS 可以，ExcelJS 不行 | NPOI / ExcelDataReader 可以 |
| 离线可用 | 可以（PWA / 本地缓存） | 不行 |

**建议**
- 一次性、"导入我的课表"这种个人操作 → **纯前端**，解析完直接进本地 Store。
- 多人共享、要存库、要按班级/学期查询、要做冲突校验 → **后端**。本仓库（.NET 10 `api/` + 小程序）更适合放后端，主包也不用背解析库。

---

## 2. 纯前端 TS/JS

### 2.1 选库

| 库 | 许可 | 读 | 写 | 说明 |
| --- | --- | --- | --- | --- |
| **xlsx / SheetJS 0.20.3** | Apache-2.0 | xls/xlsx/xlsm/ods/csv | ✅ | 格式覆盖最全，浏览器 + 小程序都能跑；**课表首选** |
| exceljs | MIT | xlsx | ✅ 带样式、流式 | 体积大、浏览器要用 buffer polyfill；不支持 `.xls` |
| read-excel-file | MIT | xlsx | ❌ | 很小，按表头直接转 `[{...}]`，适合规整表格 |
| @e965/xlsx | Apache-2.0 | 同上 | ✅ | SheetJS 0.20.3 的 npm 镜像 |

> ⚠️ **别直接 `npm i xlsx`**：npm registry 上的 `xlsx` 冻结在 **0.18.5**（SheetJS 已迁到官方 CDN），该版本有已知漏洞
> （CVE-2023-30533 原型污染、CVE-2024-22363 ReDoS，分别在 0.19.3 / 0.20.2 修复）。
> 正确装法（本项目已验证）：
> ```bash
> npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
> # 或
> npm i @e965/xlsx   # 0.20.3
> ```

### 2.2 浏览器里最短路径

```ts
import * as XLSX from 'xlsx';

const file = (e.target as HTMLInputElement).files![0];
const buf = await file.arrayBuffer();                 // ← 浏览器给的是 ArrayBuffer
const wb = XLSX.read(buf, { type: 'array' });         // 也可以用 Uint8Array
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
  header: 1,     // 输出二维数组，而不是按表头转对象
  raw: false,    // 用"显示文本"：避免 第3-4节 被转成日期、A101 被转成数字
  defval: '',    // 空单元格补 ''，行长度对齐
});
```

- 大文件（> 几 MB）放到 **Web Worker** 里解析，主线程只收 JSON，避免界面卡死。
- `raw: false` + `cellDates: false` 能躲掉 80% 的"数字/日期被改坏"问题。

### 2.3 uni-app / 微信小程序

```ts
// #ifdef MP-WEIXIN
wx.chooseMessageFile({
  count: 1, type: 'file', extension: ['xlsx', 'xls'],
  success: (res) => {
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: res.tempFiles[0].path,
      success: (r) => parseTimetable(new Uint8Array(r.data as ArrayBuffer)),
    });
  },
});
// #endif
// H5 / App 用 <input type="file"> 或 uni.chooseFile（仅 H5/App）
```

小程序没有 DOM，**不要把 SheetJS 和 Vue 的解析逻辑混在一起**，解析函数应是纯 `(Uint8Array) => JSON`；
另外小程序主包只有 2MB，SheetJS 打包后几百 KB，能放但要注意体积。

---

## 3. 后端 .NET（.NET 10 已验证）

### 3.1 选库

| 库 | 许可 | 读 | 写 | 适用 |
| --- | --- | --- | --- | --- |
| **NPOI 2.7** | Apache-2.0 | xls + xlsx | ✅ | **本项目 demo 用这个**：教务系统导出的 BIFF `.xls` 只能靠它，合并区 `sheet.MergedRegions` |
| **ClosedXML 0.105** | MIT | xlsx（不支持 `.xls`） | ✅ | xlsx-only 时 API 最直观：`ws.MergedRanges` 直接拿合并区 |
| MiniExcel | Apache-2.0 | xlsx | ✅ | 低内存流式，`MiniExcel.Query<T>(path)` 直接映射强类型；合并单元格支持弱 |
| ExcelDataReader | MIT | xls/xlsx/csv | ❌ | 只读、轻量，适合纯导入 |
| EPPlus | Polyform Noncommercial | xlsx | ✅ | ⚠️ 5.x 起商业用途需购买 license |
| CsvHelper | MS-PL/Apache | csv | ✅ | 能要用户导 CSV 的话，这是最省事的方案 |

```bash
dotnet add package NPOI      # 2.7.x，xls/xlsx 通吃（demo 用这个）
dotnet add package ClosedXML # 0.105.x，只支持 xlsx
```

### 3.2 上传接口的形状

```csharp
[HttpPost("api/timetable/import")]
[RequestSizeLimit(10 * 1024 * 1024)]           // 限 10MB，防 zip 炸弹
public async Task<IActionResult> Import(IFormFile file, CancellationToken ct)
{
    if (file is null || file.Length == 0) return BadRequest("文件为空");
    await using var stream = file.OpenReadStream();
    var slots = TimetableParser.Parse(stream);   // 与前端同一套规则
    return Ok(new { count = slots.Count, slots }); // 前端拿 JSON 直接渲染
}
```

解析函数就是 `tools/excel2json-net/Program.cs` 里的逻辑（见第 5 节），把它抽成 `TimetableParser` 即可。

> 想让前端直接下载 JSON / 入库都行：解析完在服务端做冲突检测、归一化，再返回统一结构，
> 前端不用关心 Excel 细节。

---

## 4. 课表场景的真正难点（按踩坑概率排序）

### 4.0 先认清两种真实形态

**A. 通用横排**（本项目的 sample-timetable.xlsx）
```
          星期一    星期二    星期三 …
1-2节     高数      线性代数  程序设计
          A101               机房301
          张伟               陈静
3-4节     ...
```

**B. 教务系统竖排**（正方 / 强智导出，常为 `.xls`，本项目的 real-timetable.xls）
```
        [标题行] 2025-2026年第1学期 | 25专升本学前教育6班课表 | 专业：…
        节次 |        | 星期一 | 星期二 | 星期三 | …
上午     一   | … | 教育见习I/CB21500008/(1-1节)8周/成都校区 外出/唐金金/…
        二   | … | 同上 (2-2节)
        三   | … | 教育见习I…(3-3节) + 幼儿园课程设计与实施/BB10403017/(3-3节)…
下午     五   | …
晚上     九   | …
        [说明行] 注--内容顺序为：课程<>课程号<>周次<>校区<>地点<>教师<>…
```
特征：**大节列 + 中文小节列（一…十二）**、一个单元格用 `\n` 叠多门课、
字段用 `/` 分隔且第 3 段带 `(x-y节)` 周次信息。解析时必须：
- 选"中文小节列"当节次（而不是大节列）；
- 拆 `/` 字段并处理一格里多门课；
- 相邻同门课合并成一段；
- 排除横跨整行的标题/说明行（否则会被当成 7 门课）。


1. **合并单元格（90% 的坑）**
   一门课占 2 节时，Excel 里是一个纵向合并的格子：文本只在左上角，覆盖的格子读出来是空。
   直接遍历 → 只拿到 1 条记录且节次算错；必须先把 `!merges` / `MergedRanges` 展开成完整网格，
   再用"合并区左上角"判断哪些是真正的一门课，并用合并区的起止行算 `periodStart/periodEnd`。
2. **单元格内多行文本**：常见约定 `第一行=课程`、`第二行=地点`、`第三行=教师`，按 `\n` 拆；
   也可能拆成三列（课程/地点/教师），那就按列映射，别写死。
3. **节次列也合并了**（"1-2节"跨两行）：需要**向下填充**才能把行号映射成节次；
   课程跨两个 2 节块（如"5-8节"）时，节次起点/终点要取合并区的首行和末行。
4. **表头不在第 1 行**：前面常有"XX大学 2026 春季学期课表"标题行 → 动态探测第一行中出现 ≥2 个"星期X"的行。
5. **周次信息**（1-16周 / 单双周 / 1-8周）：通常混在课程名里或单独列；JSON 里建议加 `weeks` 字段，
   不要等到渲染时再字符串解析。
6. **数字与格式陷阱**：`3-2` 被识别成日期、`A101` 变成 `101`、`周六` 变整数 → 一律读"显示文本"
   （SheetJS `raw:false`、ClosedXML `GetString()`）。
7. **旧 `.xls` / 加密文件 / 受保护工作表**：教务系统导出常是 BIFF `.xls`；
   ExcelJS 不支持，前端用 SheetJS、后端用 NPOI。有密码的 `.xls` 前端基本无解，建议让用户另存为 xlsx。
8. **颜色/加粗表示课程类型**（实验、体育、选修）：纯文本解析拿不到，需要读单元格样式；
   如果业务需要，用 ClosedXML `cell.Style.Fill` / NPOI 的 `CellStyle` 判断。
9. **多工作表**（每班/每学期一个 sheet）：按 sheet 名解析，别默认第 1 张。
10. **隐藏行列、空行**：`sheet_to_json` 的 `blankrows`、ClosedXML 的 `RangeUsed()` 都要注意。
11. **使用区边界 ≠ 合并区边界**（实测踩到）：当最后一行/列**只被合并单元格覆盖**、没有独立单元格时，
    `ws.RangeUsed()`（ClosedXML）或 `!ref`（SheetJS）会少算一行/一列，展开合并时就数组越界。
    正确做法：网格边界取 **使用区 ∪ 所有合并区** 的并集。

---

## 5. 建议的 JSON 结构

不要直接输出"二维数组"给业务层，归一化成记录：

```json
{
  "sheet": "Sheet0",
  "days": [{ "dayOfWeek": 1, "label": "星期一" }],
  "slots": [
    {
      "dayOfWeek": 3,
      "dayLabel": "星期三",
      "periodStart": 1,
      "periodEnd": 8,
      "course": "教育见习I",
      "code": "CB21500008",
      "teacher": "唐金金",
      "location": "外出",
      "weeks": "8周",
      "section": "上午",
      "raw": "教育见习I/CB21500008/(1-1节)8周/成都校区 外出/唐金金/(2025-2026-1)-CB21500008-06/17/1"
    }
  ],
  "conflicts": []
}
```

- 通用格式没有 `code` / `weeks` / `section` 字段（可选字段按需出现），所以前端渲染列是**动态**的。
- `weeks` 保留原文，因为「1-3周,6周,9-17周」「1-17周(单)」这类写法各校不同，
  真正要判断学期内某周上不上课时再调 `parseWeeks()` 解析成周次集合。

同时保留展开后的 `grid`（二维文本数组）方便前端"原样预览 + 高亮识别错的行"，
用户点确认后再存库——纯前端方案尤其需要这个"预览再保存"的步骤。

---

## 6. 本仓库里可直接跑的实验

```bash
# 前端（Node 24 原生跑 .ts，无需编译）
cd tools/excel2json
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
node src/demo.ts
# → 生成 sample-timetable.xlsx（含纵向合并、跨块合并、多行单元格）
# → 生成 timetable.json（8 条课时记录，含冲突检测）

# 真实课表（教务系统导出的 .xls，文件在 tools/excel2json/real-timetable.xls）
node src/demo.ts real-timetable.xls
dotnet run --project tools/excel2json-net -- tools/excel2json/real-timetable.xls
# → 控制台输出同一份 JSON（17 条课时 / 7 个星期列 / 0 误报冲突）

# 后端 .NET 10
dotnet run --project tools/excel2json-net -- tools/excel2json/sample-timetable.xlsx
# → 控制台输出同一份 JSON，并写入 tools/excel2json/timetable.dotnet.json
```

两个实现解析的是同一张表，输出字段完全一致，可以互相校验。
本机实测（两套实现逐字段比对相等）：
- 通用样例：两端都是 **8 条课时 / 0 冲突**（`node` v24 原生跑 `.ts`；`.NET` 10 + NPOI 2.7.5）
- 教务系统 `.xls`：两端都是 **17 条课时 / 0 冲突**，`slots` 完全一致

> 为什么 .NET 用 NPOI 而不是 ClosedXML：教务系统导出的 `.xls` 是 BIFF 老格式，ClosedXML 打不开。
> 这里刻意锁 **NPOI 2.7.5**（Apache-2.0）；2.8+ 引入了 OSMF EULA（商业使用需接受维护费条款），
> 个人/学习项目无所谓，但公司项目请自行评估。

> .NET 端记得 `PropertyNamingPolicy = JsonNamingPolicy.CamelCase`，否则默认输出 PascalCase，和前端对不上。

---

## 7. 安全与工程注意

- **xlsx 本质是 zip**：限制上传大小（如 10MB）和解压后大小/单元格数量，防 zip 炸弹。
- **不要把客户端解析结果当权威数据**入库；服务端至少重算一遍或在提交时做结构校验。
- 解析在服务端时，避免用 npm `xlsx@0.18.5` 那套老代码处理不可信文件（见 2.1 的 CVE）。
- 导回 Excel/CSV 时防公式注入：以 `= + - @` 开头的文本前加 `'`。
- 用户表格可能没有"星期"表头（如只有日期列）→ 解析器要给出明确报错，而不是静默产出错误数据。

---

## 8. 浏览器 demo（局域网可访问）

`tools/excel2json/web/` 是打包好的纯前端页面，不依赖后端：

- 打开页面自动加载 **真实教务系统课表**（`real-timetable.xls`，17 条课时）；没有该文件时自动退回内置样例
- 两个演示按钮：`试试样例课表`（通用横排，8 条）、`试试教务系统课表`（竖排 .xls，17 条）
- 还有一块 **「兜底：直接粘贴文字」** 面板：从网页/文档里复制出来的表格文字可以直接解析
- 支持点击 / 拖拽上传自己的 `.xlsx` / `.xls` / `.csv`
- **不内置 PDF 解析**，原因见第 10 节
- 展示三块内容：归一化课时表（教务系统格式会自动多出「大节 / 周次」列）、JSON（复制 / 下载）、
  **展开合并单元格后的网格**（直观看到解析依据）
- 打包：`npm run build:web`（esbuild，产物 `web/app.js` ≈ 377KB，只含 SheetJS）
- 起服务：`./serve.sh [端口]` 或 `npm run serve`（默认 **8899**，监听 `0.0.0.0`）
- 烟测：`npm test`（jsdom 里真实执行 app.js，断言 Excel 两种格式、粘贴解析、页面渲染）
- 局域网：`http://<手机局域网IP>:8899/`，例如 `http://192.168.77.125:8899/`


> 注：本机 8080 / 8090 已被其它服务占用（如 whodb、其他预览服务），所以 demo 用 8899。
> 局域网 http 不是安全上下文，页面里的「复制」已自动降级为 `execCommand` 方案。

---

## 9. 对比 MarkItDown（microsoft/markitdown）：要不要用它？

**一句话：它不是 `Excel → JSON` 工具，而是 `各种文档 → Markdown` 工具（给 LLM 读的）。**
课表这种要保留"星期 × 节次"结构的数据，MarkItDown 反而更难用、也更慢。

### 9.1 它内部怎么处理 Excel（看源码）

```python
# packages/markitdown/src/markitdown/converters/_xlsx_converter.py
sheets = pd.read_excel(file_stream, sheet_name=None, engine="openpyxl")   # .xlsx
sheets = pd.read_excel(file_stream, sheet_name=None, engine="xlrd")        # .xls
md_content += f"## {s}\n" + html_to_markdown(sheets[s].to_html(index=False))
```

即：**pandas 读表 → DataFrame 转 HTML → HTML 转 Markdown**。它不返回 JSON，
也**不处理合并单元格**（pandas 只在合并区左上角有值，其余是 `NaN`）。

### 9.2 本机实测（同一张 16KB 课表 real-timetable.xls）

| 方案 | CLI 单文件墙钟 | 进程内热路径 | 输出 |
| --- | --- | --- | --- |
| SheetJS（Node / 浏览器，本项目） | **0.41 s** | **~3 ms** | 结构化 JSON（17 条） |
| NPOI（.NET，本项目） | **0.61 s**（.NET 冷启动 JIT 占大头） | NPOI 读表 **~2 ms** | 结构化 JSON（17 条） |
| **MarkItDown** | **1.0 s** | **~36 ms**（只到 Markdown） | 一份 Markdown 表格，还得再解析 |

依赖体积：SheetJS 7.8MB（浏览器包 370KB）／NPOI 输出 19MB／
**Python 路线：pandas 92MB + onnxruntime 34MB + magika 3.4MB + … ≈ 130MB+**。

### 9.3 实际输出质量（原样摘录，见 `real-timetable.markitdown.md`）

```
## Sheet0
| 2025-2026年第1学期 | 2025-2026年第1学期.1 | … | 25专升本学前教育6班课表 | … |
| 节次 | NaN | 星期一 | 星期二 | 星期三 | 星期四 | 星期五 | 星期六 | 星期日 |
| 上午 | 一 | NaN | NaN | 教育见习I/CB21500008/(1-1节)8周/… |
| NaN  | 二 | NaN | NaN | 教育见习I/…                                    |
```

问题一目了然：
1. **表头错位**：pandas 把第 1 行"标题行"当表头，真正的"节次/星期一…"变成第一行数据；
2. **合并单元格丢失**：`上午` 只在第一行出现，后 3 行是 `NaN`——"上午覆盖 1-4 节"这个信息没了；
3. **多行单元格塞进表格**：格内 `\r\n` 保留为原始换行，Markdown 表格会被截断/错行；
4. 没有 `weeks` / `section` 字段，课程/教室/教师/周次全挤在一个长字符串里；
5. 没有 JSON 输出，要结构化还得再写一层 Markdown 表格解析——**比直接解析 Excel 更难**，因为合并信息已丢失。

### 9.4 那什么时候该用 MarkItDown？

- **要把一堆不同格式的文档喂给 LLM / 做 RAG**（PDF 培养方案、DOCX 教学大纲、PPT、图片、HTML）：
  一个 API 全转 Markdown，这是它的主场；
- **课表本身是 PDF / 扫描件 / 截图**：需要 PDF 解析或 OCR，这时 MarkItDown（或 Azure Content Understanding）才有意义；
- 只是"肉眼快速看表格内容"。

反过来说，课表是 Excel 且要落库/渲染时：**直接用 SheetJS / NPOI 解析更快也更准**，
不需要为了 Markdown 再引一个 Python 运行时（在 TS/.NET 项目里等于加第三个技术栈 + 130MB 依赖 + 进程间通信）。

---

## 10. 为什么不内置 PDF 解析

试过一轮（pdfjs 抽文字 + 框线 → 复用 `parseGrid()`），最后从 demo 里移除了，原因：

1. **PDF 没有表格结构**，只有"画在某个坐标上的字"。表格重建只能靠启发式（框线/对齐），
   换个教务系统导出的 PDF，版式就变一次，维护成本高。
2. **很多中文 PDF 的文字层根本读不出来**。比如 `蒲程超(2026-2027-一)课表.pdf`：
   - 用的是**非嵌入**标准字体 `STSong-Light` + 预定义 CMap `UniGB-UCS2-H`
   - 没有 `/ToUnicode` 映射
   - 结果：pdf.js 抽不到文字（我们实测 2 页都是 0 个文字块）；阅读器里"复制"出来也是乱码
   - 这不是解析器的问题，是这份 PDF 没有可被程序使用的文本映射
3. **补救手段只有两个**：OCR（扫描件式处理），或者向教务系统要原始 Excel/CSV。
   OCR 之后仍然要做一次表格结构重建，对"一学期看一次"的课表来说投入产出比很低。

所以现在的策略是：

- **课表来源优先要 Excel / CSV**（本项目的主路径，前端 + .NET 都可直接解析）
- 只有**文本型、字体正常**的 PDF 才值得写解析；这属于一次性需求，用 Python 的
  `pdfplumber` / `pdfminer.six` 先验证能不能抽到文字，再决定要不要做成服务
- 前端提供 **「粘贴文字」兜底**：从网页/正常 PDF 里框选复制出来的表格可以直接粘进来解析
  （见 `src/paste-timetable.ts`，支持 Tab 分列、空格对齐、一行一节课）

> 如果哪天拿到一份"文字能正常选中复制"的 PDF，想再试试，跟我说一声，
> 把 pdfjs 那套加回来很快（代码在 git 历史里）。
