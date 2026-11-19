/**
 * 课表页数据逻辑：
 * - 课表列表 / 详情加载（多课表可切换）
 * - 当前周次计算：clamp(floor((今天 - 开课日期) / 7 天) + 1, 1, weekCount)
 * - 按「当前周 + 星期」过滤课程，换算成课表网格里的课程块（含跨行信息与配色）
 *
 * 页面只负责交互与弹窗表单，取数 / 派生数据统一收在这里。
 */
import { computed, ref } from "vue";
import { notifyError } from "@/utils/notification";
import { scheduleApi } from "../api";
import type {
  Course,
  CourseBlock,
  CourseTime,
  ScheduleDetail,
  ScheduleSummary,
} from "../types";

/** 星期选项：value 与后端 dayOfWeek 一致（1=周一 … 7=周日） */
export const DAY_OPTIONS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
] as const;

/**
 * 课程预设颜色（8 色）。
 * 取饱和度偏低的邻近色，配浅色底 + 同色系左条后在明暗两个主题下都不刺眼。
 */
export const PRESET_COURSE_COLORS = [
  "#9b4f93",
  "#4f7f9b",
  "#7a9b4f",
  "#b07a4f",
  "#9b5a4f",
  "#4f9b7a",
  "#7b6cb0",
  "#b06b8f",
] as const;

/** 新建课表时的默认作息时间表（10 节） */
export const DEFAULT_TIMETABLE = [
  "08:00-08:45",
  "08:55-09:40",
  "10:00-10:45",
  "10:55-11:40",
  "14:00-14:45",
  "14:55-15:40",
  "16:00-16:45",
  "16:55-17:40",
  "19:00-19:45",
  "19:55-20:40",
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** 解析 yyyy-MM-dd 为本地日期；不合法返回 null（避免时区把日期算偏一天） */
export function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return new Date(year, month - 1, day);
}

/** 取本地当天 0 点，避免时分秒影响天数差 */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * 当前周次 = clamp(floor((今天 - 开课日期) / 7 天) + 1, 1, weekCount)。
 * 开课日期之前 → 第 1 周；学期结束后 → 最后一周。
 */
export function calcCurrentWeek(
  startTime?: string | null,
  weekCount = 1,
): number {
  const total = Math.min(Math.max(weekCount || 1, 1), 100);
  const start = parseDateOnly(startTime);
  if (!start) return 1;
  const diffDays = Math.floor((startOfToday().getTime() - start.getTime()) / DAY_MS);
  const week = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(week, 1), total);
}

/** 今天是周几：1-7（周日返回 7） */
export function getTodayDayOfWeek(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

/** 取某学期第 week 周第 dayOfWeek 天的日期（用于表头显示 9/1 这类短日期） */
export function getWeekDayDate(
  startTime: string | null | undefined,
  week: number,
  dayOfWeek: number,
): Date | null {
  const start = parseDateOnly(startTime);
  if (!start) return null;
  const offsetDays = (week - 1) * 7 + (dayOfWeek - 1);
  return new Date(start.getTime() + offsetDays * DAY_MS);
}

/** 把学期开始 / 结束日期格式化成 "2026.09.01 – 2027.01.19" */
function formatTermRange(start: Date, weekCount: number): string {
  const end = new Date(start.getTime() + ((weekCount - 1) * 7 + 6) * DAY_MS);
  const format = (date: Date) =>
    `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
      date.getDate(),
    ).padStart(2, "0")}`;
  return `${format(start)} – ${format(end)}`;
}

/** 把后端 / 网络错误转成可读文案 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    response?: { data?: unknown };
    message?: string;
  };
  const data = candidate?.response?.data;
  if (typeof data === "string" && data.trim()) return data.trim();
  if (data && typeof data === "object") {
    const record = data as { message?: string; title?: string; error?: string };
    if (record.message) return record.message;
    if (record.title) return record.title;
    if (record.error) return record.error;
  }
  return candidate?.message || fallback;
}

/** 取时间段里最小的节次（用于排序） */
function firstSection(time: CourseTime): number {
  return time.sectionList.reduce(
    (min, value) => Math.min(min, value),
    Number.POSITIVE_INFINITY,
  );
}

/** 一周课程列表项（右侧课程列表用） */
export interface WeekCourseEntry {
  key: string;
  course: Course;
  time: CourseTime;
}

export function useSchedulePage() {
  const schedules = ref<ScheduleSummary[]>([]);
  const activeScheduleId = ref<number | null>(null);
  const detail = ref<ScheduleDetail | null>(null);
  // 初始即为 true：页面挂载前就显示骨架，避免首帧闪一下「还没有课表」空态
  const loading = ref(true);
  const detailLoading = ref(false);
  const currentWeek = ref(1);

  /** 当前课表概要（列表里的那一项，含周数 / 开课日期兜底） */
  const activeSchedule = computed<ScheduleSummary | null>(
    () =>
      schedules.value.find((item) => item.id === activeScheduleId.value) ?? null,
  );

  const weekCount = computed(() => {
    const value = detail.value?.weekCount ?? activeSchedule.value?.weekCount ?? 1;
    return Math.min(Math.max(value, 1), 100);
  });

  const timetable = computed<string[]>(
    () => detail.value?.timetable ?? activeSchedule.value?.timetable ?? [],
  );

  /** 今天所属周次（当前学期） */
  const todayWeek = computed(() =>
    calcCurrentWeek(activeSchedule.value?.startTime, weekCount.value),
  );

  const todayDayOfWeek = computed(() => getTodayDayOfWeek());

  /** 当前查看的是不是本周 */
  const isTodayWeek = computed(() => currentWeek.value === todayWeek.value);

  const weekOptions = computed(() =>
    Array.from({ length: weekCount.value }, (_, index) => index + 1),
  );

  /** 当前周日期范围，如 "9月1日 – 9月7日" */
  const weekDateLabel = computed(() => {
    const start = parseDateOnly(activeSchedule.value?.startTime);
    if (!start) return "";
    const weekStart = new Date(
      start.getTime() + (currentWeek.value - 1) * 7 * DAY_MS,
    );
    const weekEnd = new Date(weekStart.getTime() + 6 * DAY_MS);
    const format = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`;
    return `${format(weekStart)} – ${format(weekEnd)}`;
  });

  /** 学期日期范围 + 总周数，用于工具栏副标题 */
  const termRangeLabel = computed(() => {
    const start = parseDateOnly(activeSchedule.value?.startTime);
    if (!start) return "";
    return `${formatTermRange(start, weekCount.value)} · 共 ${weekCount.value} 周`;
  });

  const hasCourses = computed(() => (detail.value?.courses.length ?? 0) > 0);

  /** 当前周、当前网格里要渲染的课程块 */
  const courseBlocks = computed<CourseBlock[]>(() => {
    const courses = detail.value?.courses ?? [];
    const week = currentWeek.value;
    const sectionCount = Math.max(timetable.value.length, 1);
    const blocks: CourseBlock[] = [];

    for (const course of courses) {
      for (const time of course.times) {
        if (!time.weekList.includes(week)) continue;
        const sections = time.sectionList
          .filter((value) => Number.isFinite(value) && value >= 1)
          .sort((a, b) => a - b);
        if (sections.length === 0) continue;

        const startSection = Math.min(Math.max(sections[0]!, 1), sectionCount);
        const endSection = Math.min(
          Math.max(sections[sections.length - 1]!, startSection),
          sectionCount,
        );
        const span = Math.max(1, endSection - startSection + 1);
        const dayOfWeek = Math.min(Math.max(time.dayOfWeek, 1), 7);

        blocks.push({
          key: `${course.id}-${time.id}`,
          courseId: course.id,
          timeId: time.id,
          courseName: course.courseName,
          color: course.color,
          location: time.location,
          teacher: time.teacher,
          dayOfWeek,
          sectionList: sections,
          weekList: time.weekList,
          startSection,
          span,
          style: {
            // 第 1 行是星期表头，所以节次 n 落在 n+1 行；第 1 列是节次列
            gridColumn: String(dayOfWeek + 1),
            gridRow: `${startSection + 1} / span ${span}`,
            "--course-color": course.color,
            "--course-bg": `color-mix(in srgb, ${course.color} 18%, var(--bg-elevated))`,
            "--course-border": `color-mix(in srgb, ${course.color} 40%, var(--bg-elevated))`,
          } as Record<string, string>,
        });
      }
    }

    blocks.sort(
      (left, right) =>
        left.dayOfWeek - right.dayOfWeek ||
        left.startSection - right.startSection,
    );
    return blocks;
  });

  /** 当前周的课程列表（右侧栏） */
  const weekCourseEntries = computed<WeekCourseEntry[]>(() => {
    const entries: WeekCourseEntry[] = [];
    for (const course of detail.value?.courses ?? []) {
      for (const time of course.times) {
        if (!time.weekList.includes(currentWeek.value)) continue;
        entries.push({ key: `${course.id}-${time.id}`, course, time });
      }
    }
    entries.sort(
      (left, right) =>
        left.time.dayOfWeek - right.time.dayOfWeek ||
        firstSection(left.time) - firstSection(right.time),
    );
    return entries;
  });

  /** 周次收敛到 1..weekCount */
  function clampWeek(week: number): number {
    const value = Number.isFinite(week) ? Math.round(week) : 1;
    return Math.min(Math.max(value, 1), weekCount.value);
  }

  function setWeek(week: number) {
    currentWeek.value = clampWeek(week);
  }

  function goPrevWeek() {
    setWeek(currentWeek.value - 1);
  }

  function goNextWeek() {
    setWeek(currentWeek.value + 1);
  }

  /** 回到今天所在周 */
  function goToday() {
    currentWeek.value = todayWeek.value;
  }

  /**
   * 加载课表详情。
   * @param resetWeek 是否把当前周重置为「今天所在周」（首次加载 / 切换课表时）
   */
  async function loadDetail(
    id: number,
    options: { resetWeek?: boolean } = {},
  ): Promise<void> {
    detailLoading.value = true;
    try {
      const response = await scheduleApi.detail(id);
      detail.value = response.data;
      currentWeek.value = options.resetWeek
        ? calcCurrentWeek(response.data.startTime, response.data.weekCount)
        : clampWeek(currentWeek.value);
    } catch (error) {
      detail.value = null;
      notifyError(getApiErrorMessage(error, "课表加载失败"));
    } finally {
      detailLoading.value = false;
    }
  }

  /** 切换课表 */
  async function selectSchedule(id: number): Promise<void> {
    if (id === activeScheduleId.value && detail.value) return;
    activeScheduleId.value = id;
    await loadDetail(id, { resetWeek: true });
  }

  /**
   * 加载课表列表并自动选中一张。
   * @param preferredId 优先选中的课表（保存后回到刚保存的那张）
   */
  async function loadSchedules(preferredId?: number | null): Promise<void> {
    loading.value = true;
    try {
      const response = await scheduleApi.list();
      schedules.value = response.data ?? [];
      const targetId =
        preferredId != null &&
        schedules.value.some((item) => item.id === preferredId)
          ? preferredId
          : (schedules.value[0]?.id ?? null);
      activeScheduleId.value = targetId;
      if (targetId != null) {
        await loadDetail(targetId, { resetWeek: true });
      } else {
        detail.value = null;
        currentWeek.value = 1;
      }
    } catch (error) {
      schedules.value = [];
      detail.value = null;
      notifyError(getApiErrorMessage(error, "课表列表加载失败"));
    } finally {
      loading.value = false;
    }
  }

  /** 重新拉取当前课表详情（保存 / 删除课程后刷新网格） */
  async function reloadDetail(): Promise<void> {
    if (activeScheduleId.value == null) return;
    await loadDetail(activeScheduleId.value);
  }

  return {
    // 数据
    schedules,
    activeScheduleId,
    activeSchedule,
    detail,
    loading,
    detailLoading,
    currentWeek,
    weekCount,
    timetable,
    todayWeek,
    todayDayOfWeek,
    isTodayWeek,
    weekOptions,
    weekDateLabel,
    termRangeLabel,
    hasCourses,
    courseBlocks,
    weekCourseEntries,
    // 操作
    setWeek,
    goPrevWeek,
    goNextWeek,
    goToday,
    loadSchedules,
    loadDetail,
    selectSchedule,
    reloadDetail,
  };
}
