/**
 * 浏览器端 demo 逻辑：选文件 → ArrayBuffer → 解析 → 渲染
 *   Excel/CSV → parseTimetable()
 *   纯文本     → parsePastedTimetable()（粘贴兜底）
 * 由 esbuild 打包成 web/app.js（iife），页面用普通 <script> 引入。
 */
import { parseTimetable, type ParseResult } from './timetable.ts';
import { parsePastedTimetable } from './paste-timetable.ts';

const $ = (id: string) => document.getElementById(id)!;
const statusEl = $('status');
const dropEl = $('drop');
const fileEl = $('file') as HTMLInputElement;

let lastJson = '';
let gridOpen = true;

function setStatus(text: string, kind: '' | 'ok' | 'err' = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`.trim();
}

function decodeCsv(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    // Excel 导出的中文 CSV 常见为 GBK
    return new TextDecoder('gbk').decode(bytes);
  } catch {
    return utf8;
  }
}

/** 把解析结果渲染到页面 */
function render(name: string, result: ParseResult, ms: number, detail = '') {
  // ---- 课时表 ----
  const tbody = $('slotTable').querySelector('tbody')!;
  tbody.replaceChildren();
  // 列随数据变化：教务系统格式会多出「大节 / 周次」
  const hasSection = result.slots.some((s) => s.section);
  const hasWeeks = result.slots.some((s) => s.weeks);
  const columns: {
    title: string;
    value: (s: (typeof result.slots)[number]) => string;
    cls?: string;
  }[] = [
    { title: '星期', value: (s) => s.dayLabel, cls: 'day' },
    { title: '节次', value: (s) => `第 ${s.periodStart}-${s.periodEnd} 节`, cls: 'period' },
    ...(hasSection ? [{ title: '大节', value: (s: (typeof result.slots)[number]) => s.section ?? '' }] : []),
    { title: '课程', value: (s) => s.course, cls: 'course' },
    { title: '地点', value: (s) => s.location ?? '' },
    { title: '教师', value: (s) => s.teacher ?? '' },
    ...(hasWeeks ? [{ title: '周次', value: (s: (typeof result.slots)[number]) => s.weeks ?? '' }] : []),
  ];

  const head = $('slotHead');
  head.replaceChildren(
    ...columns.map((col) => {
      const th = document.createElement('th');
      th.textContent = col.title;
      return th;
    }),
  );

  for (const s of result.slots) {
    const tr = document.createElement('tr');
    for (const col of columns) {
      const td = document.createElement('td');
      td.textContent = col.value(s);
      if (col.cls) td.className = col.cls;
      if (col.title === '课程' && s.code) td.title = `课程号：${s.code}`;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  $('countPill').textContent = `${result.slots.length} 条 · 用时 ${ms.toFixed(0)} ms`;
  $('resultCard').classList.remove('hidden');

  const warn = $('conflicts');
  if (result.conflicts.length) {
    warn.textContent = `⚠️ ${result.conflicts.join('；')}`;
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }

  // ---- JSON ----
  lastJson = JSON.stringify(
    {
      source: name,
      sheet: result.sheet,
      days: result.days,
      slots: result.slots,
      conflicts: result.conflicts,
    },
    null,
    2,
  );
  $('json').textContent = lastJson;
  $('jsonPill').textContent = `${(new Blob([lastJson]).size / 1024).toFixed(1)} KB`;
  $('jsonCard').classList.remove('hidden');

  // ---- 展开后的网格 ----
  const gtbody = document.createElement('tbody');
  result.grid.forEach((row, r) => {
    const tr = document.createElement('tr');
    row.forEach((cell, c) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (r === 0) td.className = 'head';
      else if (c === 0) td.className = 'period';
      else if (cell) td.className = 'has';
      tr.appendChild(td);
    });
    gtbody.appendChild(tr);
  });
  const gtable = $('gridTable');
  gtable.replaceChildren(gtbody);
  const hasGrid = result.grid.length > 0;
  $('gridCard').classList.toggle('hidden', !hasGrid || !gridOpen);

  setStatus(
    `✅ ${name} · 工作表「${result.sheet}」· ${result.slots.length} 条课时` +
      (result.conflicts.length ? ` · ${result.conflicts.length} 处冲突` : '') +
      (detail ? ` · ${detail}` : ''),
    'ok',
  );
}

async function parseArrayBuffer(name: string, buf: ArrayBuffer) {
  const t0 = performance.now();
  const bytes = new Uint8Array(buf);
  const lower = name.toLowerCase();
  const data = lower.endsWith('.csv') ? decodeCsv(bytes) : bytes;
  const result = parseTimetable(data);
  render(name, result, performance.now() - t0);
}

async function handleFile(file: File) {
  setStatus(`正在解析 ${file.name} …`);
  try {
    await parseArrayBuffer(file.name, await file.arrayBuffer());
  } catch (e) {
    console.error(e);
    setStatus(`❌ 解析失败：${(e as Error).message}`, 'err');
  }
}

async function loadSample(file: string) {
  setStatus(`正在加载 ${file} …`);
  const res = await fetch(`./${file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await parseArrayBuffer(file, await res.arrayBuffer());
}

/** 打开页面：优先真实课表，没有就退回内置样例 */
async function loadInitial() {
  try {
    await loadSample('real-timetable.xls');
  } catch {
    await loadSample('sample-timetable.xlsx').catch((e) =>
      setStatus(`❌ 样例加载失败：${(e as Error).message}`, 'err'),
    );
  }
}

// ---- 交互绑定 ----
$('pick').addEventListener('click', () => fileEl.click());
dropEl.addEventListener('click', () => fileEl.click());
dropEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') fileEl.click();
});
fileEl.addEventListener('change', () => {
  const f = fileEl.files?.[0];
  if (f) void handleFile(f);
  fileEl.value = '';
});
const onBtn = (id: string, file: string) =>
  $(id).addEventListener('click', () => {
    void loadSample(file).catch((e) =>
      setStatus(`❌ 加载失败：${(e as Error).message}`, 'err'),
    );
  });
onBtn('sample', 'sample-timetable.xlsx');
onBtn('realSample', 'real-timetable.xls');

$('pasteGo').addEventListener('click', () => {
  const text = ($('pasteText') as HTMLTextAreaElement).value;
  if (!text.trim()) {
    setStatus('先粘贴点内容进来', 'err');
    return;
  }
  const t0 = performance.now();
  try {
    const result = parsePastedTimetable(text);
    const modeLabel = { table: 'Tab 分列', aligned: '空格对齐', lines: '一行一节课' }[result.mode];
    render('粘贴文本', result, performance.now() - t0, modeLabel);
  } catch (e) {
    setStatus(`❌ ${(e as Error).message}`, 'err');
  }
});

for (const ev of ['dragenter', 'dragover'] as const) {
  dropEl.addEventListener(ev, (e) => {
    e.preventDefault();
    dropEl.classList.add('over');
  });
}
for (const ev of ['dragleave', 'drop'] as const) {
  dropEl.addEventListener(ev, (e) => {
    e.preventDefault();
    dropEl.classList.remove('over');
  });
}
dropEl.addEventListener('drop', (e) => {
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) void handleFile(f);
});
// 防止在页面其它位置误拖导致浏览器直接打开文件
for (const ev of ['dragover', 'drop'] as const) {
  window.addEventListener(ev, (e) => e.preventDefault());
}

$('download').addEventListener('click', () => {
  const blob = new Blob([lastJson], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'timetable.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('copy').addEventListener('click', async () => {
  const btn = $('copy');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(lastJson);
    } else {
      // 局域网 http:// 不是安全上下文，clipboard API 不可用
      const ta = document.createElement('textarea');
      ta.value = lastJson;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    btn.textContent = '已复制';
  } catch {
    btn.textContent = '复制失败';
  }
  setTimeout(() => (btn.textContent = '复制'), 1400);
});

$('toggleGrid').addEventListener('click', () => {
  gridOpen = !gridOpen;
  $('gridCard').classList.toggle('hidden', !gridOpen);
  $('toggleGrid').textContent = gridOpen ? '收起' : '展开';
});

// 页面打开即展示样例，方便直接看效果
void loadInitial();
