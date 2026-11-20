/**
 * @file 课表数据 composable（小程序端，只读）
 * @description 负责：加载课表列表/详情、计算当前教学周、按「当前周 + 星期」把 Course
 * 映射成课表网格里可直接渲染的课程块（支持一门课跨多节合并、多课表切换、周次切换）。
 *
 * 业务规则（见 _log/ui-refactor/schedule-feature-spec.md 第二节）：
 * · 当前周 = clamp(floor((今天 - startTime) / 7) + 1, 1, weekCount)；
 * · sectionList 是 1-based 节次，对应 timetable[section-1] 的时间段；
 * · 一门课的 times 每项是一段（不同星期 / 周次 / 地点），按当前周与星期过滤。
 *
 * 本文件只做数据与计算，不包含任何 UI；颜色仅把接口返回的课程色转成低透明度浅底，
 * 其余颜色由页面用主题 CSS 变量渲染。
 */

import { computed, ref } from 'vue';
import { ScheduleApi } from '@/libs/api/schedule/index';
import type {
  Course,
  CourseTime,
  ScheduleDetail,
  ScheduleSummary,
} from '@/libs/api/schedule/type';
import { padNumber, parseDateOnly, toLocalDateOnlyString } from '@/utils/date';

/** 星期标签，下标 0 对应周一（dayOfWeek = 1） */
export const WEEK_DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 课表网格中的一个渲染块（一门课的一段连续节次） */
export interface ScheduleBlock {
  /** 渲染唯一 key：课程 + 时间段 + 节次段 */
  key: string;
  /** 课程 ID */
  courseId: number;
  /** 课程名称 */
  courseName: string;
  /** 课程原色（左侧条用） */
  color: string;
  /** 课程色的低透明度浅底（块背景用，rgba 字符串；非法色值时为空串） */
  tint: string;
  /** 上课地点 */
  location: string;
  /** 授课教师 */
  teacher: string;
  /** 备注（优先时间段备注，其次课程备注） */
  remark: string | null;
  /** 星期几 1-7 */
  dayOfWeek: number;
  /** 起始节次（1-based） */
  sectionStart: number;
  /** 跨节数量（如 [1,2] 为 2） */
  sectionSpan: number;
  /** 节次文案，如「第1-2节」 */
  sectionText: string;
  /** 时间文案，如「08:00-09:40」 */
  timeText: string;
  /** 周次文案，如「第1-16周」 */
  weekText: string;
  /** 生效周次（详情弹层展示用） */
  weekList: number[];
}

/** 一周 7 天的日期信息 */
export interface WeekDayInfo {
  /** 星期几 1-7 */
  dayOfWeek: number;
  /** 周一/周二… */
  label: string;
  /** 月 */
  month: number;
  /** 日 */
  day: number;
  /** MM/DD */
  dateText: string;
  /** 是否今天 */
  isToday: boolean;
}

/** 节次行信息（左侧固定列） */
export interface SectionRow {
  /** 节次序号（1-based） */
  number: number;
  /** 该节开始时间，如 08:00 */
  startTime: string;
  /** 该节完整时间段，如 08:00-08:45 */
  fullTime: string;
}

/** 数值裁剪 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 计算「第几周」：今天在学期开始前 → 第 1 周；结束后 → 最后一周。
 * @param startTime 学期第一周周一（yyyy-MM-dd）
 * @param weekCount 学期总周数
 */
export function calcCurrentWeek(startTime: string, weekCount: number): number {
  const totalWeeks = Math.max(1, weekCount || 1);
  if (!startTime) return 1;
  const start = parseDateOnly(startTime);
  if (Number.isNaN(start.getTime())) return 1;
  start.setHours(0, 0, 0, 0);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
  if (!Number.isFinite(diffDays)) return 1;
  return clamp(Math.floor(diffDays / 7) + 1, 1, totalWeeks);
}

/**
 * #RRGGBB / #RGB → rgba(r, g, b, alpha)。
 * 小程序不支持 color-mix()，所以课程块的浅底在 JS 里算好再用。
 * @param color 接口返回的课程色
 * @param alpha 透明度 0-1
 * @returns rgba 字符串；无法解析时返回空串（页面会回退到主题浅底）
 */
export function hexToRgba(color: string, alpha: number): string {
  const value = (color || '').trim().replace('#', '');
  if (!/^[\da-f]{3}$|^[\da-f]{6}$/i.test(value)) return '';
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const safeAlpha = clamp(alpha, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

/**
 * 把节次数组拆成连续段，例如 [1,2,4] → [[1,2],[4]]。
 * 课程块按连续段跨行合并，避免不连续节次被错误连成一大块。
 */
function splitConsecutiveSections(sections: number[]): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  for (const section of sections) {
    const last = current[current.length - 1];
    if (last !== undefined && section === last + 1) {
      current.push(section);
    } else {
      if (current.length > 0) runs.push(current);
      current = [section];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** 周次数组 → 简写文案，如 [1,2,3,5] → 「第1-3、5周」 */
function formatWeekList(weekList: number[]): string {
  if (weekList.length === 0) return '未设置周次';
  const ranges: string[] = [];
  let rangeStart = weekList[0]!;
  let prev = rangeStart;
  for (let i = 1; i < weekList.length; i += 1) {
    const current = weekList[i]!;
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
    rangeStart = current;
    prev = current;
  }
  ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
  return `第${ranges.join('、')}周`;
}

/** 合并跨节的起止时间：取起始节开始时间 ~ 结束节结束时间 */
function formatTimeRange(timetable: string[], startSection: number, endSection: number): string {
  const first = timetable[startSection - 1] ?? '';
  const last = timetable[endSection - 1] ?? '';
  const startTime = first.split('-')[0]?.trim() ?? '';
  const endTime = last.split('-')[1]?.trim() ?? '';
  if (!startTime || !endTime) return '';
  return `${startTime}-${endTime}`;
}

/**
 * 课表 page 级 composable：加载 + 当前周 + 课程块映射。
 * 页面只需调用 `refresh()` 并按需使用返回的 ref/computed。
 */
export default function useSchedule() {
  /** 我的课表列表 */
  const schedules = ref<ScheduleSummary[]>([]);
  /** 当前课表详情（含课程） */
  const detail = ref<ScheduleDetail | null>(null);
  /** 当前选中的课表 ID */
  const currentScheduleId = ref<number | null>(null);
  /** 当前查看的教学周（1..weekCount） */
  const currentWeek = ref(1);
  /** 首屏加载中（用于骨架屏） */
  const isLoading = ref(false);
  /** 已有数据时的静默刷新（不闪骨架） */
  const isRefreshing = ref(false);
  /** 是否成功完成过一次加载（用于区分「首次加载」与「空数据」） */
  const hasLoaded = ref(false);
  /** 错误信息（页面展示空态时可复用） */
  const error = ref<string | null>(null);

  /** 当前课表概要 */
  const currentSchedule = computed<ScheduleSummary | null>(
    () => schedules.value.find((item) => item.id === currentScheduleId.value) ?? null,
  );

  /** 当前课表名称（空态兜底文案） */
  const currentScheduleName = computed(
    () => currentSchedule.value?.scheduleName || '我的课表',
  );

  /** 课表总周数（至少 1，避免除法/边界问题） */
  const weekCount = computed(() => Math.max(1, currentSchedule.value?.weekCount ?? 1));

  /** 作息时间表（下标 + 1 = 节次） */
  const timetable = computed<string[]>(() => currentSchedule.value?.timetable ?? []);

  /** 节次行（左侧固定列） */
  const sectionRows = computed<SectionRow[]>(() =>
    timetable.value.map((fullTime, index) => {
      const startTime = (fullTime || '').split('-')[0]?.trim() ?? '';
      return { number: index + 1, startTime, fullTime };
    }),
  );

  /** 节次总数（至少 1，保证网格有基础行数） */
  const sectionCount = computed(() => Math.max(1, timetable.value.length));

  /** 当前课表的课程列表 */
  const courses = computed<Course[]>(() => detail.value?.courses ?? []);

  /** 今天所在的教学周（当前周按钮 / 初次进入定位用） */
  const todayWeek = computed(() => calcCurrentWeek(currentSchedule.value?.startTime ?? '', weekCount.value));

  /** 当前查看的是否为「本周」 */
  const isCurrentWeek = computed(() => currentWeek.value === todayWeek.value);

  /** 用户可切换的课表名称列表（picker 用） */
  const scheduleNames = computed(() => schedules.value.map((item) => item.scheduleName));

  /** 当前课表在列表中的下标（picker 的 value） */
  const currentScheduleIndex = computed(() => {
    const index = schedules.value.findIndex((item) => item.id === currentScheduleId.value);
    return index >= 0 ? index : 0;
  });

  /** 当前周的 7 天日期信息（今天所在列高亮） */
  const weekDays = computed<WeekDayInfo[]>(() => {
    const startTime = currentSchedule.value?.startTime ?? '';
    const base = startTime ? parseDateOnly(startTime) : new Date();
    const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    // startTime 即第一周周一，向后偏移 (周次-1) 周
    monday.setDate(monday.getDate() + (currentWeek.value - 1) * 7);
    const todayText = toLocalDateOnlyString(new Date());
    return WEEK_DAY_LABELS.map((label, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const month = date.getMonth() + 1;
      const day = date.getDate();
      return {
        dayOfWeek: index + 1,
        label,
        month,
        day,
        dateText: `${padNumber(month, 2)}/${padNumber(day, 2)}`,
        isToday: toLocalDateOnlyString(date) === todayText,
      };
    });
  });

  /** 周切换条中间的日期范围文案，如 09/01 - 09/07 */
  const weekDateRangeText = computed(() => {
    const first = weekDays.value[0];
    const last = weekDays.value[6];
    if (!first || !last) return '';
    return `${first.dateText} - ${last.dateText}`;
  });

  /** 把当前周的课程时间段映射成网格渲染块（按星期分组） */
  const blocksByDay = computed<Map<number, ScheduleBlock[]>>(() => {
    const map = new Map<number, ScheduleBlock[]>();
    for (let day = 1; day <= 7; day += 1) map.set(day, []);

    const week = currentWeek.value;
    const rowCount = sectionCount.value;
    const timeTable = timetable.value;

    for (const course of courses.value) {
      for (const time of course.times ?? []) {
        // 只渲染「当前周生效」的时间段
        if (!Array.isArray(time.weekList) || !time.weekList.includes(week)) continue;

        // 过滤非法/越界节次后拆成连续段，每段渲染为一个跨行块
        const sections = Array.from(new Set(time.sectionList ?? []))
          .filter((section) => section >= 1 && section <= rowCount)
          .sort((a, b) => a - b);
        if (sections.length === 0) continue;

        const dayOfWeek = clamp(time.dayOfWeek, 1, 7);
        const weekList = Array.from(new Set(time.weekList)).sort((a, b) => a - b);

        for (const run of splitConsecutiveSections(sections)) {
          const sectionStart = run[0]!;
          const sectionEnd = run[run.length - 1]!;
          map.get(dayOfWeek)?.push({
            key: `${course.id}-${time.id}-${sectionStart}-${sectionEnd}`,
            courseId: course.id,
            courseName: course.courseName,
            color: course.color,
            tint: hexToRgba(course.color, 0.16),
            location: time.location || '',
            teacher: time.teacher || '',
            remark: time.remark || course.remark || null,
            dayOfWeek,
            sectionStart,
            sectionSpan: sectionEnd - sectionStart + 1,
            sectionText:
              sectionStart === sectionEnd
                ? `第${sectionStart}节`
                : `第${sectionStart}-${sectionEnd}节`,
            timeText: formatTimeRange(timeTable, sectionStart, sectionEnd),
            weekText: formatWeekList(weekList),
            weekList,
          });
        }
      }
    }

    return map;
  });

  /** 当前周的全部课程块（用于空态判断） */
  const courseBlocks = computed<ScheduleBlock[]>(() => {
    const result: ScheduleBlock[] = [];
    for (const list of blocksByDay.value.values()) result.push(...list);
    return result;
  });

  /** 取某一天的课程块 */
  function getDayBlocks(dayOfWeek: number): ScheduleBlock[] {
    return blocksByDay.value.get(clamp(dayOfWeek, 1, 7)) ?? [];
  }

  /** 星期文案 */
  function weekdayLabel(dayOfWeek: number): string {
    return WEEK_DAY_LABELS[clamp(dayOfWeek, 1, 7) - 1] ?? '';
  }

  /** 把当前周裁剪到 [1, weekCount] 内 */
  function clampWeek(): void {
    currentWeek.value = clamp(currentWeek.value, 1, weekCount.value);
  }

  /** 拉取当前选中课表的详情 */
  async function fetchDetail(id: number): Promise<void> {
    const data = await ScheduleApi.detail(id);
    // 拉取期间用户可能已切到别的课表，丢弃过期结果
    if (currentScheduleId.value === id) detail.value = data;
  }

  /**
   * 加载 / 刷新课表。
   * - 已有数据时静默刷新（不闪骨架屏）；
   * - 首次加载：定位到「今天所在周」；之后再进入 tab 保留用户正在看的周次。
   */
  async function refresh(): Promise<void> {
    // 并发保护：进入 tab 时 watch + onMounted 可能同时触发
    if (isLoading.value || isRefreshing.value) return;

    const hasData = schedules.value.length > 0;
    if (hasData) isRefreshing.value = true;
    else isLoading.value = true;
    error.value = null;

    try {
      const list = await ScheduleApi.list();
      schedules.value = Array.isArray(list) ? list : [];

      if (schedules.value.length === 0) {
        currentScheduleId.value = null;
        detail.value = null;
        hasLoaded.value = true;
        return;
      }

      // 保留用户选中的课表；该课表被删除时回退到第一个
      let targetId = currentScheduleId.value;
      if (!targetId || !schedules.value.some((item) => item.id === targetId)) {
        targetId = schedules.value[0]!.id;
      }
      currentScheduleId.value = targetId;

      // 首次加载定位到当前周；后续刷新只做边界裁剪
      if (!hasLoaded.value) currentWeek.value = todayWeek.value;
      else clampWeek();

      await fetchDetail(targetId);
      hasLoaded.value = true;
    } catch (e: any) {
      // 401 由 http 拦截器统一刷新/跳登录，这里不再重复提示
      if (e?.statusCode !== 401) {
        error.value = e instanceof Error ? e.message : e?.errMsg || '课表加载失败';
        uni.showToast({ title: error.value || '课表加载失败', icon: 'none' });
      }
    } finally {
      isLoading.value = false;
      isRefreshing.value = false;
    }
  }

  /**
   * 切换课表：切到新学期后定位到该课表的「今天所在周」。
   * @param id 目标课表 ID
   */
  async function switchSchedule(id: number): Promise<void> {
    if (id === currentScheduleId.value) return;
    if (!schedules.value.some((item) => item.id === id)) return;

    currentScheduleId.value = id;
    detail.value = null;
    currentWeek.value = todayWeek.value;
    clampWeek();
    isRefreshing.value = true;

    try {
      await fetchDetail(id);
      hasLoaded.value = true;
    } catch (e: any) {
      if (e?.statusCode !== 401) {
        error.value = e instanceof Error ? e.message : e?.errMsg || '课表加载失败';
        uni.showToast({ title: error.value || '课表加载失败', icon: 'none' });
      }
    } finally {
      isRefreshing.value = false;
    }
  }

  /**
   * 把课表合并进列表（导入接口返回的就是详情，结构上兼容概要）。
   * 导入成功后先合并再选中，页面可以立刻显示新课表；refresh 后会被列表数据覆盖。
   */
  function upsertScheduleSummary(imported: ScheduleDetail): void {
    const index = schedules.value.findIndex((item) => item.id === imported.id);
    if (index >= 0) schedules.value[index] = imported;
    else schedules.value.unshift(imported);
  }

  /**
   * 导入课表成功后应用结果：刷新课表数据并切换到新导入的课表。
   * · 导入接口直接返回详情，先并入列表并选中，页面无需等待 refresh 就能显示；
   * · 再静默 refresh 一次，同步列表 / courseCount 等后端计算结果；
   * · 若 refresh 期间拿到的是导入前发起的旧列表（不含新 id），选中会被回退，
   *   这里在 refresh 之后做一次兜底重选，保证用户看到的一定是新导入的课表。
   * @param imported 导入接口返回的课表详情
   */
  async function applyImportedSchedule(imported: ScheduleDetail): Promise<void> {
    if (!imported?.id) return;

    upsertScheduleSummary(imported);
    currentScheduleId.value = imported.id;
    detail.value = imported;
    hasLoaded.value = true;
    // 新导入的课表定位到「今天所在周」（学期间导入时不会停在第 1 周）
    currentWeek.value = todayWeek.value;
    clampWeek();

    await refresh();

    if (!schedules.value.some((item) => item.id === imported.id)) {
      upsertScheduleSummary(imported);
    }
    if (currentScheduleId.value !== imported.id) {
      currentScheduleId.value = imported.id;
      detail.value = imported;
      currentWeek.value = todayWeek.value;
      clampWeek();
    }
  }

  /** 上一周 */
  function prevWeek(): void {
    if (currentWeek.value <= 1) return;
    currentWeek.value -= 1;
  }

  /** 下一周 */
  function nextWeek(): void {
    if (currentWeek.value >= weekCount.value) return;
    currentWeek.value += 1;
  }

  /** 回到今天所在周 */
  function goToday(): void {
    currentWeek.value = todayWeek.value;
  }

  return {
    // 数据
    schedules,
    currentSchedule,
    currentScheduleName,
    currentScheduleId,
    detail,
    courses,
    // 周次
    currentWeek,
    todayWeek,
    weekCount,
    isCurrentWeek,
    weekDays,
    weekDateRangeText,
    sectionRows,
    sectionCount,
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
    // 课表切换
    scheduleNames,
    currentScheduleIndex,
  };
}
