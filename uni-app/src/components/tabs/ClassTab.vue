<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import MmNavBar from '@/components/MmNavBar.vue';
import { useThemeStore } from '@/stores/theme';
import useSchedule, { WEEK_DAY_LABELS, type ScheduleBlock } from '@/features/Curriculum/useSchedule';
import {
  ScheduleApi,
  type ScheduleEditPayload,
  type TimetablePayload,
} from '@/libs/api/schedule';
import type {
  Course,
  SavedTimetable,
  ScheduleDetail,
  ScheduleImportPreview,
} from '@/libs/api/schedule/type';
import { parseDateOnly, toLocalDateOnlyString } from '@/utils/date';
import { getMenuButtonRectCompat, getWindowInfoCompat } from '@/utils/systemInfo';

/**
 * 课程 tab（课表展示 + 导入）
 *
 * 重构要点：
 * 1. 数据换成后端新课表模型：`useSchedule` 负责拉列表/详情、算当前周、把
 *    Course.times 按「当前周 + 星期」映射成可跨行渲染的课程块；
 * 2. 顶部沿用 MmNavBar：左侧课表名（多课表时可 picker 切换）+ 周次胶囊，
 *    右侧「导入」「今天」两个按钮；
 * 3. 周次切换条：上一周 / 第 N 周（本周高亮）/ 下一周；
 * 4. 网格：左侧节次/时间列固定，右侧 7 天用 scroll-view 横向滚动；课程块按
 *    sectionList 跨行、用数据 color 做浅底 + 左侧条；
 * 5. 数据只读展示，唯一写入口是顶栏「导入」：从微信会话选 Excel / PDF / 课表截图，
 *    先走后端预检（Excel 解析、图片/PDF 走 OCR），弹层里可编辑作息时间表（文件有 /
 *    历史保存 / 默认 / 新建）并逐行编辑课程/星期/节次/周次/地点/教师，确认后统一走
 *    Confirm 接口保存编辑后的数据（Excel 与 OCR 一致），成功后刷新并切换到新导入的
 *    课表；进入 tab 时自动刷新（isActive watch + onMounted）。
 */
const props = defineProps<{
  isActive: boolean;
}>();

// 主题变量绑定到页面根节点，保证日/夜切换时课程页配色跟随
const themeStore = useThemeStore();

const {
  // 数据
  schedules,
  currentSchedule,
  currentScheduleName,
  scheduleNames,
  currentScheduleIndex,
  courses,
  // 周次
  currentWeek,
  todayWeek,
  weekCount,
  isCurrentWeek,
  weekDays,
  weekDateRangeText,
  sectionRows,
  // 课程块
  courseBlocks,
  getDayBlocks,
  weekdayLabel,
  // 状态
  isLoading,
  isRefreshing,
  hasLoaded,
  error,
  // 方法
  refresh,
  switchSchedule,
  applyImportedSchedule,
  prevWeek,
  nextWeek,
  goToday,
} = useSchedule();

/** 网格布局常量：与 <style> 里的行高 / 表头高度 / 天列宽保持一致 */
const ROW_HEIGHT = 62;
const HEADER_HEIGHT = 42;
const DAY_COLUMN_WIDTH = 78;
const DAY_COUNT = 7;

/** 顶栏右侧「导入 + 今天」占宽：两个 52px 按钮 + 8px 间距 + 右插槽 8px 左内边距 */
const NAV_ACTIONS_WIDTH = 120;
/** 课表名允许的最小宽度：再窄也保留一点，避免极端窄屏把标题压没 */
const MIN_SCHEDULE_NAME_WIDTH = 96;

/**
 * 顶栏左侧课表名的可用宽度。
 * MmNavBar 在微信端会为右上角系统胶囊预留 ~95px 内边距，右侧现在又同时放
 * 「导入 + 今天」两个按钮；窄屏（360/375）不限宽会把顶栏挤爆、按钮压到胶囊上。
 * 这里按真实窗口宽度与胶囊位置算出上限（算法与 MmNavBar 的内边距保持一致），
 * 课表名超出时用省略号截断。
 */
const scheduleHeadMaxWidth = (() => {
  const win = getWindowInfoCompat();
  const windowWidth = win.windowWidth || 375;
  const menuRect = getMenuButtonRectCompat();
  const capsuleInset =
    menuRect && windowWidth > 0 ? Math.max(windowWidth - menuRect.left + 8, 0) : 0;
  // MmNavBar 横向内边距：左固定 12；右侧有胶囊时让出胶囊宽度，否则 12
  const sidePadding = 12 + (capsuleInset > 0 ? capsuleInset : 12);
  return Math.max(Math.round(windowWidth - sidePadding - NAV_ACTIONS_WIDTH), MIN_SCHEDULE_NAME_WIDTH);
})();

/** 网格内容高度（表头 + N 节） */
const bodyHeight = computed(() => sectionRows.value.length * ROW_HEIGHT);
const gridHeight = computed(() => HEADER_HEIGHT + bodyHeight.value);
const dayGridWidth = computed(() => DAY_COLUMN_WIDTH * DAY_COUNT);

/** 首屏骨架：只有「第一次加载」才闪骨架，之后进入 tab 都是静默刷新 */
const showSkeleton = computed(() => isLoading.value && !hasLoaded.value);

/** 当前周没有课程时顶部展示提示条 */
const hasNoCourseThisWeek = computed(() => courseBlocks.value.length === 0);
const noCourseDesc = computed(() =>
  courses.value.length === 0 ? '这份课表还没有课程' : '可以切换到其他周次看看',
);

/** 课程详情弹层 */
const activeCourse = ref<ScheduleBlock | null>(null);

function openCourseDetail(block: ScheduleBlock) {
  activeCourse.value = block;
}

function closeCourseDetail() {
  activeCourse.value = null;
}

/** 多课表切换：picker change 事件里拿下标再切 */
function onScheduleChange(event: any) {
  const index = Number(event?.detail?.value);
  const target = schedules.value[index];
  if (target) void switchSchedule(target.id);
}

/** 课程块绝对定位：按 sectionStart / sectionSpan 跨行 */
function courseBlockStyle(block: ScheduleBlock) {
  return {
    top: `${(block.sectionStart - 1) * ROW_HEIGHT + 2}px`,
    height: `${block.sectionSpan * ROW_HEIGHT - 4}px`,
    backgroundColor: block.tint || 'var(--theme-color-soft)',
    borderLeftColor: block.color || 'var(--theme-primary)',
  };
}

/** 详情弹层的时间文案：周一 第1-2节 · 08:00-09:40 */
function courseTimeText(block: ScheduleBlock): string {
  const weekday = weekdayLabel(block.dayOfWeek);
  return `${weekday} ${block.sectionText}${block.timeText ? ` · ${block.timeText}` : ''}`;
}

/* ============================================================
   导入课表（两步）：预检 → 弹层里可编辑课程明细 → 命名 → 保存
   · Excel(.xlsx/.xls)：Preview 解析；截图/PDF：Ocr/Preview 识别
   · 两种文件都只在「预检」时上传一次；编辑确认后统一走 Confirm 接口保存，
     不再重新上传/解析文件，否则用户的编辑会被丢弃。
   ============================================================ */

/** 微信聊天里可选的导入文件后缀：Excel 走解析，PDF/图片走 OCR 兜底 */
const EXCEL_IMPORT_EXTENSIONS = ['xlsx', 'xls'];
const OCR_IMPORT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp'];
const IMPORT_EXTENSIONS = [...EXCEL_IMPORT_EXTENSIONS, ...OCR_IMPORT_EXTENSIONS];

/** 文件大小上限：Excel 10MB；PDF/图片 OCR 30MB（与后端 RequestSizeLimit 一致） */
const MAX_EXCEL_FILE_SIZE = 10 * 1024 * 1024;
const MAX_OCR_FILE_SIZE = 30 * 1024 * 1024;

/** 后端单节次上限（Confirm 校验同值） */
const MAX_IMPORT_SECTION = 30;

/** 导入方式：Excel 解析 / OCR 识别（只影响预检接口与弹层标题） */
type ImportFileKind = 'excel' | 'ocr';

/** 微信 chooseMessageFile 返回的聊天文件（只取分流 / 大小校验要用的字段） */
interface ChosenMessageFile {
  /** 原始文件名（含后缀；微信临时路径没有后缀时用它判断类型） */
  name: string;
  /** 本地临时文件路径（uni.uploadFile 用） */
  path: string;
  /** 文件大小（字节），用于上传前拦截超限文件 */
  size: number;
}

/** 预检弹层里一行可编辑的时间段（同一课程名多行 → 保存时合并成一门课的多个时间段） */
interface EditableImportTime {
  /** 渲染 key（删除 / 添加行时保持稳定） */
  key: string;
  /** 课程名（去空格后同名合并） */
  courseName: string;
  /** 课程颜色（沿用预检返回的课程色） */
  color: string;
  /** 星期几 1-7 */
  dayOfWeek: number;
  /** 节次文本，如「1-2」「1,3,5」 */
  sectionListText: string;
  /** 周次文本，如「1-16」「1-4,9-16」 */
  weekListText: string;
  /** 上课地点 */
  location: string;
  /** 授课教师 */
  teacher: string;
}

/** 预检弹层里一行可编辑的作息（第 N 节的起止时间） */
interface EditableTimetableSlot {
  /** 渲染 key（删除 / 添加行时保持稳定） */
  key: string;
  /** 时间文本，格式 HH:mm-HH:mm */
  timeText: string;
}

/** 预检（解析 / 识别）中：防止重复选文件 / 重复请求 */
const isPreviewing = ref(false);
/** 正式保存中：防止重复提交 */
const isImporting = ref(false);
/** 预检结果：非 null 时展示预检弹层（保存时取 startTime / weekCount / timetable） */
const importPreview = ref<ScheduleImportPreview | null>(null);
/** 预检对应的导入方式：决定弹层标题（OCR 识别结果 / 确认导入内容） */
const pendingImportKind = ref<ImportFileKind | null>(null);
/** 预检结果转成的可编辑时间段行（用户改完的这份就是要保存的数据） */
const importTimeRows = ref<EditableImportTime[]>([]);
/** 新增行的自增 key */
let importRowSeq = 0;
/** 命名弹窗是否正在等待用户输入（防止连点「下一步」弹出多个原生弹窗） */
let isAskingName = false;
/** 导入流程任一环节进行中：用于「导入」按钮置灰和入口防重 */
const isImportBusy = computed(() => isPreviewing.value || isImporting.value);

/** 编辑后的课程数（按课程名去重，实时跟着输入变） */
const editedCourseCount = computed(() => {
  const names = new Set<string>();
  for (const row of importTimeRows.value) {
    const name = row.courseName.trim();
    if (name) names.add(name);
  }
  return names.size;
});
/** 编辑后的时间段数（行数，实时跟着增删变） */
const editedTimeCount = computed(() => importTimeRows.value.length);

/** 历史保存过的作息（预检成功后拉取；失败静默，仅少一个辅助入口） */
const savedTimetables = ref<SavedTimetable[]>([]);
/** 历史作息加载中 */
const isLoadingTimetables = ref(false);
/** 编辑后的作息时间行（保存时转成 string[] 传给 Confirm） */
const timetableRows = ref<EditableTimetableSlot[]>([]);
/** 新增作息行的自增 key */
let timetableRowSeq = 0;

/** 历史作息 picker 的展示文案：名称（N 节）；来自课表的再加后缀 */
const savedTimetableLabels = computed(() =>
  savedTimetables.value.map((item) => {
    const count = (item.times ?? []).length;
    const suffix = item.fromSchedule ? ' · 来自课表' : '';
    return `${item.name || '未命名作息'}（${count} 节）${suffix}`;
  }),
);

/** 作息来源提示：文件里有作息 / 文件里没有 */
const timetableSourceText = computed(() => {
  const preview = importPreview.value;
  if (!preview) return '';
  if (preview.timetableFromFile) return `已从文件读取 ${preview.timetable.length} 节作息`;
  return '文件里没有作息时间表';
});

/** 文件无作息时的进一步引导：历史为空则说明可新建 / 用默认 */
const timetableHintText = computed(() => {
  const preview = importPreview.value;
  if (!preview || preview.timetableFromFile) return '';
  if (isLoadingTimetables.value) return '正在加载已保存的作息…';
  if (savedTimetables.value.length === 0) {
    return '文件里没有作息时间表，也没有已保存的作息；可直接编辑时间（新建作息）或使用默认作息';
  }
  return '文件里没有作息时间表，可选择已保存的作息、恢复默认作息，或直接编辑时间（新建作息）';
});

/** 预检弹层内容区高度：约半屏，保证面板放得下且内部可滚动（scroll-view 需要明确高度） */
const previewScrollHeight = Math.max(
  240,
  Math.round((getWindowInfoCompat().windowHeight || 640) * 0.56),
);

/** 头部「导入」按钮：从微信聊天选文件 → 按后缀分流 → 预检 */
function handleImportClick(): void {
  if (isImportBusy.value) return;
  // chooseMessageFile 仅微信小程序支持；H5 / App 端给提示，避免点了没反应
  if (typeof uni.chooseMessageFile !== 'function') {
    uni.showToast({ title: '请在微信小程序中导入课表', icon: 'none' });
    return;
  }
  uni.chooseMessageFile({
    count: 1,
    // 用 'all'：聊天里的截图是「图片消息」，type:'file' 列表里没有图片，选不到截图；
    // 'all' 能同时选 Excel/PDF 文件消息和图片消息，选完再按后缀分流
    type: 'all',
    // 传给微信做类型提示（微信仅在 type:'file' 时严格按 extension 过滤，这里保留兜底）
    extension: IMPORT_EXTENSIONS,
    success: (res) => {
      const file = res.tempFiles?.[0];
      if (!file?.path) return;
      const kind = resolveImportKind(file);
      if (!kind) {
        uni.showToast({ title: '仅支持 Excel、PDF 或图片', icon: 'none' });
        return;
      }
      // 先在本机拦一次大小，超限不白传一遍
      const maxSize = kind === 'excel' ? MAX_EXCEL_FILE_SIZE : MAX_OCR_FILE_SIZE;
      if (typeof file.size === 'number' && file.size > maxSize) {
        uni.showToast({
          title: kind === 'excel' ? 'Excel 文件不能超过 10MB' : '截图 / PDF 不能超过 30MB',
          icon: 'none',
        });
        return;
      }
      void previewImportFile(file, kind);
    },
    fail: (err) => {
      // 用户取消选择不是错误，不打扰
      if ((err?.errMsg || '').includes('cancel')) return;
      uni.showToast({ title: '选择文件失败，请重试', icon: 'none' });
    },
  });
}

/** 取文件后缀：优先微信临时路径，没有时退回原始文件名 */
function extractFileExtension(file: ChosenMessageFile): string {
  for (const source of [file.path, file.name]) {
    const match = /\.([a-z0-9]+)$/i.exec((source || '').trim());
    if (match) return match[1]!.toLowerCase();
  }
  return '';
}

/** 按后缀分流：xlsx/xls 走 Excel 解析，pdf 与图片走 OCR；不支持的类型返回 null */
function resolveImportKind(file: ChosenMessageFile): ImportFileKind | null {
  const extension = extractFileExtension(file);
  if (EXCEL_IMPORT_EXTENSIONS.includes(extension)) return 'excel';
  if (OCR_IMPORT_EXTENSIONS.includes(extension)) return 'ocr';
  return null;
}

/** 第一步：上传文件做预检（Excel 解析 / OCR 识别，均不写库），成功后把结果转成可编辑行 */
async function previewImportFile(file: ChosenMessageFile, kind: ImportFileKind): Promise<void> {
  isPreviewing.value = true;
  // OCR 较慢（单页约 5~15 秒）：文案用「识别中…」，mask 防止等待期间重复点击
  uni.showLoading({ title: kind === 'ocr' ? '识别中…' : '解析中...', mask: true });
  try {
    const preview =
      kind === 'ocr'
        ? await ScheduleApi.previewOcrFile(file.path)
        : await ScheduleApi.previewFile(file.path);
    // 防御：返回缺字段时不进确认流程，避免弹层渲染出错
    if (!preview || !Array.isArray(preview.courses)) {
      throw new Error(kind === 'ocr' ? '识别结果异常，请稍后重试' : '解析结果异常，请稍后重试');
    }
    // 预检期间用户可能切走了 tab：丢弃结果，避免弹层出现在别的 tab 上
    if (!props.isActive) return;
    importTimeRows.value = buildEditableImportTimes(preview);
    timetableRows.value = buildTimetableRows(preview.timetable);
    pendingImportKind.value = kind;
    importPreview.value = preview;
    // 历史作息只用于辅助选择：失败静默，不阻塞导入
    void loadSavedTimetables();
  } catch (e: any) {
    uni.showModal({
      title: kind === 'ocr' ? '识别失败' : '解析失败',
      content: toApiErrorMessage(e),
      showCancel: false,
      confirmText: '知道了',
    });
  } finally {
    uni.hideLoading();
    isPreviewing.value = false;
  }
}

/**
 * 把预检返回的课程 / 时间段拍平成一行行可编辑数据（深拷贝：改行不影响 preview）。
 * 一门课有多个时间段时会有多行，课程名相同；保存时再按课程名合并回 courses。
 */
function buildEditableImportTimes(preview: ScheduleImportPreview): EditableImportTime[] {
  const rows: EditableImportTime[] = [];
  for (const course of preview.courses ?? []) {
    for (const time of course.times ?? []) {
      rows.push({
        key: `import-time-${(importRowSeq += 1)}`,
        courseName: course.courseName ?? '',
        color: course.color ?? '',
        dayOfWeek: clampDayOfWeek(time.dayOfWeek),
        sectionListText: formatRanges(time.sectionList),
        weekListText: formatRanges(time.weekList),
        location: time.location ?? '',
        teacher: time.teacher ?? '',
      });
    }
  }
  return rows;
}

/** 星期裁剪到 1-7，非法值按周一处理 */
function clampDayOfWeek(dayOfWeek: number): number {
  if (!Number.isFinite(dayOfWeek)) return 1;
  return Math.min(7, Math.max(1, Math.round(dayOfWeek)));
}

/** 关闭预检弹层并丢弃编辑数据（取消导入 / 离开 tab 时调用） */
function cancelImportPreview(): void {
  importPreview.value = null;
  pendingImportKind.value = null;
  importTimeRows.value = [];
  timetableRows.value = [];
}

/* ---------- 可编辑行的增 / 删 / 改 ---------- */

/** 星期 picker 变更：picker 下标 + 1 = dayOfWeek */
function onImportRowDayChange(row: EditableImportTime, event: any): void {
  const index = Number(event?.detail?.value);
  row.dayOfWeek = clampDayOfWeek(Number.isFinite(index) ? index + 1 : 1);
}

/** 删除一个时间段行 */
function removeImportRow(index: number): void {
  if (index < 0 || index >= importTimeRows.value.length) return;
  importTimeRows.value.splice(index, 1);
}

/** 添加一个时间段行：默认沿用最后一行的课程名 / 颜色 / 周次，方便给同一门课加时间段 */
function addImportRow(): void {
  const last = importTimeRows.value[importTimeRows.value.length - 1];
  importTimeRows.value.push({
    key: `import-time-${(importRowSeq += 1)}`,
    courseName: last?.courseName ?? '',
    color: last?.color ?? '',
    dayOfWeek: last?.dayOfWeek ?? 1,
    sectionListText: '',
    weekListText: last?.weekListText ?? '',
    location: '',
    teacher: '',
  });
}

/* ---------- 作息时间表：选择历史 / 恢复默认 / 手动新建 ---------- */

/** 作息时间格式：HH:mm-HH:mm（允许单位数小时，如 8:00-8:45） */
const TIMETABLE_TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d-([01]?\d|2[0-3]):[0-5]\d$/;

/** 历史作息拉取：预检成功后调用；失败静默（不影响导入，用户仍可手动编辑/用默认） */
async function loadSavedTimetables(): Promise<void> {
  isLoadingTimetables.value = true;
  try {
    const list = await ScheduleApi.getTimetables();
    savedTimetables.value = Array.isArray(list) ? list : [];
  } catch (e) {
    // 历史作息只是辅助入口：失败按「没有历史」处理
    savedTimetables.value = [];
  } finally {
    isLoadingTimetables.value = false;
  }
}

/** string[] 作息 → 可编辑行 */
function buildTimetableRows(times: string[]): EditableTimetableSlot[] {
  return (times ?? []).map((timeText) => ({
    key: `timetable-slot-${(timetableRowSeq += 1)}`,
    timeText: (timeText || '').trim(),
  }));
}

/** 给指定作息行数组添加一节 */
function pushTimetableSlot(rows: EditableTimetableSlot[]): void {
  rows.push({ key: `timetable-slot-${(timetableRowSeq += 1)}`, timeText: '' });
}

/** 删除指定作息行数组里的一节 */
function removeTimetableSlot(rows: EditableTimetableSlot[], index: number): void {
  if (index < 0 || index >= rows.length) return;
  rows.splice(index, 1);
}

/** picker 选择历史作息：整表替换当前编辑行 */
function onSavedTimetableChange(event: any): void {
  const index = Number(event?.detail?.value);
  const saved = savedTimetables.value[index];
  if (!saved) return;
  timetableRows.value = buildTimetableRows(saved.times);
}

/** 恢复默认作息：用预检返回的 timetable（文件有则文件作息，否则服务端默认） */
function useDefaultTimetable(): void {
  const preview = importPreview.value;
  if (!preview) return;
  timetableRows.value = buildTimetableRows(preview.timetable);
}

/**
 * 校验一组作息行：每行必填、格式 HH:mm-HH:mm、结束晚于开始；返回第一条错误或 null。
 * 导入预检 / 新建课表 / 作息表模板三处共用。
 */
function validateTimetableSlots(rows: EditableTimetableSlot[]): string | null {
  if (rows.length === 0) return '作息时间表至少要有 1 节';
  for (let i = 0; i < rows.length; i += 1) {
    const label = `第 ${i + 1} 节`;
    const text = (rows[i]!.timeText || '').trim();
    if (!text) return `${label}：时间不能为空`;
    if (!TIMETABLE_TIME_PATTERN.test(text)) {
      return `${label}：格式应为 HH:mm-HH:mm，如 08:00-08:45`;
    }
    const parts = text.split('-');
    const startText = parts[0] ?? '';
    const endText = parts[1] ?? '';
    if (!(toMinutes(endText) > toMinutes(startText))) {
      return `${label}：结束时间要晚于开始时间`;
    }
  }
  return null;
}

/** HH:mm → 当天分钟数（调用前已通过正则校验） */
function toMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/* ---------- 编辑结果校验 / 组装 / 保存 ---------- */

/**
 * 逐行校验编辑后的时间段；返回第一条错误文案（带行号），全部合法返回 null。
 * 规则：课程名非空、星期 1-7、节次/周次可解析、节次 ≤30、周次 ≤ 预检的 weekCount。
 */
function validateImportRows(preview: ScheduleImportPreview): string | null {
  if (importTimeRows.value.length === 0) return '请至少保留一个时间段';
  const weekLimit = Math.max(1, preview.weekCount || 20);
  for (let i = 0; i < importTimeRows.value.length; i += 1) {
    const row = importTimeRows.value[i]!;
    const label = `第 ${i + 1} 个时间段`;
    const courseName = row.courseName.trim();
    if (!courseName) return `${label}：课程名不能为空`;
    if (courseName.length > 100) return `${label}：课程名不能超过 100 个字符`;
    if (!Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 1 || row.dayOfWeek > 7) {
      return `${label}：星期需在 1-7 之间`;
    }
    const sections = parseRangeText(row.sectionListText);
    if (!sections) return `${label}：节次格式不对，示例「1-2」「1,3,5」`;
    if (sections.some((section) => section > MAX_IMPORT_SECTION)) {
      return `${label}：节次不能超过 ${MAX_IMPORT_SECTION}`;
    }
    const weeks = parseRangeText(row.weekListText);
    if (!weeks) return `${label}：周次格式不对，示例「1-16」「1-4,9-16」`;
    if (weeks.some((week) => week > weekLimit)) {
      return `${label}：周次不能超过 ${weekLimit}（预检识别到的学期周数）`;
    }
  }
  return null;
}

/**
 * 把编辑后的行按课程名分组，组装 Confirm 接口需要的 courses：
 * `{ courseName, color, times: [{ dayOfWeek, sectionList, weekList, location, teacher }] }`，
 * 各类 id 全部为 0（尚未入库）。
 */
function buildImportCourses(): Course[] {
  const byCourse = new Map<string, Course>();
  for (const row of importTimeRows.value) {
    const courseName = row.courseName.trim();
    if (!courseName) continue;
    let course = byCourse.get(courseName);
    if (!course) {
      course = {
        id: 0,
        scheduleId: 0,
        courseName,
        color: row.color || '',
        remark: null,
        times: [],
      };
      byCourse.set(courseName, course);
    }
    course.times.push({
      id: 0,
      courseId: 0,
      location: row.location.trim(),
      teacher: row.teacher.trim(),
      weekList: parseRangeText(row.weekListText) ?? [],
      sectionList: parseRangeText(row.sectionListText) ?? [],
      dayOfWeek: row.dayOfWeek,
      remark: null,
    });
  }
  return Array.from(byCourse.values());
}

/**
 * 预检弹层「下一步」：校验编辑结果 → 弹命名输入框 → 统一走 Confirm 保存。
 * Excel 与 OCR 完全一致：都用预览阶段的结果（用户改过的），不再重新上传文件。
 */
async function confirmImportPreview(): Promise<void> {
  const preview = importPreview.value;
  if (!preview) return;

  // 作息在课程明细上方，按页面顺序优先提示
  const timetableError = validateTimetableSlots(timetableRows.value);
  if (timetableError) {
    uni.showModal({
      title: '请检查作息时间表',
      content: timetableError,
      showCancel: false,
      confirmText: '知道了',
    });
    return;
  }

  const validationError = validateImportRows(preview);
  if (validationError) {
    uni.showModal({
      title: '请检查课程明细',
      content: validationError,
      showCancel: false,
      confirmText: '知道了',
    });
    return;
  }

  const courses = buildImportCourses();
  if (courses.length === 0) {
    uni.showModal({
      title: '请检查课程明细',
      content: '没有可保存的课程，请补全课程名',
      showCancel: false,
      confirmText: '知道了',
    });
    return;
  }

  if (isAskingName) return;
  const defaultName = (preview.scheduleName || '').trim();
  let inputName: string | null = null;
  isAskingName = true;
  try {
    inputName = await askScheduleName(defaultName);
  } finally {
    isAskingName = false;
  }
  // 命名弹窗取消：保留预检弹层，用户可以继续修改
  if (inputName === null) return;

  const scheduleName = inputName.trim() || defaultName || '导入的课表';
  // 作息用用户编辑后的（选择历史作息 / 恢复默认 / 手动新建），不再用预检原值
  const timetable = timetableRows.value.map((row) => row.timeText.trim());
  await saveEditedImport(preview, courses, timetable, scheduleName);
}

/** 统一保存入口：Confirm 提交编辑后的课程（不再重新上传/解析文件） */
async function saveEditedImport(
  preview: ScheduleImportPreview,
  courses: Course[],
  timetable: string[],
  scheduleName: string,
): Promise<void> {
  // 先关弹层，避免保存 loading 盖在弹层上
  cancelImportPreview();
  isImporting.value = true;
  uni.showLoading({ title: '保存中...', mask: true });

  let imported: ScheduleDetail | null = null;
  try {
    imported = await ScheduleApi.confirmImport({
      scheduleName,
      startTime: preview.startTime || undefined,
      weekCount: preview.weekCount,
      // 原样传用户编辑后的作息（后端会保留完整节数）
      timetable,
      courses,
    });
  } catch (e: any) {
    // 后端 400/401 的 message 已由 http 层解析成可直接展示的文案
    uni.showModal({
      title: '保存失败',
      content: toApiErrorMessage(e),
      showCancel: false,
      confirmText: '知道了',
    });
  } finally {
    uni.hideLoading();
    isImporting.value = false;
  }

  if (imported) await applyImportResult(imported, courses.length);
}

/**
 * 弹原生「课表名称」输入框（showModal 的 editable 模式）。
 * @param {string} defaultName 默认课表名（作为输入框 placeholder 展示）
 * @returns {Promise<string | null>} 用户输入（可能为空串）；点取消返回 null
 */
function askScheduleName(defaultName: string): Promise<string | null> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '课表名称',
      editable: true,
      placeholderText: defaultName || '请输入课表名称',
      content: defaultName ? `默认名称：${defaultName}（留空使用默认）` : '留空将使用默认名称',
      confirmText: '导入',
      cancelText: '取消',
      success: (res) => resolve(res.confirm ? res.content ?? '' : null),
      fail: () => resolve(null),
    });
  });
}

/** 导入成功统一收尾：toast（编辑后的）课程数 + 刷新课表并切到新导入的课表 */
async function applyImportResult(imported: ScheduleDetail, savedCourseCount?: number): Promise<void> {
  // 优先用「编辑后」的课程数，后端返回的 courseCount 兜底
  const courseCount = savedCourseCount ?? (Number(imported.courseCount) || 0);
  uni.showToast({ title: `已导入 ${courseCount} 门课程`, icon: 'none' });
  // 刷新课表数据并切换到新导入的课表（新 id 可能不在导入前的列表里）
  await applyImportedSchedule(imported);
}

/**
 * 接口失败的统一文案提取：
 * · 上传类接口在 API 层已 reject Error（message 可直接展示）；
 * · http 实例失败时 reject 的是原始响应对象，后端 message 在 `e.data.message`；
 * · 网络错误只有 errMsg，兜底给通用文案。
 */
function toApiErrorMessage(e: any): string {
  if (e instanceof Error) return e.message;
  const data = e?.data;
  const fromBody =
    typeof data === 'string'
      ? data
      : data?.message ?? data?.Message ?? data?.title;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
  return e?.errMsg || '操作失败，请稍后重试';
}

/* ---------- 编辑文本的解析 / 格式化小工具 ---------- */

/** 数字数组 → 区间简写，如 [1,2,3,5] →「1-3,5」 */
function formatRanges(values: number[]): string {
  const sorted = Array.from(
    new Set((values || []).filter((v) => Number.isFinite(v) && v >= 1)),
  ).sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const ranges: string[] = [];
  let rangeStart = sorted[0]!;
  let prev = rangeStart;
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
    rangeStart = current;
    prev = current;
  }
  ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
  return ranges.join(',');
}

/**
 * 区间文本 → 数字数组，如「1-4」「1,3,5」「1-4,9-16」→ [1,2,3,4,9,...,16]。
 * 兼容用户从别处粘贴的「第1-2节」写法；格式非法返回 null。
 */
function parseRangeText(text: string): number[] | null {
  const normalized = (text || '')
    .replace(/[第周节次\s]/g, '')
    .replace(/[，、;；]/g, ',');
  if (!normalized) return null;
  const result = new Set<number>();
  for (const part of normalized.split(',')) {
    if (!part) return null;
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 1 || end < start) return null;
    // 防止误输入超大区间（周次/节次都只有几十）
    if (end - start > 200) return null;
    for (let value = start; value <= end; value += 1) result.add(value);
  }
  return result.size > 0 ? Array.from(result).sort((a, b) => a - b) : null;
}

/* ============================================================
   课表 / 作息表管理：新建课表（也支持编辑当前课表）与作息表模板 CRUD
   ============================================================ */

/** 后端允许的学期周数上限（ScheduleController.MaxWeekCount） */
const MAX_WEEK_COUNT = 100;

/** 内置默认作息（与后端 TimetableExcelParser.DefaultTimetable 的 12 节一致） */
const DEFAULT_TIMETABLE = [
  '08:00-08:45',
  '08:55-09:40',
  '10:00-10:45',
  '10:55-11:40',
  '14:00-14:45',
  '14:55-15:40',
  '16:00-16:45',
  '16:55-17:40',
  '19:00-19:45',
  '19:55-20:40',
  '20:50-21:35',
  '21:45-22:30',
];

/** 统一的信息弹窗（只有一个「知道了」） */
function showInfoModal(title: string, content: string): void {
  uni.showModal({ title, content, showCancel: false, confirmText: '知道了' });
}

/** 本周一（yyyy-MM-dd）：新建课表的默认开课日期 */
function thisMondayString(): string {
  const now = new Date();
  const weekday = now.getDay() || 7; // 周日 = 7，周一 = 1
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (weekday - 1));
  return toLocalDateOnlyString(monday);
}

/* ---------- 新建 / 编辑课表弹层 ---------- */

/** 课表编辑弹层是否显示 */
const scheduleEditorVisible = ref(false);
/** 正在编辑的课表 ID（null = 新建） */
const editingScheduleId = ref<number | null>(null);
/** 课表表单：名称 / 开课日期 / 学期周数（周数用文本存，保存时再转数字校验） */
const scheduleForm = reactive({
  scheduleName: '',
  startTime: '',
  weekCountText: '20',
  /** 备注：表单不展示，但编辑当前课表时原样带回，避免 POST 把原备注清空 */
  remark: '',
});
/** 课表弹层里的作息编辑行 */
const scheduleEditorRows = ref<EditableTimetableSlot[]>([]);
/** 「使用默认作息」要恢复的时间：新建 = 内置默认；编辑 = 当前课表原作息 */
const scheduleEditorDefaultTimes = ref<string[]>([]);
/** 课表保存中（防重复提交） */
const isSavingSchedule = ref(false);

/** 打开「新建课表」 */
function openCreateSchedule(): void {
  editingScheduleId.value = null;
  scheduleForm.scheduleName = '';
  scheduleForm.startTime = thisMondayString();
  scheduleForm.weekCountText = '20';
  scheduleForm.remark = '';
  scheduleEditorDefaultTimes.value = [...DEFAULT_TIMETABLE];
  scheduleEditorRows.value = buildTimetableRows(DEFAULT_TIMETABLE);
  scheduleEditorVisible.value = true;
  // 供「套用已保存的作息」picker 使用（失败静默）
  void loadSavedTimetables();
}

/** 打开「编辑当前课表」：只改名称 / 日期 / 周数 / 作息，现有课程不受影响 */
function openEditCurrentSchedule(): void {
  const current = currentSchedule.value;
  if (!current) return;
  const currentTimetable = [...(current.timetable ?? [])];
  editingScheduleId.value = current.id;
  scheduleForm.scheduleName = current.scheduleName || '';
  scheduleForm.startTime = current.startTime || thisMondayString();
  scheduleForm.weekCountText = String(current.weekCount || 20);
  scheduleForm.remark = current.remark ?? '';
  scheduleEditorDefaultTimes.value =
    currentTimetable.length > 0 ? currentTimetable : [...DEFAULT_TIMETABLE];
  scheduleEditorRows.value = buildTimetableRows(scheduleEditorDefaultTimes.value);
  scheduleEditorVisible.value = true;
  void loadSavedTimetables();
}

/** 关闭课表弹层（保存中不响应，避免关掉 loading 上下文） */
function closeScheduleEditor(): void {
  if (isSavingSchedule.value) return;
  scheduleEditorVisible.value = false;
  editingScheduleId.value = null;
  scheduleEditorRows.value = [];
}

/** 开课日期 picker 变更 */
function onScheduleDateChange(event: any): void {
  scheduleForm.startTime = String(event?.detail?.value ?? '');
}

/** 课表弹层：套用已保存的作息（picker） */
function onScheduleEditorSavedTimetableChange(event: any): void {
  const index = Number(event?.detail?.value);
  const saved = savedTimetables.value[index];
  if (!saved) return;
  scheduleEditorRows.value = buildTimetableRows(saved.times);
}

/** 课表弹层：恢复默认作息 */
function useDefaultScheduleTimetable(): void {
  const times =
    scheduleEditorDefaultTimes.value.length > 0
      ? scheduleEditorDefaultTimes.value
      : DEFAULT_TIMETABLE;
  scheduleEditorRows.value = buildTimetableRows(times);
}

/** 保存课表（新建 / 编辑共用） */
async function saveScheduleEditor(): Promise<void> {
  if (isSavingSchedule.value) return;

  const scheduleName = scheduleForm.scheduleName.trim();
  if (!scheduleName) {
    showInfoModal('请检查课表信息', '课表名称不能为空');
    return;
  }
  if (scheduleName.length > 100) {
    showInfoModal('请检查课表信息', '课表名称不能超过 100 个字符');
    return;
  }

  const startTime = scheduleForm.startTime.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startTime) || Number.isNaN(parseDateOnly(startTime).getTime())) {
    showInfoModal('请检查课表信息', '请选择开课日期');
    return;
  }

  const weekCount = Number(scheduleForm.weekCountText);
  if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > MAX_WEEK_COUNT) {
    showInfoModal('请检查课表信息', `学期周数需在 1-${MAX_WEEK_COUNT} 之间`);
    return;
  }

  const timetableError = validateTimetableSlots(scheduleEditorRows.value);
  if (timetableError) {
    showInfoModal('请检查作息时间表', timetableError);
    return;
  }

  const timetable = scheduleEditorRows.value.map((row) => row.timeText.trim());
  const editingId = editingScheduleId.value;
  const payload: ScheduleEditPayload = {
    scheduleName,
    startTime,
    weekCount,
    timetable,
  };
  if (editingId) {
    payload.id = editingId;
    // 后端 POST 会整体覆盖备注：编辑时把原备注带回去，避免被清空（新建不传）
    payload.remark = scheduleForm.remark;
  }

  isSavingSchedule.value = true;
  uni.showLoading({ title: '保存中...', mask: true });
  try {
    const detail = await ScheduleApi.createSchedule(payload);
    scheduleEditorVisible.value = false;
    editingScheduleId.value = null;
    scheduleEditorRows.value = [];
    uni.showToast({ title: editingId ? '课表已更新' : '课表已创建', icon: 'none' });
    // 新建 / 修改后：把返回详情并入列表、刷新并选中该课表（新建会切到新 id）
    await applyImportedSchedule(detail);
  } catch (e: any) {
    showInfoModal('保存失败', toApiErrorMessage(e));
  } finally {
    uni.hideLoading();
    isSavingSchedule.value = false;
  }
}

/* ---------- 作息表管理弹层 ---------- */

/** 作息表管理弹层是否显示 */
const timetableManagerVisible = ref(false);
/** 是否处于模板「新建 / 编辑」表单态（false = 列表态） */
const timetableEditorMode = ref(false);
/** 正在编辑的模板 ID（null = 新建模板） */
const editingTimetableId = ref<number | null>(null);
/** 模板表单：名称 + 时间行 */
const timetableFormName = ref('');
const timetableFormRows = ref<EditableTimetableSlot[]>([]);
/** 模板保存 / 删除中（防重复） */
const isSavingTimetable = ref(false);

/** 打开作息表管理 */
function openTimetableManager(): void {
  timetableManagerVisible.value = true;
  timetableEditorMode.value = false;
  editingTimetableId.value = null;
  timetableFormName.value = '';
  timetableFormRows.value = [];
  void loadSavedTimetables();
}

/** 关闭作息表管理 */
function closeTimetableManager(): void {
  if (isSavingTimetable.value) return;
  timetableManagerVisible.value = false;
  timetableEditorMode.value = false;
  editingTimetableId.value = null;
  timetableFormName.value = '';
  timetableFormRows.value = [];
}

/** 进入「新建作息表」表单（默认带一套内置作息，方便直接改） */
function beginCreateTimetable(): void {
  timetableEditorMode.value = true;
  editingTimetableId.value = null;
  timetableFormName.value = '';
  timetableFormRows.value = buildTimetableRows(DEFAULT_TIMETABLE);
}

/** 进入某个模板的编辑表单（来自课表的只读项不可编辑） */
function beginEditTimetable(item: SavedTimetable): void {
  if (item.fromSchedule || !item.id) return;
  timetableEditorMode.value = true;
  editingTimetableId.value = item.id;
  timetableFormName.value = item.name || '';
  timetableFormRows.value = buildTimetableRows(item.times);
}

/** 退出模板表单，回到列表 */
function cancelTimetableEditor(): void {
  timetableEditorMode.value = false;
  editingTimetableId.value = null;
  timetableFormName.value = '';
  timetableFormRows.value = [];
}

/** 保存作息表模板（新建 / 修改） */
async function saveTimetableTemplate(): Promise<void> {
  if (isSavingTimetable.value) return;

  const name = timetableFormName.value.trim();
  if (!name) {
    showInfoModal('请检查作息表', '作息表名称不能为空');
    return;
  }
  if (name.length > 100) {
    showInfoModal('请检查作息表', '作息表名称不能超过 100 个字符');
    return;
  }

  const timetableError = validateTimetableSlots(timetableFormRows.value);
  if (timetableError) {
    showInfoModal('请检查作息时间表', timetableError);
    return;
  }

  const payload: TimetablePayload = {
    name,
    times: timetableFormRows.value.map((row) => row.timeText.trim()),
  };
  const editingId = editingTimetableId.value;

  isSavingTimetable.value = true;
  uni.showLoading({ title: '保存中...', mask: true });
  try {
    if (editingId) await ScheduleApi.updateTimetable(editingId, payload);
    else await ScheduleApi.createTimetable(payload);
    uni.showToast({ title: editingId ? '作息表已更新' : '作息表已创建', icon: 'none' });
    cancelTimetableEditor();
    await loadSavedTimetables();
  } catch (e: any) {
    showInfoModal('保存失败', toApiErrorMessage(e));
  } finally {
    uni.hideLoading();
    isSavingTimetable.value = false;
  }
}

/** 删除模板前确认（来自课表的只读项不可删） */
function confirmRemoveTimetable(item: SavedTimetable): void {
  if (item.fromSchedule || !item.id) return;
  uni.showModal({
    title: '删除作息表',
    content: `确定删除「${item.name}」吗？已导入课表的作息不受影响。`,
    confirmText: '删除',
    confirmColor: '#ef4444',
    success: (res) => {
      if (res.confirm) void removeTimetable(item);
    },
  });
}

/** 删除作息表模板并刷新列表 */
async function removeTimetable(item: SavedTimetable): Promise<void> {
  if (item.fromSchedule || !item.id) return;
  isSavingTimetable.value = true;
  uni.showLoading({ title: '删除中...', mask: true });
  try {
    await ScheduleApi.removeTimetable(item.id);
    uni.showToast({ title: '已删除', icon: 'none' });
    if (editingTimetableId.value === item.id) cancelTimetableEditor();
    await loadSavedTimetables();
  } catch (e: any) {
    showInfoModal('删除失败', toApiErrorMessage(e));
  } finally {
    uni.hideLoading();
    isSavingTimetable.value = false;
  }
}

// 进入 tab 刷新：watch isActive + onMounted 双保险；
// refresh 内部有并发保护（isLoading/isRefreshing），两个入口不会重复请求。
// 离开 tab 时顺带关掉导入预检弹层，避免遮罩 / 已选临时文件残留到别的 tab。
watch(
  () => props.isActive,
  (active) => {
    if (active) {
      void refresh();
      return;
    }
    // 离开 tab：关掉所有课表相关弹层，避免遮罩残留到别的 tab
    cancelImportPreview();
    closeScheduleEditor();
    closeTimetableManager();
  },
  { immediate: true },
);
onMounted(() => {
  void refresh();
});
</script>

<template>
  <view class="class-tab-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：左侧课表名/周次，右侧「导入」「今天」；MmNavBar 自带等高占位 -->
    <MmNavBar :show-back="false" align="left">
      <template #left>
        <!-- 课表名可用宽度按窗口/胶囊算好，窄屏下省略号截断，避免顶栏挤压两个动作按钮 -->
        <view class="schedule-head" :style="{ maxWidth: scheduleHeadMaxWidth + 'px' }">
          <!-- 多课表时才出现切换入口（uni picker，无额外依赖） -->
          <picker v-if="schedules.length > 1" class="schedule-picker" :range="scheduleNames"
            :value="currentScheduleIndex" @change="onScheduleChange">
            <view class="schedule-name-row" hover-class="mm-hover">
              <text class="schedule-name">{{ currentScheduleName }}</text>
              <text class="picker-arrow">▾</text>
            </view>
          </picker>
          <view v-else class="schedule-name-row">
            <text class="schedule-name">{{ currentScheduleName }}</text>
          </view>
          <text v-if="currentSchedule" class="week-pill">第{{ currentWeek }}/{{ weekCount }}周</text>
        </view>
      </template>
      <template #right>
        <view class="nav-actions">
          <!-- 导入：从微信聊天选 Excel，先预检确认再正式导入 -->
          <view class="import-btn" :class="{ 'is-busy': isImportBusy }" hover-class="mm-hover"
            @click="handleImportClick">
            <text>导入</text>
          </view>
          <view class="today-btn" hover-class="mm-hover" @click="goToday">
            <text>今天</text>
          </view>
        </view>
      </template>
    </MmNavBar>

    <!-- 课表操作工具栏：新建课表 / 作息表 / 编辑当前课表（导入在顶栏右侧） -->
    <view class="schedule-toolbar">
      <view class="toolbar-btn" hover-class="mm-hover" @click="openCreateSchedule">
        <text class="toolbar-btn-text">＋ 新建课表</text>
      </view>
      <view class="toolbar-btn" hover-class="mm-hover" @click="openTimetableManager">
        <text class="toolbar-btn-text">作息表</text>
      </view>
      <view v-if="currentSchedule" class="toolbar-btn" hover-class="mm-hover" @click="openEditCurrentSchedule">
        <text class="toolbar-btn-text">编辑课表</text>
      </view>
    </view>

    <!-- 首屏 loading 骨架 -->
    <view v-if="showSkeleton" class="skeleton-wrap">
      <view class="skeleton-week-bar">
        <view class="skeleton-square"></view>
        <view class="skeleton-text"></view>
        <view class="skeleton-square"></view>
      </view>
      <view class="skeleton-card">
        <view class="skeleton-card-head"></view>
        <view v-for="row in 6" :key="row" class="skeleton-card-row">
          <view v-for="cell in 7" :key="cell" class="skeleton-cell"></view>
        </view>
      </view>
    </view>

    <!-- 没有任何课表 / 加载失败 -->
    <view v-else-if="!currentSchedule" class="empty-state">
      <text class="empty-title">{{ error ? '课表加载失败' : '还没有课表' }}</text>
      <text class="empty-desc">{{ error || '你的课表还没有同步到这里，稍后再来看看吧' }}</text>
      <view v-if="error" class="empty-retry" hover-class="mm-hover" @click="refresh">重新加载</view>
    </view>

    <!-- 课表主体 -->
    <template v-else>
      <!-- 周次切换：上一周 / 第 N 周（本周高亮）/ 下一周 -->
      <view class="week-bar">
        <view class="week-btn" :class="{ disabled: currentWeek <= 1 }" hover-class="mm-hover" @click="prevWeek">
          <view class="chev chev-left"></view>
        </view>
        <view class="week-center">
          <view class="week-title-row">
            <text class="week-title">第 {{ currentWeek }} 周</text>
            <text v-if="isCurrentWeek" class="week-badge">本周</text>
          </view>
          <text class="week-range">{{ weekDateRangeText }}</text>
        </view>
        <view class="week-btn" :class="{ disabled: currentWeek >= weekCount }" hover-class="mm-hover" @click="nextWeek">
          <view class="chev chev-right"></view>
        </view>
      </view>

      <!-- 本周无课 / 课表无课程提示 -->
      <view v-if="hasNoCourseThisWeek && !isRefreshing" class="empty-banner">
        <text class="empty-banner-title">本周暂无课程</text>
        <text class="empty-banner-desc">{{ noCourseDesc }}</text>
      </view>

      <!-- 课表网格：左列固定节次/时间，右侧 7 天横向滚动 -->
      <view class="grid-card">
        <view class="grid-inner" :style="{ height: gridHeight + 'px' }">
          <!-- 左侧固定节次列 -->
          <view class="section-col">
            <view class="section-head">
              <text class="section-head-text">节次</text>
            </view>
            <view v-for="slot in sectionRows" :key="slot.number" class="section-cell">
              <text class="section-no">{{ slot.number }}</text>
              <text class="section-time">{{ slot.startTime }}</text>
            </view>
          </view>

          <!-- 右侧 7 天网格：scroll-view 横向滚动 -->
          <scroll-view class="day-scroll" scroll-x="true">
            <view class="day-grid" :style="{ width: dayGridWidth + 'px' }">
              <view v-for="day in weekDays" :key="day.dayOfWeek" class="day-col"
                :class="{ 'is-today': day.isToday }">
                <view class="day-head" :class="{ 'is-today': day.isToday }">
                  <text class="day-week">{{ day.label }}</text>
                  <text class="day-date">{{ day.dateText }}</text>
                </view>
                <view class="day-body" :style="{ height: bodyHeight + 'px' }">
                  <!-- 背景节次行（画分隔线），课程块绝对定位覆盖其上 -->
                  <view v-for="slot in sectionRows" :key="slot.number" class="slot-row"></view>
                  <view v-for="block in getDayBlocks(day.dayOfWeek)" :key="block.key" class="course-block"
                    :style="courseBlockStyle(block)" hover-class="mm-hover" @click="openCourseDetail(block)">
                    <text class="course-block-name">{{ block.courseName }}</text>
                    <text v-if="block.location" class="course-block-loc">{{ block.location }}</text>
                  </view>
                </view>
              </view>
            </view>
          </scroll-view>
        </view>

        <view class="grid-footer">
          <text class="grid-footer-text">{{ currentScheduleName }} · 第 {{ currentWeek }} 周</text>
          <text class="grid-footer-hint">{{ isRefreshing ? '更新中…' : '左右滑动查看整周' }}</text>
        </view>
      </view>
    </template>

    <!-- 课程详情弹层（只读，无编辑入口） -->
    <view v-if="activeCourse" class="sheet-overlay" @click="closeCourseDetail">
      <view class="sheet-card" @click.stop>
        <view class="sheet-head">
          <view class="sheet-title-row">
            <view class="sheet-color-dot"
              :style="{ backgroundColor: activeCourse.color || 'var(--theme-primary)' }"></view>
            <text class="sheet-title">{{ activeCourse.courseName }}</text>
          </view>
          <view class="sheet-close" hover-class="mm-hover" @click="closeCourseDetail">
            <text class="sheet-close-icon">✕</text>
          </view>
        </view>

        <view class="sheet-body">
          <view class="sheet-row">
            <text class="sheet-label">上课时间</text>
            <text class="sheet-value">{{ courseTimeText(activeCourse) }}</text>
          </view>
          <view class="sheet-row">
            <text class="sheet-label">上课地点</text>
            <text class="sheet-value">{{ activeCourse.location || '未填写' }}</text>
          </view>
          <view class="sheet-row">
            <text class="sheet-label">授课教师</text>
            <text class="sheet-value">{{ activeCourse.teacher || '未填写' }}</text>
          </view>
          <view class="sheet-row">
            <text class="sheet-label">上课周次</text>
            <text class="sheet-value">{{ activeCourse.weekText }}</text>
          </view>
          <view v-if="activeCourse.remark" class="sheet-row">
            <text class="sheet-label">备注</text>
            <text class="sheet-value">{{ activeCourse.remark }}</text>
          </view>
        </view>

        <view class="sheet-footer">
          <view class="sheet-btn" hover-class="mm-hover" @click="closeCourseDetail">
            <text>关闭</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 导入预检弹层：核对并编辑识别结果，确认后命名保存（Excel / OCR 共用） -->
    <view v-if="importPreview" class="sheet-overlay" @click="cancelImportPreview">
      <view class="sheet-card preview-card" @click.stop>
        <view class="sheet-head">
          <view class="sheet-title-row">
            <view class="sheet-color-dot" :style="{ backgroundColor: 'var(--theme-primary)' }"></view>
            <text class="sheet-title">{{ pendingImportKind === 'ocr' ? 'OCR 识别结果' : '确认导入内容' }}</text>
          </view>
          <view class="sheet-close" hover-class="mm-hover" @click="cancelImportPreview">
            <text class="sheet-close-icon">✕</text>
          </view>
        </view>

        <scroll-view scroll-y="true" class="preview-scroll" :style="{ height: previewScrollHeight + 'px' }">
          <!-- OCR 兜底入口的提示：截图/PDF 识别可能有误差，提醒重点核对 -->
          <view v-if="pendingImportKind === 'ocr'" class="preview-ocr-hint">
            <text class="preview-ocr-hint-text">这是截图 / PDF 的 OCR 识别结果，可能存在误差，请重点核对课程名、周次与节次。</text>
          </view>

          <!-- 识别摘要 -->
          <view class="preview-summary">
            <view class="preview-row">
              <text class="preview-label">课表名称</text>
              <text class="preview-value">{{ importPreview.scheduleName || '未命名课表' }}</text>
            </view>
            <view v-if="importPreview.semesterLabel" class="preview-row">
              <text class="preview-label">学期</text>
              <text class="preview-value">{{ importPreview.semesterLabel }}</text>
            </view>
            <view class="preview-row">
              <text class="preview-label">开课日期</text>
              <text class="preview-value">{{ importPreview.startTime || '未识别' }}</text>
            </view>
            <view class="preview-row">
              <text class="preview-label">周数 / 节次</text>
              <text class="preview-value">{{ importPreview.weekCount }} 周 · 每天 {{ importPreview.sectionCount }} 节</text>
            </view>
            <view class="preview-row">
              <text class="preview-label">课程数</text>
              <text class="preview-value">{{ editedCourseCount }} 门 · {{ editedTimeCount }} 个时间段（可编辑）</text>
            </view>
          </view>

          <!-- 后端识别提示（缺教师/缺地点/周次缺失/默认日期等） -->
          <view v-if="importPreview.warnings.length" class="preview-section">
            <text class="preview-section-title">需要确认</text>
            <view class="preview-list">
              <text v-for="(warning, index) in importPreview.warnings" :key="`warn-${index}`"
                class="preview-list-item preview-warning">· {{ warning }}</text>
            </view>
          </view>

          <!-- 时间冲突：不阻止导入，但提醒用户核对 -->
          <view v-if="importPreview.conflicts.length" class="preview-section">
            <text class="preview-section-title preview-conflict-title">时间冲突（仍可导入，请核对）</text>
            <view class="preview-list">
              <text v-for="(conflict, index) in importPreview.conflicts" :key="`conflict-${index}`"
                class="preview-list-item preview-conflict">· {{ conflict }}</text>
            </view>
          </view>

          <!-- 作息时间表：文件有就用文件；文件没有可换历史作息 / 默认 / 手动新建 -->
          <view class="preview-section">
            <text class="preview-section-title">作息时间表（{{ timetableRows.length }} 节）</text>
            <text class="preview-timetable-source">{{ timetableSourceText }}</text>
            <text v-if="timetableHintText" class="preview-timetable-hint">{{ timetableHintText }}</text>

            <view v-for="(slot, slotIndex) in timetableRows" :key="slot.key" class="preview-timetable-row">
              <text class="preview-timetable-no">第 {{ slotIndex + 1 }} 节</text>
              <input class="preview-edit-input preview-timetable-input" v-model="slot.timeText"
                placeholder="HH:mm-HH:mm" placeholder-style="color:#9ca3af;font-size:12px" />
              <view class="preview-edit-del" hover-class="mm-hover" @click="removeTimetableSlot(timetableRows, slotIndex)">
                <text class="preview-edit-del-icon">✕</text>
              </view>
            </view>
            <view v-if="timetableRows.length === 0" class="preview-empty">没有作息时间，请添加或使用默认作息</view>

            <view class="preview-add-row" hover-class="mm-hover" @click="pushTimetableSlot(timetableRows)">
              <text class="preview-add-row-text">＋ 添加一节</text>
            </view>

            <view class="preview-timetable-actions">
              <picker v-if="savedTimetables.length > 0" class="preview-timetable-picker" mode="selector"
                :range="savedTimetableLabels" @change="onSavedTimetableChange">
                <view class="preview-timetable-action" hover-class="mm-hover">
                  <text class="preview-timetable-action-text">使用已保存的作息</text>
                </view>
              </picker>
              <view class="preview-timetable-action" hover-class="mm-hover" @click="useDefaultTimetable">
                <text class="preview-timetable-action-text">使用默认作息</text>
              </view>
            </view>
          </view>

          <!-- 课程明细（可编辑）：一行 = 一个时间段，课程名相同的行保存时合并成一门课 -->
          <view class="preview-section">
            <text class="preview-section-title">课程明细（可编辑 · {{ editedTimeCount }} 个时间段）</text>
            <text class="preview-edit-tip">课程名、地点、教师可直接输入；节次/周次填「1-2」「1-4,9-16」；点 ✕ 删除该行。</text>
            <view v-if="importTimeRows.length === 0" class="preview-empty">没有解析到课程，请点下方「添加时间段」</view>

            <view v-for="(row, rowIndex) in importTimeRows" :key="row.key" class="preview-edit-row">
              <!-- 第一行：课程名 + 删除 -->
              <view class="preview-edit-line">
                <view class="preview-edit-dot"
                  :style="{ backgroundColor: row.color || 'var(--theme-primary)' }"></view>
                <input class="preview-edit-input preview-edit-name" v-model="row.courseName"
                  placeholder="课程名" placeholder-style="color:#9ca3af;font-size:12px" />
                <view class="preview-edit-del" hover-class="mm-hover" @click="removeImportRow(rowIndex)">
                  <text class="preview-edit-del-icon">✕</text>
                </view>
              </view>
              <!-- 第二行：星期 + 节次 + 周次 -->
              <view class="preview-edit-line">
                <picker class="preview-edit-picker" mode="selector" :range="WEEK_DAY_LABELS"
                  :value="row.dayOfWeek - 1" @change="onImportRowDayChange(row, $event)">
                  <view class="preview-edit-picker-box">
                    <text class="preview-edit-picker-text">{{ weekdayLabel(row.dayOfWeek) }}</text>
                    <text class="preview-edit-picker-arrow">▾</text>
                  </view>
                </picker>
                <input class="preview-edit-input preview-edit-num" v-model="row.sectionListText"
                  placeholder="节次 1-2" />
                <input class="preview-edit-input preview-edit-num" v-model="row.weekListText"
                  placeholder="周次 1-16" />
              </view>
              <!-- 第三行：地点 + 教师 -->
              <view class="preview-edit-line">
                <input class="preview-edit-input" v-model="row.location" placeholder="地点" />
                <input class="preview-edit-input" v-model="row.teacher" placeholder="教师" />
              </view>
            </view>

            <view class="preview-add-row" hover-class="mm-hover" @click="addImportRow">
              <text class="preview-add-row-text">＋ 添加时间段</text>
            </view>
          </view>
        </scroll-view>

        <view class="preview-footer">
          <view class="preview-btn preview-btn-cancel" hover-class="mm-hover" @click="cancelImportPreview">
            <text>取消</text>
          </view>
          <view class="preview-btn preview-btn-confirm" hover-class="mm-hover" @click="confirmImportPreview">
            <text>下一步</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 新建 / 编辑课表弹层：名称 + 开课日期 + 学期周数 + 作息时间表 -->
    <view v-if="scheduleEditorVisible" class="sheet-overlay" @click="closeScheduleEditor">
      <view class="sheet-card preview-card" @click.stop>
        <view class="sheet-head">
          <view class="sheet-title-row">
            <view class="sheet-color-dot" :style="{ backgroundColor: 'var(--theme-primary)' }"></view>
            <text class="sheet-title">{{ editingScheduleId ? '编辑课表' : '新建课表' }}</text>
          </view>
          <view class="sheet-close" hover-class="mm-hover" @click="closeScheduleEditor">
            <text class="sheet-close-icon">✕</text>
          </view>
        </view>

        <scroll-view scroll-y="true" class="preview-scroll" :style="{ height: previewScrollHeight + 'px' }">
          <!-- 基本信息 -->
          <view class="preview-section">
            <view class="preview-row">
              <text class="preview-label">课表名称</text>
              <input class="preview-edit-input" v-model="scheduleForm.scheduleName" placeholder="如：2026 春季学期"
                placeholder-style="color:#9ca3af;font-size:12px" />
            </view>
            <view class="preview-row">
              <text class="preview-label">开课日期</text>
              <picker class="form-picker" mode="date" :value="scheduleForm.startTime" @change="onScheduleDateChange">
                <view class="preview-edit-picker-box">
                  <text class="preview-edit-picker-text">{{ scheduleForm.startTime || '选择日期' }}</text>
                  <text class="preview-edit-picker-arrow">▾</text>
                </view>
              </picker>
            </view>
            <view class="preview-row">
              <text class="preview-label">学期周数</text>
              <input class="preview-edit-input" type="number" v-model="scheduleForm.weekCountText" placeholder="20"
                placeholder-style="color:#9ca3af;font-size:12px" />
            </view>
            <text class="preview-edit-tip">学期第一周从开课日期那周算起；周数决定可导入的最大周次。</text>
          </view>

          <!-- 作息时间表：可编辑 / 套用已保存 / 恢复默认 -->
          <view class="preview-section">
            <text class="preview-section-title">作息时间表（{{ scheduleEditorRows.length }} 节）</text>
            <view v-for="(slot, slotIndex) in scheduleEditorRows" :key="slot.key" class="preview-timetable-row">
              <text class="preview-timetable-no">第 {{ slotIndex + 1 }} 节</text>
              <input class="preview-edit-input preview-timetable-input" v-model="slot.timeText"
                placeholder="HH:mm-HH:mm" placeholder-style="color:#9ca3af;font-size:12px" />
              <view class="preview-edit-del" hover-class="mm-hover"
                @click="removeTimetableSlot(scheduleEditorRows, slotIndex)">
                <text class="preview-edit-del-icon">✕</text>
              </view>
            </view>
            <view v-if="scheduleEditorRows.length === 0" class="preview-empty">没有作息时间，请添加或使用默认作息</view>

            <view class="preview-add-row" hover-class="mm-hover" @click="pushTimetableSlot(scheduleEditorRows)">
              <text class="preview-add-row-text">＋ 添加一节</text>
            </view>

            <view class="preview-timetable-actions">
              <picker v-if="savedTimetables.length > 0" class="preview-timetable-picker" mode="selector"
                :range="savedTimetableLabels" @change="onScheduleEditorSavedTimetableChange">
                <view class="preview-timetable-action" hover-class="mm-hover">
                  <text class="preview-timetable-action-text">套用已保存的作息</text>
                </view>
              </picker>
              <view class="preview-timetable-action" hover-class="mm-hover" @click="useDefaultScheduleTimetable">
                <text class="preview-timetable-action-text">使用默认作息</text>
              </view>
            </view>
          </view>
        </scroll-view>

        <view class="preview-footer">
          <view class="preview-btn preview-btn-cancel" hover-class="mm-hover" @click="closeScheduleEditor">
            <text>取消</text>
          </view>
          <view class="preview-btn preview-btn-confirm" hover-class="mm-hover" @click="saveScheduleEditor">
            <text>{{ editingScheduleId ? '保存' : '创建' }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 作息表管理弹层：模板可编辑 / 删除，来自课表的只读展示 -->
    <view v-if="timetableManagerVisible" class="sheet-overlay" @click="closeTimetableManager">
      <view class="sheet-card preview-card" @click.stop>
        <view class="sheet-head">
          <view class="sheet-title-row">
            <view class="sheet-color-dot" :style="{ backgroundColor: 'var(--theme-primary)' }"></view>
            <text class="sheet-title">{{ timetableEditorMode ? (editingTimetableId ? '编辑作息表' : '新建作息表') : '作息表' }}</text>
          </view>
          <view class="sheet-close" hover-class="mm-hover"
            @click="timetableEditorMode ? cancelTimetableEditor() : closeTimetableManager()">
            <text class="sheet-close-icon">✕</text>
          </view>
        </view>

        <!-- 列表态：模板 + 从课表提取的只读作息 -->
        <scroll-view v-if="!timetableEditorMode" scroll-y="true" class="preview-scroll"
          :style="{ height: previewScrollHeight + 'px' }">
          <view class="preview-section">
            <view class="timetable-list-head">
              <text class="preview-section-title">我的作息表（{{ savedTimetables.length }}）</text>
              <view class="timetable-new-btn" hover-class="mm-hover" @click="beginCreateTimetable">
                <text class="timetable-new-btn-text">＋ 新建作息表</text>
              </view>
            </view>

            <view v-if="isLoadingTimetables && savedTimetables.length === 0" class="preview-empty">正在加载作息表…</view>
            <view v-else-if="savedTimetables.length === 0" class="preview-empty">
              还没有保存过作息表，点右上角「新建作息表」创建一套
            </view>

            <view v-for="(item, index) in savedTimetables" :key="`timetable-item-${index}-${item.id}`"
              class="timetable-item">
              <view class="timetable-item-head">
                <text class="timetable-item-name">{{ item.name || '未命名作息' }}</text>
                <text class="timetable-item-badge" :class="{ 'is-readonly': item.fromSchedule }">
                  {{ item.fromSchedule ? '来自课表' : '模板' }}
                </text>
              </view>
              <text class="timetable-item-summary">{{ item.times.length }} 节 · {{ item.times[0] || '未设置' }} 起</text>
              <view v-if="!item.fromSchedule && item.id > 0" class="timetable-item-actions">
                <view class="timetable-item-action" hover-class="mm-hover" @click="beginEditTimetable(item)">
                  <text class="timetable-item-action-text">编辑</text>
                </view>
                <view class="timetable-item-action is-danger" hover-class="mm-hover"
                  @click="confirmRemoveTimetable(item)">
                  <text class="timetable-item-action-text">删除</text>
                </view>
              </view>
            </view>
          </view>
        </scroll-view>

        <!-- 表单态：新建 / 编辑模板（名称 + 时间行） -->
        <scroll-view v-else scroll-y="true" class="preview-scroll"
          :style="{ height: previewScrollHeight + 'px' }">
          <view class="preview-section">
            <view class="preview-row">
              <text class="preview-label">名称</text>
              <input class="preview-edit-input" v-model="timetableFormName" placeholder="如：冬季作息"
                placeholder-style="color:#9ca3af;font-size:12px" />
            </view>
          </view>
          <view class="preview-section">
            <text class="preview-section-title">作息时间（{{ timetableFormRows.length }} 节）</text>
            <view v-for="(slot, slotIndex) in timetableFormRows" :key="slot.key" class="preview-timetable-row">
              <text class="preview-timetable-no">第 {{ slotIndex + 1 }} 节</text>
              <input class="preview-edit-input preview-timetable-input" v-model="slot.timeText"
                placeholder="HH:mm-HH:mm" placeholder-style="color:#9ca3af;font-size:12px" />
              <view class="preview-edit-del" hover-class="mm-hover"
                @click="removeTimetableSlot(timetableFormRows, slotIndex)">
                <text class="preview-edit-del-icon">✕</text>
              </view>
            </view>
            <view v-if="timetableFormRows.length === 0" class="preview-empty">没有作息时间，请添加</view>
            <view class="preview-add-row" hover-class="mm-hover" @click="pushTimetableSlot(timetableFormRows)">
              <text class="preview-add-row-text">＋ 添加一节</text>
            </view>
          </view>
        </scroll-view>

        <view class="preview-footer">
          <template v-if="timetableEditorMode">
            <view class="preview-btn preview-btn-cancel" hover-class="mm-hover" @click="cancelTimetableEditor">
              <text>返回</text>
            </view>
            <view class="preview-btn preview-btn-confirm" hover-class="mm-hover" @click="saveTimetableTemplate">
              <text>保存</text>
            </view>
          </template>
          <template v-else>
            <view class="preview-btn preview-btn-confirm" hover-class="mm-hover" @click="closeTimetableManager">
              <text>关闭</text>
            </view>
          </template>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* ============================================================
   课程页（只读课表）：单色风格 + 小程序网格
   —— 左侧节次列固定、右侧 7 天横向滚动；
   —— 课程块用接口返回的课程色做低透明度浅底 + 左侧原色条，
      其余颜色一律走主题 token（白卡片 / 描边 / 文字 / 强调色）。
   ============================================================ */

.class-tab-container {
  padding: var(--page-pad);
  box-sizing: border-box;
  background-color: var(--bg-color);
  min-height: 100%;
}

/* ---------- 课表操作工具栏（新建课表 / 作息表 / 编辑当前课表） ---------- */
.schedule-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.toolbar-btn {
  height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 8px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
}

.toolbar-btn-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color);
}

/* ---------- 顶栏左右插槽 ---------- */
.schedule-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  /* 实际可用宽度由模板按窗口/胶囊算好；内容超出时省略号截断而不是挤压右侧按钮 */
  overflow: hidden;
}

.schedule-picker {
  flex-shrink: 1;
  min-width: 0;
}

.schedule-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
}

.schedule-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
  max-width: 120px;
  /* 顶栏可用宽度不足时允许收缩，配合 ellipsis 截断 */
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.picker-arrow {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1;
}

.week-pill {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--theme-color-strong);
  background-color: var(--theme-color-soft);
  border-radius: 999px;
  padding: 2px 8px;
}

/* 「导入」「今天」按钮组：36px 行内胶囊热区（导航栏内），样式与已有按钮一致 */
.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.today-btn,
.import-btn {
  height: 36px;
  min-width: 52px;
  padding: 0 12px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  font-size: 13px;
  font-weight: 600;
}

/* 导入中：置灰并屏蔽重复点击（上传期间有全屏 loading 遮罩） */
.import-btn.is-busy {
  opacity: 0.6;
  pointer-events: none;
}

/* ---------- 周次切换条 ---------- */
.week-bar {
  margin-top: 12px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

.week-btn {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  box-sizing: border-box;
}

.week-btn.disabled {
  opacity: 0.35;
  pointer-events: none;
}

/* 左右 chevron：用边框绘制，颜色随 --text-muted（与 MmNavBar 返回箭头同一技法） */
.chev {
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border-style: solid;
  border-color: var(--text-muted);
  border-width: 0 2px 2px 0;
}

.chev-left {
  transform: rotate(135deg);
  margin-left: 3px;
}

.chev-right {
  transform: rotate(-45deg);
  margin-right: 3px;
}

.week-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.week-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.week-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.week-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--theme-color-strong);
  background-color: var(--theme-color-soft);
  border-radius: 999px;
  padding: 1px 6px;
}

.week-range {
  font-size: 11px;
  color: var(--text-muted);
}

/* ---------- 空态 / 空课提示 ---------- */
.empty-state {
  margin-top: 12px;
  padding: 48px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.empty-desc {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.6;
}

.empty-retry {
  margin-top: 8px;
  height: 44px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 10px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  font-size: 14px;
  font-weight: 600;
}

.empty-banner {
  margin-top: 12px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background-color: var(--surface-soft);
  border: 1px dashed var(--border-strong);
  border-radius: var(--card-radius);
}

.empty-banner-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.empty-banner-desc {
  font-size: 11px;
  color: var(--text-muted);
}

/* ---------- 课表网格 ---------- */
.grid-card {
  margin-top: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.grid-inner {
  display: flex;
  align-items: stretch;
  width: 100%;
}

/* 左侧固定节次/时间列 */
.section-col {
  width: 52px;
  flex-shrink: 0;
  background-color: var(--surface-soft);
  border-right: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.section-head {
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.section-head-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

.section-cell {
  height: 62px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-bottom: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.section-cell:last-child {
  border-bottom: none;
}

.section-no {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  line-height: 1;
}

.section-time {
  font-size: 9px;
  color: var(--text-faint);
  line-height: 1;
}

/* 右侧 7 天：scroll-view 横向滚动 */
.day-scroll {
  flex: 1;
  min-width: 0;
  height: 100%;
  white-space: nowrap;
}

.day-grid {
  display: flex;
  height: 100%;
  /* 作为 scroll-view 内容宽度固定为 7 列总宽，禁止被 flex 压缩，保证横向滚动 */
  flex-shrink: 0;
}

.day-col {
  width: 78px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.day-col + .day-col {
  border-left: 1px solid var(--divider-color);
}

.day-head {
  height: 42px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-bottom: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.day-week {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  line-height: 1;
}

.day-date {
  font-size: 9px;
  color: var(--text-faint);
  line-height: 1;
}

/* 今天列：表头浅强调色底 + 强调色文字，列底也略作区分 */
.day-head.is-today {
  background-color: var(--theme-color-soft);
}

.day-head.is-today .day-week,
.day-head.is-today .day-date {
  color: var(--theme-color-strong);
}

.day-col.is-today .day-body {
  background-color: var(--theme-color-softer);
}

.day-body {
  position: relative;
  box-sizing: border-box;
}

/* 背景节次行（只画分隔线），课程块绝对定位覆盖在上面 */
.slot-row {
  height: 62px;
  border-bottom: 1px solid var(--divider-color);
  box-sizing: border-box;
}

.slot-row:last-child {
  border-bottom: none;
}

/* 课程块：浅色底 + 左侧原色条；跨行由内联 top/height 控制 */
.course-block {
  position: absolute;
  left: 2px;
  right: 2px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 4px;
  box-sizing: border-box;
  border-left: 3px solid var(--theme-primary);
  border-radius: 6px;
  overflow: hidden;
}

.course-block-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color);
  line-height: 1.25;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}

.course-block-loc {
  font-size: 9px;
  color: var(--text-muted);
  line-height: 1.2;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.grid-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--divider-color);
}

.grid-footer-text {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.grid-footer-hint {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-faint);
}

/* ---------- 首屏骨架（灰阶全走 token） ---------- */
.skeleton-wrap {
  pointer-events: none;
}

.skeleton-week-bar {
  margin-top: 12px;
  height: 64px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-sizing: border-box;
}

.skeleton-square {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 10px;
  background-color: var(--surface-soft);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton-text {
  flex: 1;
  height: 28px;
  border-radius: 8px;
  background-color: var(--surface-soft);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton-card {
  margin-top: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  overflow: hidden;
}

.skeleton-card-head {
  height: 42px;
  background-color: var(--surface-soft);
  border-bottom: 1px solid var(--divider-color);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton-card-row {
  display: flex;
  gap: 4px;
  padding: 3px 4px;
}

.skeleton-cell {
  flex: 1;
  height: 56px;
  border-radius: 6px;
  background-color: var(--surface-soft);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 0.9;
  }
}

/* ---------- 课程详情弹层 ---------- */
.sheet-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: var(--mask-color);
}

.sheet-card {
  width: 100%;
  max-width: 340px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--theme-outer-glow);
  animation: sheet-in 0.2s ease-out;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--divider-color);
}

.sheet-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sheet-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sheet-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sheet-close {
  width: 44px;
  height: 44px;
  margin: -8px -8px -8px 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.sheet-close-icon {
  font-size: 16px;
  color: var(--text-muted);
  line-height: 1;
}

.sheet-body {
  padding: 4px 16px;
}

.sheet-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--divider-color);
}

.sheet-row:last-child {
  border-bottom: none;
}

.sheet-label {
  width: 64px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.sheet-value {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--text-color);
  line-height: 1.5;
  word-break: break-all;
}

.sheet-footer {
  padding: 12px 16px 16px;
}

.sheet-btn {
  height: var(--control-h);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
  font-size: 15px;
  font-weight: 600;
}

@keyframes sheet-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ---------- 导入预检弹层 ---------- */
/* 面板比课程详情更高：摘要 + 提示 + 课程明细一起放在可滚动区域里 */
.preview-card {
  max-width: 380px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
}

/* 内容区高度由模板按窗口高度算好（scroll-view 需要明确高度），这里只负责观感 */
.preview-scroll {
  flex-shrink: 0;
  box-sizing: border-box;
}

/* OCR 识别结果提示条：放在滚动区顶部，提醒用户核对识别误差 */
.preview-ocr-hint {
  margin: 10px 16px 2px;
  padding: 8px 10px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  border-radius: 8px;
  box-sizing: border-box;
}

.preview-ocr-hint-text {
  font-size: 11px;
  line-height: 1.5;
  color: var(--theme-color-strong);
  word-break: break-all;
}

.preview-summary {
  padding: 4px 16px;
}

.preview-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--divider-color);
}

.preview-row:last-child {
  border-bottom: none;
}

.preview-label {
  width: 68px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.preview-value {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-color);
  line-height: 1.5;
  word-break: break-all;
}

.preview-section {
  padding: 6px 16px 0;
}

.preview-section-title {
  display: block;
  margin: 8px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.preview-conflict-title {
  color: var(--color-danger-text);
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.preview-list-item {
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

/* 橙色提示：读起来「需要注意但可继续」 */
.preview-warning {
  color: var(--color-warning-text);
}

/* 红色冲突：只提醒核对，不阻止导入 */
.preview-conflict {
  color: var(--color-danger-text);
}

.preview-empty {
  padding: 8px 0;
  font-size: 12px;
  color: var(--text-faint);
}

/* ---------- 预检弹层里的可编辑课程明细 ---------- */

/* 操作提示：告诉用户哪些能改、节次/周次怎么写 */
.preview-edit-tip {
  display: block;
  margin: 2px 0 8px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-faint);
  word-break: break-all;
}

/* 一行 = 一个时间段：三行式布局（课程名 / 星期+节次+周次 / 地点+教师） */
.preview-edit-row {
  margin-bottom: 8px;
  padding: 8px 8px 6px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-sizing: border-box;
}

.preview-edit-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-edit-line + .preview-edit-line {
  margin-top: 6px;
}

/* 课程色小圆点：沿用预检返回的课程颜色 */
.preview-edit-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
}

/* 输入框：32px 高，主题 token 配色；小程序 input 默认有内边距，这里统一 box-sizing */
.preview-edit-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  box-sizing: border-box;
  font-size: 12px;
  color: var(--text-color);
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.preview-edit-name {
  font-weight: 600;
}

/* 节次 / 周次输入框稍窄一些，星期 picker 固定宽度 */
.preview-edit-num {
  flex: 1;
}

.preview-edit-picker {
  width: 64px;
  flex-shrink: 0;
}

.preview-edit-picker-box {
  height: 32px;
  padding: 0 6px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.preview-edit-picker-text {
  font-size: 12px;
  color: var(--text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-edit-picker-arrow {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1;
}

/* 新建课表表单里的日期 picker：占满 label 之后的空间 */
.form-picker {
  flex: 1;
  min-width: 0;
}

/* 删除按钮：36px 触控热区 */
.preview-edit-del {
  width: 36px;
  height: 36px;
  margin: -2px -4px -2px 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.preview-edit-del-icon {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1;
}

/* 添加时间段：虚线按钮，40px 高 */
.preview-add-row {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  background-color: transparent;
}

.preview-add-row-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-color-strong);
}

/* ---------- 预检弹层里的作息时间表 ---------- */

/* 来源提示：已从文件读取 N 节作息 / 文件里没有作息 */
.preview-timetable-source {
  display: block;
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--theme-color-strong);
}

/* 无作息时的引导 / 加载中提示 */
.preview-timetable-hint {
  display: block;
  margin: 0 0 8px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-faint);
  word-break: break-all;
}

/* 一行 = 一节课的起止时间：第 N 节 + 时间 input + 删除 */
.preview-timetable-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.preview-timetable-no {
  width: 44px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.preview-timetable-input {
  flex: 1;
  min-width: 0;
}

/* 历史作息 / 默认作息按钮组 */
.preview-timetable-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.preview-timetable-picker {
  flex: 1;
  min-width: 0;
}

.preview-timetable-action {
  flex: 1;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 8px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
}

.preview-timetable-action-text {
  font-size: 12px;
  font-weight: 600;
}

/* ---------- 作息表管理弹层 ---------- */

.timetable-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.timetable-new-btn {
  height: 32px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 8px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
}

.timetable-new-btn-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--theme-color-strong);
}

.timetable-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--divider-color);
}

.timetable-item:last-child {
  border-bottom: none;
}

.timetable-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.timetable-item-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.timetable-item-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--theme-color-strong);
  background-color: var(--theme-color-soft);
  border-radius: 999px;
  padding: 1px 6px;
}

.timetable-item-badge.is-readonly {
  color: var(--text-muted);
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
}

.timetable-item-summary {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-faint);
}

.timetable-item-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.timetable-item-action {
  height: 30px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 6px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
}

.timetable-item-action-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color);
}

.timetable-item-action.is-danger .timetable-item-action-text {
  color: var(--color-danger-text);
}

.preview-footer {
  display: flex;
  gap: 10px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.preview-btn {
  flex: 1;
  height: var(--control-h);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  box-sizing: border-box;
}

.preview-btn-cancel {
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  color: var(--text-color);
}

.preview-btn-confirm {
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
}
</style>
