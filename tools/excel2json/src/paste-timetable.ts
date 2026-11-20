/**
 * 「粘贴文字」兜底解析：用户把 PDF 里的课表框选复制（或从网页/聊天记录复制）后粘贴进来。
 *
 * 支持两种粘法：
 *   1. 带 Tab 的表格（从 PDF/Word/网页复制表格最常见）→ 当成二维网格交给 parseGrid()
 *   2. 一行一节课的流水文本（"星期一 第1-2节 高等数学 A101 张伟"）→ 逐行识别
 *
 * 目的不是替代 Excel 解析，而是当 PDF 文字层坏了 / 扫描件 OCR 不值当时，让用户还能用。
 */
import {
  dayOfLabel,
  findConflicts,
  mergeAdjacentSlots,
  parseGrid,
  parsePeriodRange,
  type CourseSlot,
  type ParseResult,
} from './timetable.ts';

export interface PasteResult extends ParseResult {
  mode: 'table' | 'aligned' | 'lines';
}

const clean = (value: string) => value.replace(/\u00a0/g, ' ').trim();

/** 1) 按 Tab 分开的表格 */
function tryTable(text: string): ParseResult | null {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim().length > 0);
  if (lines.length < 3) return null;
  const tabbed = lines.filter((l) => l.includes('\t')).length;
  if (tabbed / lines.length < 0.6) return null;
  const grid = lines.map((l) => l.split('\t').map(clean));
  if (Math.max(...grid.map((r) => r.length)) < 3) return null;

  for (const strict of [true, false]) {
    try {
      const parsed = parseGrid(grid, [], {
        sheetName: '粘贴文本',
        strictPeriodRows: strict,
      });
      if (parsed.slots.length > 0) return parsed;
    } catch {
      // 换下一种模式
    }
  }
  return null;
}

/** 2) 一行一节课的流水文本 */
const LINE_DAY = /(星期[一二三四五六日天])|(周[一二三四五六日天])/;
const LINE_PERIOD = /第?\s*(\d+)\s*(?:[-~～至]\s*(\d+))?\s*节/;

function tryLines(text: string): ParseResult | null {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim().length > 0);
  const slots: CourseSlot[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const dayMatch = line.match(LINE_DAY);
    const periodMatch = line.match(LINE_PERIOD);
    if (!dayMatch || !periodMatch) continue;
    const dayLabel = dayMatch[1] ?? dayMatch[2]!.replace('周', '星期');
    const dayOfWeek = dayOfLabel(dayLabel);
    if (!dayOfWeek) continue;
    const periodStart = Number(periodMatch[1]);
    const periodEnd = periodMatch[2] ? Number(periodMatch[2]) : periodStart;
    if (!(periodStart >= 1 && periodStart <= 30)) continue;

    // 去掉 星期/节次，剩下的字段按空白或 | / 拆
    const rest = line
      .replace(LINE_DAY, '')
      .replace(LINE_PERIOD, '')
      .replace(/^[\s|｜,，:：;；\-]+|[\s|｜,，:：;；\-]+$/g, '')
      .trim();
    if (!rest) continue;
    const hasSeparator = /[|｜/,，;；]|\s{2,}/.test(rest);
    const fields = (hasSeparator
      ? rest.split(/\s*[|｜]\s*|\s*\/\s*|\s*[,，;；]\s*|\s{2,}/)
      : rest.split(/\s+/)
    )
      .map(clean)
      .filter(Boolean);
    const course = fields[0] ?? rest;
    if (!course) continue;
    slots.push({
      dayOfWeek,
      dayLabel,
      periodStart,
      periodEnd,
      course,
      location: fields[1],
      teacher: fields[2],
      raw: rawLine.trim(),
    });
  }
  if (slots.length < 3) return null;
  const merged = mergeAdjacentSlots(slots);
  const days = [...new Map(merged.map((s) => [s.dayOfWeek, s])).values()]
    .map((s) => ({ dayOfWeek: s.dayOfWeek, label: s.dayLabel }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  return {
    sheet: '粘贴文本',
    days,
    slots: merged,
    grid: [],
    conflicts: findConflicts(merged),
  };
}


/** 3) 复制出来只有空格对齐（PDF/网页复制常见）：用表头"星期X"的字符位置切列 */
function tryAligned(text: string): ParseResult | null {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\u00a0/g, ' ').replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
  if (lines.length < 4) return null;

  const headerIdx = lines.findIndex(
    (l) => (l.match(/星期[一二三四五六日天]/g) ?? []).length >= 2,
  );
  if (headerIdx < 0) return null;
  const header = lines[headerIdx];
  const dayLabels = header.match(/星期[一二三四五六日天]/g) ?? [];
  const dayPos: number[] = [];
  for (const m of header.matchAll(/星期[一二三四五六日天]/g)) {
    if (m.index !== undefined) dayPos.push(m.index);
  }
  if (dayPos.length < 2) return null;

  const maxLen = Math.max(...lines.map((l) => l.length));
  const bounds: number[] = [];
  for (let i = 1; i < dayPos.length; i++) {
    bounds.push(Math.floor((dayPos[i - 1] + dayPos[i]) / 2));
  }
  bounds.push(maxLen + 1);

  const splitLeft = (left: string): string[] => {
    const parts = left.trimEnd().split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
    return parts.length ? parts : [''];
  };

  const grid: string[][] = [[...splitLeft(header.slice(0, dayPos[0])), ...dayLabels]];

  for (const line of lines.slice(headerIdx + 1)) {
    const left = splitLeft(line.slice(0, dayPos[0]));
    const cells = dayPos.map((pos, i) => clean(line.slice(pos, bounds[i])));
    const row = [...left, ...cells];
    if (row.every((c) => !c)) continue;
    grid.push(row);
  }
  if (grid.length < 3) return null;

  const width = Math.max(...grid.map((r) => r.length));
  const padded = grid.map((r) => [...r, ...new Array(Math.max(0, width - r.length)).fill('')]);
  try {
    const parsed = parseGrid(padded, [], { sheetName: '粘贴文本', strictPeriodRows: true });
    return parsed.slots.length ? parsed : null;
  } catch {
    return null;
  }
}

/** 粘贴文本 → 课表 JSON */
export function parsePastedTimetable(text: string): PasteResult {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  if (normalized.trim().length < 20) {
    throw new Error('粘贴的内容太短了');
  }
  const fromTable = tryTable(normalized);
  if (fromTable) return { ...fromTable, mode: 'table' };
  const fromAligned = tryAligned(normalized);
  if (fromAligned) return { ...fromAligned, mode: 'aligned' };
  const fromLines = tryLines(normalized);
  if (fromLines) return { ...fromLines, mode: 'lines' };
  throw new Error(
    '没认出表格结构。建议在 PDF/网页里框选整个课表再复制（复制出来应该用 Tab 分列）；' +
      '如果只有零散文字，可以一行一节课，写成「星期一 第1-2节 高等数学 A101 张伟」',
  );
}
