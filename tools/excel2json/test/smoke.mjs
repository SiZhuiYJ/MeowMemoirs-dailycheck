// 烟测：1) Excel 两种格式  2) 粘贴文本兜底  3) 浏览器页面渲染链路
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { parseTimetable } from '../src/timetable.ts';
import { parsePastedTimetable } from '../src/paste-timetable.ts';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------- 1. 纯解析 ----------
const sample = parseTimetable(new Uint8Array(fs.readFileSync('sample-timetable.xlsx')));
check('通用样例：8 条课时', sample.slots.length === 8, `实际 ${sample.slots.length}`);
check(
  '通用样例：计算机网络 5-6 节',
  sample.slots.some(
    (s) => s.course === '计算机网络' && s.periodStart === 5 && s.periodEnd === 6,
  ),
);
check('通用样例：无冲突', sample.conflicts.length === 0, sample.conflicts.join('；'));

const real = parseTimetable(new Uint8Array(fs.readFileSync('real-timetable.xls')));
check('教务系统课表：17 条课时', real.slots.length === 17, `实际 ${real.slots.length}`);
check('教务系统课表：7 个星期列', real.days.length === 7);
const jy = real.slots.find((s) => s.course === '教育见习I' && s.dayOfWeek === 3);
check(
  '教务系统课表：教育见习I 星期三 1-8 节',
  jy && jy.periodStart === 1 && jy.periodEnd === 8,
  jy ? `实际 ${jy.periodStart}-${jy.periodEnd}` : '未找到',
);
check(
  '教务系统课表：周次解析正确',
  real.slots.some((s) => s.course === '婴幼儿回应性照料' && s.weeks === '1-4周,6-17周'),
);
check('教务系统课表：不误报冲突', real.conflicts.length === 0, real.conflicts.join('；'));

// ---------- 2.5 粘贴文本兜底 ----------
const tsv = [
  '节次\t星期一\t星期二\t星期三',
  '1\t高等数学/A101/张伟\t\t教育见习I/CB21500008/(1-1节)8周/成都校区 外出/唐金金',
  '2\t高等数学/A101/张伟\t\t教育见习I/CB21500008/(2-2节)8周/成都校区 外出/唐金金',
  '3\t\t线性代数/A205/王强\t',
].join('\n');
const pastedTable = parsePastedTimetable(tsv);
check('粘贴：Tab 分列模式', pastedTable.mode === 'table', pastedTable.mode);
check('粘贴：解析出 3 条课时', pastedTable.slots.length === 3, `实际 ${pastedTable.slots.length}`);
check(
  '粘贴：合并了相邻两节',
  pastedTable.slots.some(
    (s) => s.course === '高等数学' && s.periodStart === 1 && s.periodEnd === 2,
  ),
);

const lineText = [
  '星期一 第9-10节 中国近现代史纲要 E405 王雪山',
  '星期二 第3-4节 婴幼儿回应性照料 C107 周红',
  '星期五 第5-6节 教师职业道德 B102 杨薛琳',
].join('\n');
const pastedLines = parsePastedTimetable(lineText);
check('粘贴：一行一节课模式', pastedLines.mode === 'lines', pastedLines.mode);
check('粘贴：拆出地点和教师', pastedLines.slots[0]?.location === 'E405' && pastedLines.slots[0]?.teacher === '王雪山');

// ---------- 3. 浏览器页面（jsdom 里执行打包产物）----------
const xlsBytes = fs.readFileSync('real-timetable.xls');
const html = fs.readFileSync('web/index.html', 'utf8');
const appJs = fs.readFileSync('web/app.js', 'utf8');

check('页面：有「粘贴解析」面板', /id="pasteGo"/.test(html) && /id="pasteText"/.test(html));
check('页面：不再内置 PDF 解析', !/realPdf/.test(html) && !/pdfjs/.test(appJs));

const dom = new JSDOM(html, { url: 'http://127.0.0.1:8899/', runScripts: 'outside-only' });
const { window } = dom;

window.fetch = async () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () =>
    xlsBytes.buffer.slice(xlsBytes.byteOffset, xlsBytes.byteOffset + xlsBytes.byteLength),
});
if (!window.TextDecoder) window.TextDecoder = TextDecoder;
if (!window.Blob) window.Blob = Blob;

window.eval(appJs);
await new Promise((r) => setTimeout(r, 400));

const doc = window.document;
const status = doc.getElementById('status').textContent;
const rows = doc.querySelectorAll('#slotTable tbody tr');
const headers = [...doc.querySelectorAll('#slotHead th')].map((th) => th.textContent);
const json = doc.getElementById('json').textContent;

check('页面：自动加载并解析', rows.length === 17, `实际 ${rows.length} 行 · ${status}`);
check('页面：表头含周次列', headers.includes('周次'), headers.join('/'));
check('页面：JSON 内容正确', json.includes('教育见习I') && json.includes('婴幼儿回应性照料'));
check('页面：状态栏成功', status.includes('17 条课时'), status);

console.log(failed === 0 ? '\n🎉 全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
