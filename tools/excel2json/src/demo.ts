/**
 * 演示：解析课表 Excel → JSON
 *
 *   node src/demo.ts                    # 用生成的样例（通用横排格式，含合并单元格）
 *   node src/demo.ts real-timetable.xls # 解析指定文件（支持教务系统导出格式）
 *
 * 输出：控制台表格 + timetable.json
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import { parseTimetable } from './timetable.ts';

const here = import.meta.dirname;

// ---------- 1. 没有参数时，造一张"真实"课表：合并单元格 + 单元格内多行 ----------
const rows: (string | null)[][] = [
  ['节次', '星期一', '星期二', '星期三', '星期四', '星期五'],
  ['1-2节', '高等数学\nA101\n张伟', null, '程序设计\n机房301\n陈静', null, null],
  [null, null, null, null, null, null],
  ['3-4节', '大学英语\nB203\n李娜', '线性代数\nA205\n王强', null, '大学物理\nC102\n刘洋', null],
  [null, null, null, null, null, null],
  ['5-6节', null, '计算机网络\nB305\n孙丽', null, null, '数据结构\n机房302\n陈静'],
  [null, null, null, null, null, null],
  ['7-8节', null, null, '体育\n操场\n赵军', null, null],
  [null, null, null, null, null, null],
];

async function makeSample(): Promise<string> {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = [
    // 节次列：每个 2 节块纵向合并
    { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
    { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } },
    { s: { r: 7, c: 0 }, e: { r: 8, c: 0 } },
    // 课程格：一门课占 2 节 → 纵向合并
    { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },
    { s: { r: 1, c: 3 }, e: { r: 2, c: 3 } },
    { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } },
    { s: { r: 3, c: 2 }, e: { r: 4, c: 2 } },
    { s: { r: 3, c: 4 }, e: { r: 4, c: 4 } },
    { s: { r: 5, c: 5 }, e: { r: 6, c: 5 } },
    { s: { r: 7, c: 3 }, e: { r: 8, c: 3 } },
  ];
  ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '2026春季课表');
  const file = path.join(here, '..', 'sample-timetable.xlsx');
  await fs.writeFile(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log(`✅ 已生成 ${path.basename(file)}`);
  return file;
}

const arg = process.argv[2];
const filePath = arg ? path.resolve(arg) : await makeSample();

// ---------- 2. 像浏览器一样：拿到字节序（ArrayBuffer/Uint8Array）再解析 ----------
const buf = new Uint8Array(await fs.readFile(filePath));
const t0 = performance.now();
const result = parseTimetable(buf);
const ms = performance.now() - t0;

// ---------- 3. 输出 ----------
console.log(`\n📄 ${path.basename(filePath)} · 工作表「${result.sheet}」· ${ms.toFixed(0)} ms`);
console.log('📅 星期列：', result.days.map((d) => `${d.dayOfWeek}=${d.label}`).join('  '));
console.log(`\n📋 归一化课时记录（${result.slots.length} 条）：`);
console.log(
  result.slots
    .map((s) =>
      [
        s.dayLabel,
        `第${s.periodStart}-${s.periodEnd}节`,
        s.section ?? '',
        s.course,
        s.location ?? '',
        s.teacher ?? '',
        s.weeks ?? '',
      ]
        .filter((x, i) => i !== 2 || x)
        .join(' | '),
    )
    .join('\n'),
);
console.log('\n⚠️  冲突：', result.conflicts.length ? result.conflicts : '无');

const out = {
  source: path.basename(filePath),
  sheet: result.sheet,
  days: result.days,
  slots: result.slots,
  conflicts: result.conflicts,
};
const jsonPath = path.join(here, '..', 'timetable.json');
await fs.writeFile(jsonPath, JSON.stringify(out, null, 2));
console.log(`\n✅ JSON 已写入 ${path.relative(process.cwd(), jsonPath)}`);
