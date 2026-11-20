/**
 * 课表 Excel → JSON 解析器（纯前端 TS，浏览器 / uni-app / Node 通用）
 *
 * 依赖：SheetJS（xlsx）。官方发布在 cdn.sheetjs.com，npm 上的 `xlsx` 停留在 0.18.5 且带已知漏洞：
 *   npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
 *
 * 支持两类常见课表：
 *   A. 通用横排课表：行 = 节次（"1-2节"），列 = 星期一…星期日，单元格内多行写 课程/地点/教师
 *   B. 教务系统导出（正方/强智等）：上方有标题行，列 = 星期一…星期日，
 *      "大节"列（上午/下午/晚上）+ "小节"列（一…十二），
 *      单元格为一条或多条 `课程/课程号/(x-y节)周次/校区 地点/教师/教学班/学时/学分`
 *
 * 设计要点：
 *   1. 输入是 ArrayBuffer / Uint8Array（浏览器 File.arrayBuffer() 直接给），也接受 CSV 文本。
 *   2. 合并单元格（!merges）先展开成完整网格，再用"合并区左上角"判断真实内容。
 *   3. 自动探测表头 / 节次列 / 大节列，不把列位置写死。
 *   4. 相邻的同门课自动合并成一段（1 节一行 → "3-8 节"）。
 */
import * as XLSX from 'xlsx';

export type PeriodField = 'course' | 'teacher' | 'location';

export interface CourseSlot {
  dayOfWeek: number; // 1=周一 … 7=周日
  dayLabel: string;
  periodStart: number;
  periodEnd: number;
  course: string;
  /** 课程号，教务系统格式才有 */
  code?: string;
  teacher?: string;
  location?: string;
  /** 周次原文，如 "1-4周,6-17周"、"8周" */
  weeks?: string;
  /** 大节：上午 / 下午 / 晚上（若表里有这一列） */
  section?: string;
  /** 单元格原文，排查脏数据用 */
  raw: string;
}

export interface ParseOptions {
  /** 节次列没有值的行直接跳过（PDF 表格用；Excel 里合并单元格需要向下填充，不能开） */
  strictPeriodRows?: boolean;
  /** 工作表名，默认第一张 */
  sheetName?: string;
  /** 表头行（0 起）。默认自动探测：第一行里出现 >=2 个"星期X" */
  headerRow?: number;
  /** 节次所在列（0 起）。默认自动探测；-1 = 没有节次列（按行号算节次） */
  periodColumn?: number;
  /** 多行单元格的字段顺序，默认 [课程, 地点, 教师]（通用格式用） */
  lineOrder?: PeriodField[];
  /** 没有节次列时，每一行算几节（默认 1） */
  periodsPerRow?: number;
}

export interface ParseResult {
  sheet: string;
  days: { dayOfWeek: number; label: string }[];
  slots: CourseSlot[];
  /** 展开合并单元格后的完整文本网格 */
  grid: string[][];
  /** 同一星期 + 同一节次（且周次有交集）被两门课占用 */
  conflicts: string[];
}

const DAY_MAP: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
};

const CN_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 把 "十二" 这类中文数字转成 12；不是纯中文数字就返回 0 */
export function cnToNumber(text: string): number {
  const s = text.trim();
  if (!s) return 0;
  if (s === '十') return 10;
  const idx = s.indexOf('十');
  if (idx >= 0) {
    const head = s.slice(0, idx);
    const tail = s.slice(idx + 1);
    const tens = head ? CN_DIGIT[head] ?? 0 : 1;
    const ones = tail ? CN_DIGIT[tail] ?? 0 : 0;
    return tens * 10 + ones;
  }
  return CN_DIGIT[s] ?? 0;
}

export function dayOfLabel(label: string): number {
  const m = label.match(/星期\s*([一二三四五六日天])/);
  if (m) return DAY_MAP[m[1]] ?? 0;
  const en = label.trim().slice(0, 3).toLowerCase();
  return DAY_MAP[en] ?? 0;
}

/** "1-2节" / "第3,4节" / "5" / "十二" → [start, end]；识别不了返回 null */
export function parsePeriodRange(label: string): [number, number] | null {
  const text = label.trim();
  if (!text) return null;
  const nums = text.match(/\d+/g)?.map(Number);
  if (nums && nums.length > 0) {
    const start = Math.min(...nums);
    const end = Math.max(...nums);
    // 表尾说明行常含年份数字（2025 等），一律不算节次
    if (start < 1 || end > 30) return null;
    return [start, end];
  }
  const cn = cnToNumber(text);
  if (cn >= 1 && cn <= 30) return [cn, cn];
  return null;
}

/** 把 !merges 展开：被合并的格子填入左上角的值
 *
 *  注意：合并区可能超出 !ref / sheet_to_json 的矩阵边界（整行只被合并覆盖时），
 *  所以先按「矩阵 ∪ 合并区」把矩阵补成矩形，再填充，避免 undefined 下标。
 */
function expandMerges(
  matrix: string[][],
  merges: XLSX.Range[] | undefined,
): string[][] {
  const list = merges ?? [];
  const maxR = Math.max(matrix.length - 1, ...list.map((m) => m.e.r), 0);
  const maxC = Math.max(
    ...matrix.map((row) => row.length - 1),
    ...list.map((m) => m.e.c),
    0,
  );
  const out: string[][] = [];
  for (let r = 0; r <= maxR; r++) {
    out.push(Array.from({ length: maxC + 1 }, (_, c) => matrix[r]?.[c] ?? ''));
  }
  for (const m of list) {
    const value = out[m.s.r][m.s.c];
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        out[r][c] = value;
      }
    }
  }
  return out;
}

/** 左上角坐标 → 它占据的合并区域 */
function mergeAt(merges: XLSX.Range[], r: number, c: number): XLSX.Range | null {
  return (
    merges.find((m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) ?? null
  );
}

export interface CellEntry {
  course: string;
  code?: string;
  teacher?: string;
  location?: string;
  weeks?: string;
  periodStart?: number;
  periodEnd?: number;
  raw: string;
}

/** 教务系统格式：课程/课程号/(x-y节)周次/校区 地点/教师/教学班/学时/学分 */
const SLASH_ENTRY_RE =
  /^(.+?)\s*\/\s*([A-Za-z]{1,4}\d{4,})\s*\/\s*(?:\((\d+)\s*-\s*(\d+)\s*节\))?\s*([^/]*)\s*\/\s*([^/]*)\s*\/\s*([^/]*)/;

/** 把单元格内容拆成一条或多条课程记录 */
export function parseCellEntries(
  raw: string,
  lineOrder: PeriodField[] = ['course', 'location', 'teacher'],
): CellEntry[] {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  // 教务系统格式：可能一个格子里叠了多门课（\n 分隔）
  // 教务系统格式：含分隔符 / 且出现了课程号（PDF 里折行可能让整段匹配失败，按行拼回再匹配）
  if (text.includes('/') && /[A-Za-z]{1,4}\d{4,}/.test(text)) {
    // 换行有两种含义：
    //   1. 一格多门课（每门课都以 "课程名/课程号/" 开头）
    //   2. 一门课在 PDF/窄列里被折行（续行不以 课程名/课程号/ 开头）
    // 先按"行首是不是新的课程"分组成完整的课程串，再把折行拼回去。
    const courseStart = /^[^/]+\/\s*[A-Za-z]{1,4}\d{4,}\s*\//;
    const groups: string[] = [];
    for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (groups.length === 0 || courseStart.test(line)) groups.push(line);
      else groups[groups.length - 1] += line; // 折行：直接拼回去
    }
    return groups.map((entry) => {
      const m = entry.match(SLASH_ENTRY_RE);
      if (!m) return { course: entry, raw: entry };
      const [, course, code, ps, pe, weeksRaw, campusLocation, teacher] = m;
      return {
        course: course.trim(),
        code,
        teacher: teacher.trim() || undefined,
        location: normalizeLocation(campusLocation),
        weeks: (weeksRaw ?? '').trim() || undefined,
        periodStart: ps ? Number(ps) : undefined,
        periodEnd: pe ? Number(pe) : undefined,
        raw: entry,
      };
    });
  }

  // 通用格式：单元格内多行 = 多个字段；也兼容单行 "课程/地点/教师"
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length === 1 && lines[0].includes('/')) {
    const parts = lines[0].split('/').map((s) => s.trim()).filter(Boolean);
    const fields: Partial<Record<PeriodField, string>> = {};
    lineOrder.forEach((field, i) => {
      if (parts[i]) fields[field] = parts[i];
    });
    return [{ course: parts[0] ?? lines[0], raw: text, ...fields }];
  }
  const fields: Partial<Record<PeriodField, string>> = {};
  lineOrder.forEach((field, i) => {
    if (lines[i]) fields[field] = lines[i];
  });
  return [{ course: lines[0], raw: text, ...fields }];
}

/** "成都校区 C107（音乐综合实训室）" → "C107（音乐综合实训室）" */
function normalizeLocation(value: string): string | undefined {
  const text = (value ?? '').trim();
  if (!text) return undefined;
  const stripped = text.replace(/^[\u4e00-\u9fa5]{2,8}校区\s*/, '').trim();
  return stripped || text;
}

/** "1-4周,6-17周" / "8周" / "1-3周,6周,9-17周(单)" → 周次集合；解析不了返回 null */
export function parseWeeks(weeks?: string): Set<number> | null {
  if (!weeks) return null;
  const text = weeks.replace(/周/g, '').replace(/\s/g, '');
  if (!text) return null;
  const set = new Set<number>();
  const re = /(\d+)(?:\s*-\s*(\d+))?\s*(?:\((单|双)\)|(单|双))?/g;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = re.exec(text))) {
    matched = true;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    const parity = m[3] ?? m[4];
    for (let w = a; w <= b; w++) {
      if (parity === '单' && w % 2 === 0) continue;
      if (parity === '双' && w % 2 === 1) continue;
      set.add(w);
    }
  }
  return matched && set.size > 0 ? set : null;
}

/** 自动选节次列：在"星期"列左侧，找出最像节次的那一列（支持 1-2节 / 一…十二） */
function autoPeriodColumn(
  grid: string[][],
  headerRow: number,
  firstCol: number,
  firstDayCol: number,
): number {
  let best = -1;
  let bestScore = 0;
  for (let c = firstCol; c < firstDayCol; c++) {
    let nonEmpty = 0;
    let parsed = 0;
    for (let r = headerRow + 1; r < grid.length; r++) {
      const v = (grid[r]?.[c] ?? '').trim();
      if (!v) continue;
      nonEmpty++;
      if (parsePeriodRange(v)) parsed++;
    }
    if (nonEmpty < 2) continue;
    const score = parsed / nonEmpty;
    // 分数相同取更靠右的列（一般是更具体的"小节"列）
    if (score >= bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.5 ? best : -1;
}

/** 相邻的同门课合并：1 节一行 → "3-8 节" */
/** 相邻的同门课合并：1 节一行 → "3-8 节"
 *
 *  必须按"同一门课"分组后再合并。若按全局时段顺序扫描，
 *  像 上午/下午 两个格子交错（3 节：幼儿园课程、教育见习；4 节：同样两门）时
 *  就会把不同课程穿插在一起，导致合并不完整。
 */
export function mergeAdjacentSlots(slots: CourseSlot[]): CourseSlot[] {
  const keyOf = (s: CourseSlot) =>
    [s.dayOfWeek, s.course, s.teacher ?? '', s.location ?? '', s.weeks ?? ''].join('\u0001');

  const groups = new Map<string, CourseSlot[]>();
  for (const slot of slots) {
    const key = keyOf(slot);
    const group = groups.get(key);
    if (group) group.push({ ...slot });
    else groups.set(key, [{ ...slot }]);
  }

  const out: CourseSlot[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.periodStart - b.periodStart);
    const merged: CourseSlot[] = [];
    for (const slot of group) {
      const prev = merged[merged.length - 1];
      if (prev && slot.periodStart <= prev.periodEnd + 1) {
        prev.periodEnd = Math.max(prev.periodEnd, slot.periodEnd);
        continue;
      }
      merged.push(slot);
    }
    out.push(...merged);
  }

  out.sort(
    (a, b) =>
      a.dayOfWeek - b.dayOfWeek ||
      a.periodStart - b.periodStart ||
      a.course.localeCompare(b.course),
  );
  return out;
}

/** 大节列：上午/下午/晚上 */
function isSectionColumn(
  grid: string[][],
  headerRow: number,
  c: number,
): boolean {
  if (c < 0) return false;
  let hits = 0;
  let total = 0;
  for (let r = headerRow + 1; r < grid.length; r++) {
    const v = (grid[r]?.[c] ?? '').trim();
    if (!v) continue;
    total++;
    if (/^(上午|下午|晚上|中午|早晨)$/.test(v)) hits++;
  }
  return total >= 2 && hits / total >= 0.6;
}

export function parseTimetable(
  data: ArrayBuffer | Uint8Array | string,
  options: ParseOptions = {},
): ParseResult {
  const { sheetName } = options;

  const wb =
    typeof data === 'string'
      ? XLSX.read(data, { type: 'string', cellDates: false })
      : XLSX.read(data, { type: 'array', cellDates: false });
  const name = sheetName ?? wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`工作表不存在: ${name}`);

  // header:1 → 二维数组；raw:false → 按显示文本输出；defval → 补齐空位
  const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });
  const merges = ws['!merges'] ?? [];
  const grid = expandMerges(matrix, merges);
  return parseGrid(grid, merges, { ...options, sheetName: name });
}

/**
 * 从「二维文本网格」直接构建课时记录。
 *
 * Excel / CSV / PDF（先把文字按坐标聚成网格）都走这里，保证归一化规则只有一份。
 * merges 只用于判断"合并区左上角"和跳过横跨多列的标题行；PDF 没有合并信息时传空数组。
 */
export function parseGrid(
  grid: string[][],
  merges: XLSX.Range[] = [],
  options: ParseOptions = {},
): ParseResult {
  const {
    sheetName,
    periodColumn,
    lineOrder = ['course', 'location', 'teacher'],
    periodsPerRow = 1,
    strictPeriodRows = false,
  } = options;
  const firstCol = 0;

  // ---- 1. 定位表头 ----
  let headerRow = options.headerRow ?? -1;
  if (headerRow < 0) {
    headerRow = grid.findIndex(
      (row) => row.filter((cell) => dayOfLabel(cell) > 0).length >= 2,
    );
    if (headerRow < 0) throw new Error('找不到表头：需要至少两个"星期X"列');
  }

  const dayCols: { c: number; dayOfWeek: number; label: string }[] = [];
  grid[headerRow].forEach((cell, c) => {
    const d = dayOfLabel(cell);
    if (d > 0) dayCols.push({ c, dayOfWeek: d, label: cell.trim() });
  });
  if (dayCols.length < 2) throw new Error('表头里找到的"星期"列少于 2 个');
  const days = dayCols.map((d) => ({ dayOfWeek: d.dayOfWeek, label: d.label }));
  const firstDayCol = dayCols[0].c;

  // ---- 2. 节次列 / 大节列 ----
  const periodCol = periodColumn ?? autoPeriodColumn(grid, headerRow, firstCol, firstDayCol);
  const sectionColumn =
    periodCol > firstCol && isSectionColumn(grid, headerRow, periodCol - 1)
      ? periodCol - 1
      : -1;

  // ---- 3. 行 → 节次 / 大节（合并单元格已展开，再向下填充兜底）----
  const rowPeriod = new Map<number, { start: number; end: number }>();
  const rowSection = new Map<number, string>();
  let last: { start: number; end: number } | null = null;
  let lastSection = '';
  for (let r = headerRow + 1; r < grid.length; r++) {
    let range: [number, number] | null = null;
    if (periodCol >= 0) {
      const label = (grid[r]?.[periodCol] ?? '').trim();
      range = parsePeriodRange(label);
      if (range) last = range;
      else range = strictPeriodRows ? null : last; // 空行：PDF 跳过；Excel 沿用上一行（兜底）
    } else {
      range = [r - headerRow, r - headerRow];
    }
    if (range) rowPeriod.set(r, { start: range[0], end: range[1] });

    if (sectionColumn >= 0) {
      const v = (grid[r]?.[sectionColumn] ?? '').trim();
      if (v) lastSection = v;
      if (lastSection) rowSection.set(r, lastSection);
    }
  }

  // ---- 4. 遍历数据区，只在合并区左上角取值 ----
  const rawSlots: CourseSlot[] = [];
  const seen = new Set<string>();
  for (let r = headerRow + 1; r < grid.length; r++) {
    const rp = rowPeriod.get(r);
    if (!rp) continue;
    for (const { c, dayOfWeek, label } of dayCols) {
      const raw = (grid[r]?.[c] ?? '').trim();
      if (!raw) continue;
      const m = mergeAt(merges, r, c);
      if (m) {
        if (!(m.s.r === r && m.s.c === c)) continue; // 被纵向合并覆盖的格子
        if (m.e.c - m.s.c >= 1) continue; // 横跨多列 = 标题/说明行，跳过
      }
      const entries = parseCellEntries(raw, lineOrder);
      for (const e of entries) {
        if (!e.course) continue;
        const start = e.periodStart ?? rp.start;
        const end = e.periodEnd ?? rp.end;
        const key = `${dayOfWeek}:${start}-${end}:${e.course}:${e.weeks ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rawSlots.push({
          dayOfWeek,
          dayLabel: label,
          periodStart: start,
          periodEnd: end,
          course: e.course,
          code: e.code,
          teacher: e.teacher,
          location: e.location,
          weeks: e.weeks,
          section: rowSection.get(r),
          raw: e.raw,
        });
      }
    }
  }

  const slots = mergeAdjacentSlots(rawSlots);

  const conflicts = findConflicts(slots);

  return { sheet: sheetName ?? '', days, slots, grid, conflicts };
}

/**
 * 冲突检测：同一天、节次重叠、且周次有交集。
 * PDF 多页 / 粘贴文本合并后需要重新算，所以单独导出。
 */
export function findConflicts(slots: CourseSlot[]): string[] {
  const conflicts: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (Math.max(a.periodStart, b.periodStart) > Math.min(a.periodEnd, b.periodEnd)) {
        continue;
      }
      const wa = parseWeeks(a.weeks);
      const wb2 = parseWeeks(b.weeks);
      const weekOverlap = !wa || !wb2 || [...wa].some((w) => wb2.has(w));
      if (!weekOverlap) continue;
      conflicts.push(
        `${a.dayLabel} 第${a.periodStart}-${a.periodEnd}节：${a.course} 与 ${b.course} 冲突`,
      );
    }
  }
  return conflicts;
}
