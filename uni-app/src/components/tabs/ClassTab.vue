<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import MmNavBar from '@/components/MmNavBar.vue';
import { useThemeStore } from '@/stores/theme';
import useSchedule, { type ScheduleBlock } from '@/features/Curriculum/useSchedule';
import { ScheduleApi } from '@/libs/api/schedule';
import type {
  CourseTime,
  ScheduleDetail,
  ScheduleImportPreview,
} from '@/libs/api/schedule/type';
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
 *    先走后端预检（Excel 解析、图片/PDF 走 OCR）、弹层确认识别结果并填课表名，
 *    再按类型保存（Excel 重新上传 Import、OCR 走 Confirm 回传预检结果），
 *    成功后刷新并切换到新导入的课表；进入 tab 时自动刷新（isActive watch + onMounted）。
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
   导入课表（两步，两套保存）：
   · Excel(.xlsx/.xls)：预检解析 → 命名 → 重新上传 Import
   · 截图/PDF：OCR 预检识别 → 命名 → Confirm 回传预检结果保存
   ============================================================ */

/** 微信聊天里可选的导入文件后缀：Excel 走解析，PDF/图片走 OCR 兜底 */
const EXCEL_IMPORT_EXTENSIONS = ['xlsx', 'xls'];
const OCR_IMPORT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp'];
const IMPORT_EXTENSIONS = [...EXCEL_IMPORT_EXTENSIONS, ...OCR_IMPORT_EXTENSIONS];

/** 文件大小上限：Excel 10MB；PDF/图片 OCR 30MB（与后端 RequestSizeLimit 一致） */
const MAX_EXCEL_FILE_SIZE = 10 * 1024 * 1024;
const MAX_OCR_FILE_SIZE = 30 * 1024 * 1024;

/** 导入方式：Excel 解析 / OCR 识别 */
type ImportFileKind = 'excel' | 'ocr';

/** 微信 chooseMessageFile 返回的聊天文件（只取上传 / 分流要用的字段） */
interface ChosenMessageFile {
  /** 原始文件名（含后缀；微信临时路径没有后缀时用它判断类型） */
  name: string;
  /** 本地临时文件路径（uni.uploadFile 用；预检与正式导入复用同一个） */
  path: string;
  /** 文件大小（字节），用于上传前拦截超限文件 */
  size: number;
}

/** 预检（解析 / 识别）中：防止重复选文件 / 重复请求 */
const isPreviewing = ref(false);
/** 正式导入中：防止重复提交 */
const isImporting = ref(false);
/** 预检结果：非 null 时展示预检弹层 */
const importPreview = ref<ScheduleImportPreview | null>(null);
/** 预检对应的导入方式：决定弹层文案与「下一步」走哪套保存逻辑 */
const pendingImportKind = ref<ImportFileKind | null>(null);
/** 已选好的文件：Excel 流程点「下一步」后要重新上传；OCR 流程只是留档 */
const pendingImportFile = ref<ChosenMessageFile | null>(null);
/** 导入流程任一环节进行中：用于「导入」按钮置灰和入口防重 */
const isImportBusy = computed(() => isPreviewing.value || isImporting.value);

/** 预检弹层内容区高度：约半屏，保证面板放得下且内部可滚动（scroll-view 需要明确高度） */
const previewScrollHeight = Math.max(
  220,
  Math.round((getWindowInfoCompat().windowHeight || 640) * 0.52),
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

/** 第一步：上传文件做预检（Excel 解析 / OCR 识别，均不写库），成功后弹确认面板 */
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
    pendingImportFile.value = file;
    pendingImportKind.value = kind;
    importPreview.value = preview;
  } catch (e: any) {
    uni.showModal({
      title: kind === 'ocr' ? '识别失败' : '解析失败',
      content: toImportErrorMessage(e),
      showCancel: false,
      confirmText: '知道了',
    });
  } finally {
    uni.hideLoading();
    isPreviewing.value = false;
  }
}

/** 关闭预检弹层并丢弃已选文件（取消导入 / 离开 tab 时调用） */
function cancelImportPreview(): void {
  importPreview.value = null;
  pendingImportKind.value = null;
  pendingImportFile.value = null;
}

/** 预检弹层「下一步」：关弹层 → 让用户输入课表名 → 按导入方式保存 */
async function confirmImportPreview(): Promise<void> {
  const preview = importPreview.value;
  const file = pendingImportFile.value;
  const kind = pendingImportKind.value;
  if (!preview || !file || !kind) return;

  const defaultName = (preview.scheduleName || '').trim();
  cancelImportPreview();

  const inputName = await askScheduleName(defaultName);
  // 用户在命名弹窗点取消：什么都不做，回到课表页
  if (inputName === null) return;
  const typedName = inputName.trim();

  if (kind === 'ocr') {
    // OCR：文件已经识别过，直接把预检结果提交保存；课表名留空时用预检默认名
    await confirmOcrImport(preview, typedName || defaultName || '导入的课表');
    return;
  }

  // Excel：输入为空就不传，让后端用文件内标题 / 文件名兜底（比传默认名更稳）
  await importScheduleFile(file, typedName || undefined);
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

/** 第二步-A（Excel）：重新上传文件并保存；成功后 toast 课程数、刷新并切换 */
async function importScheduleFile(file: ChosenMessageFile, scheduleName?: string): Promise<void> {
  isImporting.value = true;
  uni.showLoading({ title: '导入中...', mask: true });

  let imported: ScheduleDetail | null = null;
  try {
    imported = await ScheduleApi.importFile(file.path, scheduleName ? { scheduleName } : {});
  } catch (e: any) {
    // 后端 400/401 的 message 已由 API 层解析成可直接展示的文案
    uni.showModal({
      title: '导入失败',
      content: toImportErrorMessage(e),
      showCancel: false,
      confirmText: '知道了',
    });
  } finally {
    uni.hideLoading();
    isImporting.value = false;
  }

  if (imported) await applyImportResult(imported);
}

/**
 * 第二步-B（OCR）：把预检结果原样提交保存，不再上传文件。
 * 有预检结果就说明 OCR 已经跑完，用户改的只是课表名，没必要再识别一次。
 */
async function confirmOcrImport(preview: ScheduleImportPreview, scheduleName: string): Promise<void> {
  isImporting.value = true;
  uni.showLoading({ title: '保存中...', mask: true });

  let imported: ScheduleDetail | null = null;
  try {
    imported = await ScheduleApi.confirmImport({
      scheduleName,
      startTime: preview.startTime || undefined,
      weekCount: preview.weekCount,
      timetable: preview.timetable,
      // 预检课程直接回传（id/scheduleId 都是 0，服务端按同样规则校验后入库）
      courses: preview.courses,
    });
  } catch (e: any) {
    uni.showModal({
      title: '保存失败',
      content: toImportErrorMessage(e),
      showCancel: false,
      confirmText: '知道了',
    });
  } finally {
    uni.hideLoading();
    isImporting.value = false;
  }

  if (imported) await applyImportResult(imported);
}

/** 导入成功统一收尾：toast 课程数 + 刷新课表并切到新导入的课表 */
async function applyImportResult(imported: ScheduleDetail): Promise<void> {
  // 课程数来自后端解析 / 识别结果
  const courseCount = Number(imported.courseCount) || 0;
  uni.showToast({ title: `已导入 ${courseCount} 门课程`, icon: 'none' });
  // 刷新课表数据并切换到新导入的课表（新 id 可能不在导入前的列表里）
  await applyImportedSchedule(imported);
}

/** 上传 / 预检失败的统一文案提取（后端 message 已由 API 层解析好） */
function toImportErrorMessage(e: any): string {
  return e instanceof Error ? e.message : e?.errMsg || '操作失败，请稍后重试';
}

/* ---------- 预检弹层里的课程格式化 ---------- */

/** 时间段一行：周一 第9-10节 · 第1-4,9-16周 · E405 · 王雪山 */
function formatImportTime(time: CourseTime): string {
  const parts = [
    `${weekdayLabel(time.dayOfWeek)} ${formatImportSections(time.sectionList)}`,
    formatImportWeeks(time.weekList),
    time.location || '地点未识别',
    time.teacher || '教师未识别',
  ];
  return parts.join(' · ');
}

/** 节次数组 → 「第9-10节」「第3节」「第1-2、4节」 */
function formatImportSections(sections: number[]): string {
  const ranges = formatNumberRanges(sections, '、');
  return ranges ? `第${ranges}节` : '节次未识别';
}

/** 周次数组 → 「第1-4,9-16周」 */
function formatImportWeeks(weeks: number[]): string {
  const ranges = formatNumberRanges(weeks, ',');
  return ranges ? `第${ranges}周` : '周次未识别';
}

/**
 * 数字数组 → 区间简写，如 [1,2,3,5] →「1-3、5」或「1-3,5」。
 * @param {number[]} values 原始数组（可能乱序 / 重复）
 * @param {string} separator 区间之间的分隔符（节次用「、」，周次用「,」）
 */
function formatNumberRanges(values: number[], separator: string): string {
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
  return ranges.join(separator);
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
    cancelImportPreview();
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

    <!-- 导入预检弹层：先让用户核对后端识别结果，再进入命名保存 -->
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
              <text class="preview-label">识别结果</text>
              <text class="preview-value">{{ importPreview.courseCount }} 门课程 · {{ importPreview.timeCount }} 个时间段</text>
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

          <!-- 课程明细：每门课列出它的时间段，方便核对解析对不对 -->
          <view class="preview-section">
            <text class="preview-section-title">课程明细（{{ importPreview.courses.length }} 门）</text>
            <view v-if="importPreview.courses.length === 0" class="preview-empty">没有解析到课程</view>
            <view v-for="(course, courseIndex) in importPreview.courses" :key="`import-course-${courseIndex}`"
              class="preview-course">
              <view class="preview-course-head">
                <view class="preview-course-dot"
                  :style="{ backgroundColor: course.color || 'var(--theme-primary)' }"></view>
                <text class="preview-course-name">{{ course.courseName || '未命名课程' }}</text>
              </view>
              <text v-for="(time, timeIndex) in course.times" :key="`import-time-${courseIndex}-${timeIndex}`"
                class="preview-time">{{ formatImportTime(time) }}</text>
              <text v-if="!course.times || course.times.length === 0"
                class="preview-time preview-time-empty">没有时间段</text>
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

.preview-course {
  padding: 8px 0;
  border-bottom: 1px solid var(--divider-color);
}

.preview-course:last-child {
  border-bottom: none;
}

.preview-course-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}

.preview-course-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.preview-course-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  word-break: break-all;
}

.preview-time {
  display: block;
  margin-top: 2px;
  padding-left: 14px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
  word-break: break-all;
}

.preview-time-empty {
  color: var(--text-faint);
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
