<script setup lang="ts">
/**
 * 课表页。
 *
 * 结构：工具栏（课表选择 / 周次切换 / 操作按钮）→ 课表网格（7 天 × 作息节次）
 *      → 右侧本周课程列表（桌面两栏，≤900px 隐藏并让网格横向滚动）。
 * 交互：点课程块看详情，可编辑 / 删除课程；顶部可添加课程、改课表设置、新建课表。
 *
 * 取数与派生数据见 features/schedule/composables/useSchedulePage.ts，
 * 样式见 features/schedule/style/index.scss（全局，弹窗 teleport 到 body 后也能命中）。
 */
import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import AppDialog from "@/components/AppDialog.vue";
import { notifyError, notifySuccess } from "@/utils/notification";
import { scheduleApi } from "@/features/schedule/api";
import {
  DAY_OPTIONS,
  DEFAULT_TIMETABLE,
  PRESET_COURSE_COLORS,
  getApiErrorMessage,
  getTodayDayOfWeek,
  getWeekDayDate,
  parseDateOnly,
  useSchedulePage,
} from "@/features/schedule/composables/useSchedulePage";
import type {
  Course,
  CourseBlock,
  CourseDraft,
  CoursePayload,
  CourseTimeDraft,
  ScheduleDraft,
  ScheduleImportPreview,
  SchedulePayload,
  ScheduleTimetableOption,
  TimetablePayload,
} from "@/features/schedule/types";

/** 滚动区高度 = 真实视口高度 - 顶栏总高度（与首页保持一致） */
const scrollWrapStyle = computed(
  () => "height: calc(var(--app-h) - var(--header-total-h))",
);

const {
  schedules,
  activeScheduleId,
  activeSchedule,
  detail,
  loading,
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
  setWeek,
  goPrevWeek,
  goNextWeek,
  goToday,
  loadSchedules,
  selectSchedule,
  reloadDetail,
} = useSchedulePage();

/** 后端作息时间格式：HH:mm-HH:mm（1-2 位小时） */
const TIMETABLE_RANGE_PATTERN =
  /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
/** 后端课程颜色格式：#RGB / #RRGGBB */
const COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/* ======================== 工具函数 ======================== */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 本周周一（新建课表时默认开课日期，让「今天」落在第 1 周） */
function getCurrentMonday(): Date {
  const today = new Date();
  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - (getTodayDayOfWeek() - 1),
  );
}

function dayLabel(dayOfWeek: number): string {
  return DAY_OPTIONS.find((day) => day.value === dayOfWeek)?.label ?? "周一";
}

function dayDateLabel(dayOfWeek: number): string {
  const date = getWeekDayDate(
    activeSchedule.value?.startTime,
    currentWeek.value,
    dayOfWeek,
  );
  return date ? `${date.getMonth() + 1}/${date.getDate()}` : "";
}

/** 今天所在列高亮仅在「查看本周」时显示 */
function isTodayColumn(dayOfWeek: number): boolean {
  return isTodayWeek.value && dayOfWeek === todayDayOfWeek.value;
}

/** 节次列表压缩展示：连续区间用 a-b，否则顿号连接 */
function formatSections(sections: number[]): string {
  const sorted = [...sections].sort((a, b) => a - b);
  if (sorted.length === 0) return "—";
  const ranges: string[] = [];
  let start = sorted[0]!;
  let previous = sorted[0]!;
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return ranges.join("、");
}

/** 周次压缩展示：1-16 周 */
function formatWeeks(weeks: number[]): string {
  const label = formatSections(weeks);
  return label === "—" ? "—" : `${label} 周`;
}

/** 根据上一节时间猜下一节（end + 10 分钟开始，45 分钟一节） */
function suggestNextSlot(previous: string): string {
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(previous.trim());
  if (!match) return "08:00-08:45";
  const endTotal = Number(match[3]) * 60 + Number(match[4]) + 10;
  const startTotal = ((endTotal % (24 * 60)) + 24 * 60) % (24 * 60);
  const finishTotal = (startTotal + 45) % (24 * 60);
  const format = (total: number) =>
    `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
  return `${format(startTotal)}-${format(finishTotal)}`;
}

/* ======================== 课程详情弹窗 ======================== */
const courseDetailVisible = ref(false);
const activeCourseId = ref<number | null>(null);
const activeTimeId = ref<number | null>(null);

/** 当前查看的课程（从详情里实时取，保存 / 刷新后自动更新） */
const detailCourse = computed<Course | null>(() => {
  if (activeCourseId.value == null) return null;
  return (
    detail.value?.courses.find((course) => course.id === activeCourseId.value) ??
    null
  );
});

/** 网格里高亮的课程块 key（courseId-timeId） */
const activeBlockKey = computed<string | null>(() => {
  if (activeCourseId.value == null || activeTimeId.value == null) return null;
  return `${activeCourseId.value}-${activeTimeId.value}`;
});

function openCourseDetail(block: CourseBlock): void {
  activeCourseId.value = block.courseId;
  activeTimeId.value = block.timeId;
  courseDetailVisible.value = true;
}

function openCourseDetailFromSide(course: Course, timeId: number): void {
  activeCourseId.value = course.id;
  activeTimeId.value = timeId;
  courseDetailVisible.value = true;
}

/* ======================== 添加 / 编辑课程弹窗 ======================== */
const courseFormVisible = ref(false);
const courseSaving = ref(false);
const courseDraft = ref<CourseDraft>(createEmptyCourseDraft());

function createEmptyTimeDraft(): CourseTimeDraft {
  return {
    dayOfWeek: getTodayDayOfWeek(),
    weekList: [...weekOptions.value],
    sectionList: [1],
    location: "",
    teacher: "",
    remark: "",
  };
}

function createEmptyCourseDraft(): CourseDraft {
  const colors = [...PRESET_COURSE_COLORS];
  const index = (detail.value?.courses.length ?? 0) % colors.length;
  return {
    courseName: "",
    color: colors[index] ?? "#9b4f93",
    remark: "",
    times: [createEmptyTimeDraft()],
  };
}

function openCreateCourse(): void {
  if (!activeSchedule.value) {
    notifyError("请先创建课表");
    openCreateSchedule();
    return;
  }
  if (timetable.value.length === 0) {
    notifyError("请先在「课表设置」里配置作息时间表");
    return;
  }
  courseDraft.value = createEmptyCourseDraft();
  courseFormVisible.value = true;
}

function openEditCourse(course: Course): void {
  courseDetailVisible.value = false;
  // 旧数据可能超出当前课表的周数 / 节次数（例如之后把课表改短了），
  // 这里过滤掉越界值，避免保存时被后端以「周次超过总周数」拒绝。
  const maxWeek = weekCount.value;
  const maxSection = Math.max(timetable.value.length, 1);
  const times = course.times.map<CourseTimeDraft>((time) => ({
    id: time.id,
    dayOfWeek: time.dayOfWeek,
    weekList: time.weekList.filter((week) => week <= maxWeek),
    sectionList: time.sectionList.filter((section) => section <= maxSection),
    location: time.location,
    teacher: time.teacher,
    remark: time.remark ?? "",
  }));
  courseDraft.value = {
    id: course.id,
    courseName: course.courseName,
    color: course.color,
    remark: course.remark ?? "",
    times: times.length > 0 ? times : [createEmptyTimeDraft()],
  };
  courseFormVisible.value = true;
}

function handleEditCourse(): void {
  if (detailCourse.value) openEditCourse(detailCourse.value);
}

function addTimeDraft(): void {
  courseDraft.value.times.push(createEmptyTimeDraft());
}

function removeTimeDraft(index: number): void {
  if (courseDraft.value.times.length <= 1) return;
  courseDraft.value.times.splice(index, 1);
}

function toggleWeek(time: CourseTimeDraft, week: number): void {
  const position = time.weekList.indexOf(week);
  if (position >= 0) time.weekList.splice(position, 1);
  else time.weekList.push(week);
}

function selectAllWeeks(time: CourseTimeDraft): void {
  time.weekList = [...weekOptions.value];
}

function invertWeeks(time: CourseTimeDraft): void {
  time.weekList = weekOptions.value.filter(
    (week) => !time.weekList.includes(week),
  );
}

function toggleSection(time: CourseTimeDraft, section: number): void {
  const position = time.sectionList.indexOf(section);
  if (position >= 0) time.sectionList.splice(position, 1);
  else time.sectionList.push(section);
}

function validateCourseDraft(): string | null {
  const draft = courseDraft.value;
  if (!draft.courseName.trim()) return "请输入课程名称";
  if (!COLOR_PATTERN.test(draft.color)) return "课程颜色格式不正确";
  if (draft.times.length === 0) return "请至少添加一个时间段";

  for (let index = 0; index < draft.times.length; index += 1) {
    const time = draft.times[index]!;
    const label = `时间段 ${index + 1}`;
    if (!time.dayOfWeek) return `${label}：请选择星期`;
    if (time.weekList.length === 0) return `${label}：请至少选择一个周次`;
    if (time.sectionList.length === 0) return `${label}：请至少选择一个节次`;
    if (!time.location.trim()) return `${label}：请填写上课地点`;
    if (!time.teacher.trim()) return `${label}：请填写任课教师`;
  }
  return null;
}

async function handleSaveCourse(): Promise<void> {
  const message = validateCourseDraft();
  if (message) {
    notifyError(message);
    return;
  }
  const scheduleId = activeScheduleId.value;
  if (scheduleId == null) {
    notifyError("请先创建课表");
    return;
  }

  const draft = courseDraft.value;
  const payload: CoursePayload = {
    id: draft.id,
    courseName: draft.courseName.trim(),
    color: draft.color,
    remark: draft.remark.trim() ? draft.remark.trim() : null,
    times: draft.times.map((time) => ({
      id: time.id,
      location: time.location.trim(),
      teacher: time.teacher.trim(),
      weekList: [...time.weekList].sort((a, b) => a - b),
      sectionList: [...time.sectionList].sort((a, b) => a - b),
      dayOfWeek: time.dayOfWeek,
      remark: time.remark.trim() ? time.remark.trim() : null,
    })),
  };

  courseSaving.value = true;
  try {
    await scheduleApi.saveCourse(scheduleId, payload);
    notifySuccess(draft.id ? "课程已更新" : "课程已添加");
    courseFormVisible.value = false;
    await reloadDetail();
  } catch (error) {
    notifyError(getApiErrorMessage(error, "课程保存失败"));
  } finally {
    courseSaving.value = false;
  }
}

async function handleDeleteCourse(): Promise<void> {
  const course = detailCourse.value;
  const scheduleId = activeScheduleId.value;
  if (!course || scheduleId == null) return;

  try {
    await ElMessageBox.confirm(
      `确定删除课程「${course.courseName}」吗？该课程的所有上课时间段会一并删除。`,
      "删除课程",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }

  try {
    await scheduleApi.removeCourse(scheduleId, course.id);
    notifySuccess("课程已删除");
    courseDetailVisible.value = false;
    await reloadDetail();
  } catch (error) {
    notifyError(getApiErrorMessage(error, "删除课程失败"));
  }
}

/* ======================== 课表设置弹窗 ======================== */
const scheduleFormVisible = ref(false);
const scheduleSaving = ref(false);
const scheduleDraft = ref<ScheduleDraft>({
  scheduleName: "",
  startTime: "",
  weekCount: 20,
  timetable: [...DEFAULT_TIMETABLE],
  remark: "",
});

function openCreateSchedule(): void {
  scheduleDraft.value = {
    scheduleName: "",
    startTime: formatDateInput(getCurrentMonday()),
    weekCount: 20,
    timetable: [...DEFAULT_TIMETABLE],
    remark: "",
  };
  scheduleFormTimetableIndex.value = null;
  void loadScheduleFormTimetables();
  scheduleFormVisible.value = true;
}

function openEditSchedule(): void {
  const schedule = activeSchedule.value;
  if (!schedule) {
    openCreateSchedule();
    return;
  }
  scheduleDraft.value = {
    id: schedule.id,
    scheduleName: schedule.scheduleName,
    startTime: schedule.startTime,
    weekCount: schedule.weekCount,
    timetable: [...(detail.value?.timetable ?? schedule.timetable)],
    remark: detail.value?.remark ?? schedule.remark ?? "",
  };
  scheduleFormTimetableIndex.value = null;
  void loadScheduleFormTimetables();
  scheduleFormVisible.value = true;
}

function addTimetableRow(): void {
  const rows = scheduleDraft.value.timetable;
  if (rows.length >= 30) {
    notifyError("作息时间最多支持 30 节");
    return;
  }
  const last = rows[rows.length - 1];
  rows.push(last ? suggestNextSlot(last) : "08:00-08:45");
}

function removeTimetableRow(index: number): void {
  if (scheduleDraft.value.timetable.length <= 1) return;
  scheduleDraft.value.timetable.splice(index, 1);
}

/** 作息时间编辑行号（输入框要直接写回数组，所以模板里需要 index 而不是元素） */
const timetableRows = computed(() =>
  scheduleDraft.value.timetable.map((_, index) => index),
);

/* 课表设置里的「套用作息表」：列出模板 + 历史作息，选中后填充下方作息行 */
const scheduleFormTimetableOptions = ref<ScheduleTimetableOption[]>([]);
const scheduleFormTimetableIndex = ref<number | null>(null);

/** 拉取可套用的作息表；失败静默（只是快捷方式，不影响手填） */
async function loadScheduleFormTimetables(): Promise<void> {
  try {
    const response = await scheduleApi.getTimetables();
    scheduleFormTimetableOptions.value = response.data ?? [];
  } catch {
    scheduleFormTimetableOptions.value = [];
  }
}

/** 选中一套作息表后填充到课表设置的时间行 */
function applyScheduleFormTimetable(value: unknown): void {
  if (typeof value !== "number") return;
  const option = scheduleFormTimetableOptions.value[value];
  if (!option) return;
  scheduleDraft.value.timetable = [...option.times];
  scheduleFormTimetableIndex.value = value;
}

function validateScheduleDraft(): string | null {
  const draft = scheduleDraft.value;
  if (!draft.scheduleName.trim()) return "请输入课表名称";
  if (!parseDateOnly(draft.startTime)) return "请选择开课日期";

  const weekCountValue = Number(draft.weekCount);
  if (
    !Number.isInteger(weekCountValue) ||
    weekCountValue < 1 ||
    weekCountValue > 100
  ) {
    return "学期周数需在 1-100 之间";
  }
  if (draft.timetable.length === 0) return "作息时间表至少需要 1 节";

  for (let index = 0; index < draft.timetable.length; index += 1) {
    const slot = (draft.timetable[index] ?? "").trim();
    if (!TIMETABLE_RANGE_PATTERN.test(slot)) {
      return `第 ${index + 1} 节时间格式应为 HH:mm-HH:mm`;
    }
  }
  return null;
}

async function handleSaveSchedule(): Promise<void> {
  const message = validateScheduleDraft();
  if (message) {
    notifyError(message);
    return;
  }

  const draft = scheduleDraft.value;
  const payload: SchedulePayload = {
    id: draft.id,
    scheduleName: draft.scheduleName.trim(),
    startTime: draft.startTime,
    weekCount: Number(draft.weekCount),
    timetable: draft.timetable.map((slot) => slot.trim()),
    remark: draft.remark.trim() ? draft.remark.trim() : null,
  };

  scheduleSaving.value = true;
  try {
    const response = await scheduleApi.save(payload);
    const savedId = response.data?.id ?? draft.id ?? null;
    notifySuccess(draft.id ? "课表已更新" : "课表已创建");
    scheduleFormVisible.value = false;
    await loadSchedules(savedId);
  } catch (error) {
    notifyError(getApiErrorMessage(error, "课表保存失败"));
  } finally {
    scheduleSaving.value = false;
  }
}

async function handleDeleteSchedule(): Promise<void> {
  const draft = scheduleDraft.value;
  if (!draft.id) return;

  const name = draft.scheduleName.trim() || "该课表";
  try {
    await ElMessageBox.confirm(
      `确定删除课表「${name}」吗？课表下的所有课程与时间段会一并删除，此操作不可恢复。`,
      "删除课表",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }

  try {
    await scheduleApi.remove(draft.id);
    notifySuccess("课表已删除");
    scheduleFormVisible.value = false;
    await loadSchedules(null);
  } catch (error) {
    notifyError(getApiErrorMessage(error, "删除课表失败"));
  }
}

/* ======================== 导入课表 ======================== */
/** 导入方式：Excel 解析 / 图片·PDF 的 OCR 识别（决定预检接口、保存接口与文案） */
type ImportFileKind = "excel" | "ocr";

/** Excel 课表文件白名单 */
const EXCEL_IMPORT_EXTENSIONS = [".xlsx", ".xls"];
/** 图片 / PDF 兜底 OCR 白名单（与后端 OcrExtensions 保持一致） */
const OCR_IMPORT_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp"];
/** 文件选择框 accept：Excel 表格 + 截图 / PDF */
const IMPORT_FILE_ACCEPT = [
  ...EXCEL_IMPORT_EXTENSIONS,
  ...OCR_IMPORT_EXTENSIONS,
].join(",");
/** Excel 文件大小上限：10MB（后端 RequestSizeLimit） */
const EXCEL_IMPORT_FILE_MAX_SIZE = 10 * 1024 * 1024;
/** OCR 文件大小上限：30MB（后端 RequestSizeLimit） */
const OCR_IMPORT_FILE_MAX_SIZE = 30 * 1024 * 1024;

const importInputRef = ref<HTMLInputElement | null>(null);
/** 预检请求中：上传文件解析 / OCR 识别，尚未写库 */
const importPreviewLoading = ref(false);
/** 正式导入请求中：写库 */
const importUploading = ref(false);
/** 预检结果（非空时展示预检对话框） */
const importPreview = ref<ScheduleImportPreview | null>(null);
const importPreviewVisible = ref(false);
/** 预检通过后待编辑的课程时间段行（一行 = 一个上课时间段） */
interface EditableImportRow {
  key: string;
  courseName: string;
  /** 课程颜色 #RRGGBB（沿用预检课程颜色；新增行用预设色补齐） */
  color: string;
  /** 星期 1-7 */
  dayOfWeek: number;
  /** 节次文本，如 "1-2" / "1,2" / "1-4,6" */
  sectionText: string;
  /** 周次文本，如 "1-4,9-16" */
  weekText: string;
  location: string;
  teacher: string;
}

/** 预检成功后转成可编辑行，用户核对 / 修改后再保存 */
const importRows = ref<EditableImportRow[]>([]);
/** 「下一步」校验通过后按课程名分组好的保存数据（命名确认后提交 Confirm） */
const pendingImportedCourses = ref<Course[] | null>(null);
/** 本次选择的文件走哪条链路（Excel 解析 / OCR），选文件时确定 */
const importFileKind = ref<ImportFileKind>("excel");

/** 预检弹窗里可编辑的作息时间行（第 N 节 → "HH:mm-HH:mm"） */
interface EditableTimetableRow {
  key: string;
  value: string;
}

/** 后端保存过的历史作息（获取失败静默为空，仅用于快捷复用） */
const savedTimetables = ref<ScheduleTimetableOption[]>([]);
/** 历史作息加载中（避免列表还没回来就误显示「没有已保存的作息」提示） */
const savedTimetablesLoading = ref(false);
/** 历史作息下拉当前选中的下标（null = 未套用 / 已手动修改） */
const selectedSavedTimetable = ref<number | null>(null);
/** 预检弹窗里可编辑的作息行 */
const importTimetableRows = ref<EditableTimetableRow[]>([]);
/** 用户是否手动动过作息（避免历史作息异步返回后覆盖用户已经改好的内容） */
const importTimetableTouched = ref(false);
/** 「下一步」校验通过后待提交的作息数组 */
const pendingImportTimetable = ref<string[]>([]);

let timetableRowSeed = 0;

function nextTimetableRowKey(): string {
  timetableRowSeed += 1;
  return `import-timetable-${timetableRowSeed}`;
}

/** 用一组作息时间填充编辑行 */
function fillImportTimetableRows(times: string[]): void {
  importTimetableRows.value = times.map((value) => ({
    key: nextTimetableRowKey(),
    value,
  }));
}

/** 预检成功后初始化作息编辑行：文件有就用文件内容，否则用后端给的默认作息 */
function buildImportTimetableRows(preview: ScheduleImportPreview): void {
  fillImportTimetableRows(preview.timetable);
  importTimetableTouched.value = false;
  selectedSavedTimetable.value = null;
}

/**
 * 拉取历史作息：失败静默（只影响快捷复用，不影响导入主流程）。
 * 规则：文件里没有作息时优先套用最近保存的一套；用户没手动改过才自动套用。
 */
async function loadSavedTimetables(): Promise<void> {
  savedTimetablesLoading.value = true;
  try {
    const response = await scheduleApi.getTimetables();
    savedTimetables.value = response.data ?? [];

    const preview = importPreview.value;
    const latest = savedTimetables.value[0];
    if (
      latest &&
      preview &&
      !preview.timetableFromFile &&
      !importTimetableTouched.value
    ) {
      fillImportTimetableRows(latest.times);
      selectedSavedTimetable.value = 0;
    }
  } catch {
    savedTimetables.value = [];
  } finally {
    savedTimetablesLoading.value = false;
  }
}

/** 套用一条历史作息 */
function applySavedTimetable(value: unknown): void {
  if (typeof value !== "number") return;
  const option = savedTimetables.value[value];
  if (!option) return;
  importTimetableTouched.value = true;
  fillImportTimetableRows(option.times);
  selectedSavedTimetable.value = value;
}

/** 恢复预检建议的默认作息 */
function useDefaultTimetable(): void {
  const preview = importPreview.value;
  if (!preview) return;
  importTimetableTouched.value = true;
  fillImportTimetableRows(preview.timetable);
  selectedSavedTimetable.value = null;
}

/** 手动修改过作息后，历史作息下拉不再显示为已选中 */
function markTimetableEdited(): void {
  importTimetableTouched.value = true;
  selectedSavedTimetable.value = null;
}

/** 添加一节作息 */
function addImportTimetableRow(): void {
  if (isImportBusy.value) return;
  importTimetableRows.value.push({ key: nextTimetableRowKey(), value: "" });
  markTimetableEdited();
}

/** 删除一节作息 */
function removeImportTimetableRow(index: number): void {
  if (isImportBusy.value) return;
  importTimetableRows.value.splice(index, 1);
  markTimetableEdited();
}

/** 后端作息时间格式：HH:mm-HH:mm（小时 1-2 位，结束必须晚于开始） */
const TIMETABLE_SLOT_PATTERN =
  /^([01]?\d|2[0-3]):[0-5]\d-([01]?\d|2[0-3]):[0-5]\d$/;

/** 解析 "HH:mm-HH:mm" 为分钟数；格式不对或结束不晚于开始返回 null */
function parseTimetableSlot(
  value: string,
): { start: number; end: number } | null {
  const match = TIMETABLE_SLOT_PATTERN.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return end > start ? { start, end } : null;
}

/** 校验作息行：至少一节、每行必填、格式 HH:mm-HH:mm、结束晚于开始 */
function validateImportTimetable(): string | null {
  if (importTimetableRows.value.length === 0) {
    return "请至少保留一节作息时间（可点「使用默认作息」恢复）";
  }
  for (let index = 0; index < importTimetableRows.value.length; index += 1) {
    const value = importTimetableRows.value[index]!.value.trim();
    if (!value) return `作息时间第 ${index + 1} 节：不能为空`;
    if (!TIMETABLE_SLOT_PATTERN.test(value)) {
      return `作息时间第 ${index + 1} 节：格式应为 HH:mm-HH:mm`;
    }
    if (!parseTimetableSlot(value)) {
      return `作息时间第 ${index + 1} 节：结束时间必须晚于开始时间`;
    }
  }
  return null;
}

let importRowSeed = 0;

function nextImportRowKey(): string {
  importRowSeed += 1;
  return `import-row-${importRowSeed}`;
}

/** 颜色兜底：预检颜色为空 / 非法时按序号取预设色（后端只接受 #RGB / #RRGGBB） */
function normalizeImportColor(
  color: string | null | undefined,
  index: number,
): string {
  const value = (color ?? "").trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return value;
  return (
    PRESET_COURSE_COLORS[index % PRESET_COURSE_COLORS.length] ?? "#9b4f93"
  );
}

/** 压缩展示：1,2,3,4,9,10 → "1-4,9-10"；空数组 → ""（节次 / 周次编辑框共用） */
function formatRanges(values: number[]): string {
  const sorted = [...new Set(values)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return "";

  const ranges: string[] = [];
  let start = sorted[0]!;
  let previous = sorted[0]!;
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return ranges.join(",");
}

/**
 * 解析 "1-2" / "1,2" / "1-4,6" 这类区间文本（支持中文逗号 / 顿号 / 空格）。
 * 越界（> hardLimit）或格式错误返回 null。
 */
function parseRangeText(text: string, hardLimit: number): number[] | null {
  const normalized = text
    .trim()
    .replace(/[，、]/g, ",")
    .replace(/\s+/g, "");
  if (!normalized) return null;

  const values = new Set<number>();
  for (const token of normalized.split(",")) {
    if (!token) return null;
    const match = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 1 || end < start || end > hardLimit) return null;
    for (let value = start; value <= end; value += 1) values.add(value);
  }

  const result = [...values].sort((left, right) => left - right);
  return result.length > 0 ? result : null;
}

/** 节次文本 → 节次列表（1..30） */
function parseSectionText(text: string): number[] | null {
  return parseRangeText(text, 30);
}

/** 周次文本 → 周次列表（1..100，实际还受当前课表 weekCount 限制） */
function parseWeekText(text: string): number[] | null {
  return parseRangeText(text, 100);
}

/** 把预检返回的课程 / 时间段拍平成可编辑行（预检里的 id 都是 0，行 key 用自增序号） */
function buildImportRows(preview: ScheduleImportPreview): void {
  const rows: EditableImportRow[] = [];
  preview.courses.forEach((course, courseIndex) => {
    const color = normalizeImportColor(course.color, courseIndex);
    course.times.forEach((time) => {
      rows.push({
        key: nextImportRowKey(),
        courseName: course.courseName,
        color,
        dayOfWeek: Math.min(Math.max(time.dayOfWeek, 1), 7),
        sectionText: formatRanges(time.sectionList),
        weekText: formatRanges(time.weekList),
        location: time.location,
        teacher: time.teacher,
      });
    });
  });
  importRows.value = rows;
}

/** 摘要 / 副标题用：编辑后按课程名去重的课程数（时间段数直接用 importRows.length） */
const importEditedCourseCount = computed(() => {
  const names = new Set<string>();
  for (const row of importRows.value) {
    const name = row.courseName.trim();
    if (name) names.add(name);
  }
  return names.size;
});

/** 弹窗副标题：实时反映编辑后的课程数 / 时间段数 */
const importPreviewSubtitle = computed(() =>
  importPreview.value
    ? `${importEditedCourseCount.value} 门课程 · ${importRows.value.length} 个时间段`
    : "",
);

/** 添加一行时间段：周次默认选满当前学期 */
function addImportRow(): void {
  const preview = importPreview.value;
  if (!preview || isImportBusy.value) return;

  const weekCount = Math.min(
    Math.max(Math.round(preview.weekCount || 20), 1),
    100,
  );
  const fullWeeks = Array.from(
    { length: weekCount },
    (_, index) => index + 1,
  );
  importRows.value.push({
    key: nextImportRowKey(),
    courseName: "",
    color: normalizeImportColor(null, importRows.value.length),
    dayOfWeek: getTodayDayOfWeek(),
    sectionText: "1-2",
    weekText: formatRanges(fullWeeks),
    location: "",
    teacher: "",
  });
}

/** 删除一行时间段 */
function removeImportRow(index: number): void {
  if (isImportBusy.value) return;
  importRows.value.splice(index, 1);
}

/** 校验编辑后的课程明细；返回第一处错误文案，全部合法返回 null */
function validateImportRows(): string | null {
  const preview = importPreview.value;
  if (!preview) return "预检数据已失效，请重新选择文件";
  if (importRows.value.length === 0) return "请至少保留一个上课时间段";

  const maxWeek = Math.min(
    Math.max(Math.round(preview.weekCount || 20), 1),
    100,
  );
  for (let index = 0; index < importRows.value.length; index += 1) {
    const row = importRows.value[index]!;
    const label = `第 ${index + 1} 行`;

    if (!row.courseName.trim()) return `${label}：课程名不能为空`;
    if (row.courseName.trim().length > 100) {
      return `${label}：课程名不能超过 100 个字符`;
    }
    if (
      !Number.isInteger(row.dayOfWeek) ||
      row.dayOfWeek < 1 ||
      row.dayOfWeek > 7
    ) {
      return `${label}：星期不合法`;
    }

    if (!parseSectionText(row.sectionText)) {
      return `${label}：节次格式不正确（示例：1-2 / 1,2 / 1-4,6，且需在 1-30 之间）`;
    }
    const weeks = parseWeekText(row.weekText);
    if (!weeks) {
      return `${label}：周次格式不正确（示例：1-4,9-16）`;
    }
    if (weeks.some((week) => week > maxWeek)) {
      return `${label}：周次不能超过本课表的总周数（1-${maxWeek}）`;
    }

    if (row.location.trim().length > 255) {
      return `${label}：上课地点不能超过 255 个字符`;
    }
    if (row.teacher.trim().length > 100) {
      return `${label}：任课教师不能超过 100 个字符`;
    }
  }
  return null;
}

/** 把编辑后的行按课程名分组，生成 Confirm 接口要的 courses（id 全 0，颜色沿用预检） */
function buildEditedCourses(): Course[] {
  const groups = new Map<string, Course>();
  for (const row of importRows.value) {
    const courseName = row.courseName.trim();
    const sections = parseSectionText(row.sectionText);
    const weeks = parseWeekText(row.weekText);
    // 已通过 validateImportRows，理论上不会命中；这里再兜一层避免脏数据
    if (!courseName || !sections || !weeks) continue;

    let course = groups.get(courseName);
    if (!course) {
      course = {
        id: 0,
        scheduleId: 0,
        courseName,
        color: normalizeImportColor(row.color, groups.size),
        remark: null,
        times: [],
      };
      groups.set(courseName, course);
    }
    course.times.push({
      id: 0,
      courseId: 0,
      location: row.location.trim(),
      teacher: row.teacher.trim(),
      weekList: weeks,
      sectionList: sections,
      dayOfWeek: row.dayOfWeek,
      remark: null,
    });
  }
  return [...groups.values()];
}

/** 命名弹窗打开中（防止「下一步」被连点两次弹出两个弹窗） */
const importNameDialogVisible = ref(false);
/** 命名弹窗里的课表名称 */
const importName = ref("");
/** 命名弹窗校验错误 */
const importNameError = ref("");

/** 预检 / 命名 / 正式导入任一进行中都要禁用入口，避免重复上传 */
const isImportBusy = computed(
  () =>
    importPreviewLoading.value ||
    importNameDialogVisible.value ||
    importUploading.value,
);

/** 导入按钮文案：OCR 较慢（Termux 单页约 5~15 秒），loading 时明确说明耗时 */
const importButtonLabel = computed(() => {
  if (importPreviewLoading.value) {
    return importFileKind.value === "ocr"
      ? "识别中...（约 5~15 秒）"
      : "预检中...";
  }
  if (importUploading.value) return "导入中...";
  return "导入课表（Excel / 截图 / PDF）";
});

/** 预检弹窗标题：OCR 时标注识别来源，提醒用户重点核对 */
const importPreviewTitle = computed(() =>
  importFileKind.value === "ocr"
    ? "导入课表预检（OCR 识别结果）"
    : "导入课表预检",
);

/** 点「导入课表」按钮时唤起隐藏的文件选择框 */
function openImportPicker(): void {
  if (isImportBusy.value) return;
  importInputRef.value?.click();
}

/** 按后缀判断导入方式；不在白名单里返回 null */
function resolveImportFileKind(file: File): ImportFileKind | null {
  const name = file.name.toLowerCase();
  if (EXCEL_IMPORT_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return "excel";
  }
  if (OCR_IMPORT_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return "ocr";
  }
  return null;
}

function handleImportFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  // 清空 input，保证再次选择同一个文件时仍能触发 change
  input.value = "";
  if (!file) return;

  const kind = resolveImportFileKind(file);
  if (!kind) {
    notifyError(
      "仅支持 Excel（.xlsx / .xls）或截图 / PDF（.pdf / .png / .jpg / .jpeg / .webp / .bmp）",
    );
    return;
  }

  const maxSize =
    kind === "ocr" ? OCR_IMPORT_FILE_MAX_SIZE : EXCEL_IMPORT_FILE_MAX_SIZE;
  if (file.size > maxSize) {
    notifyError(
      kind === "ocr"
        ? "截图 / PDF 不能超过 30MB，请压缩后再试"
        : "文件不能超过 10MB，请精简后再导入",
    );
    return;
  }
  void previewImportFile(file, kind);
}

/** 第一步：上传文件做预检（Excel 解析 / OCR 识别，只读不写库），成功后弹预检对话框让用户核对 */
async function previewImportFile(
  file: File,
  kind: ImportFileKind,
): Promise<void> {
  importFileKind.value = kind;
  importPreviewLoading.value = true;
  try {
    const response =
      kind === "ocr"
        ? await scheduleApi.previewOcrImport(file)
        : await scheduleApi.previewImport(file);
    buildImportRows(response.data);
    buildImportTimetableRows(response.data);
    // 历史作息只用于快捷复用，异步获取、失败静默
    void loadSavedTimetables();
    importPreview.value = response.data;
    importPreviewVisible.value = true;
  } catch (error) {
    notifyError(
      getApiErrorMessage(
        error,
        kind === "ocr"
          ? "OCR 识别失败，请换一张更清晰的课表截图"
          : "课表预检失败",
      ),
    );
  } finally {
    importPreviewLoading.value = false;
  }
}

/** 关闭预检对话框：丢弃本次编辑与预检数据，不调用保存接口 */
function closeImportPreview(): void {
  importPreviewVisible.value = false;
}

/** 等对话框关闭动画结束后再清空数据，避免关闭过程中表格内容闪空 */
function resetImportPreview(): void {
  importPreview.value = null;
  importRows.value = [];
  pendingImportedCourses.value = null;
  importTimetableRows.value = [];
  pendingImportTimetable.value = [];
  selectedSavedTimetable.value = null;
}

/** 第二步：校验编辑后的明细，分组生成保存数据，再打开「命名并导入」弹窗 */
function handleImportNext(): void {
  const preview = importPreview.value;
  if (!preview || isImportBusy.value) return;

  const timetableError = validateImportTimetable();
  if (timetableError) {
    notifyError(timetableError);
    return;
  }

  const error = validateImportRows();
  if (error) {
    notifyError(error);
    return;
  }

  pendingImportedCourses.value = buildEditedCourses();
  pendingImportTimetable.value = importTimetableRows.value.map((row) =>
    row.value.trim(),
  );
  importName.value = preview.scheduleName;
  importNameError.value = "";
  importNameDialogVisible.value = true;
}

/** 取消命名：留在预检弹窗，不上传正式接口 */
function cancelImportName(): void {
  if (importUploading.value) return;
  importNameDialogVisible.value = false;
  importNameError.value = "";
}

/** 校验名称后统一走 Confirm 接口保存（Excel / OCR 都提交用户编辑后的数据） */
async function confirmImportName(): Promise<void> {
  const preview = importPreview.value;
  const courses = pendingImportedCourses.value;
  const timetable = pendingImportTimetable.value;
  if (
    !preview ||
    !courses ||
    courses.length === 0 ||
    timetable.length === 0 ||
    importUploading.value
  ) {
    return;
  }

  const name = importName.value.trim();
  if (!name) {
    importNameError.value = "课表名称不能为空";
    return;
  }
  if (name.length > 100) {
    importNameError.value = "课表名称不能超过 100 个字符";
    return;
  }

  importNameError.value = "";
  importUploading.value = true;
  try {
    // Excel / OCR 都提交编辑后的数据，不再重新上传文件解析，否则用户的修改会被丢弃
    const response = await scheduleApi.confirmImport({
      scheduleName: name,
      startTime: preview.startTime,
      weekCount: preview.weekCount,
      timetable,
      courses,
    });
    const imported = response.data;
    notifySuccess(`课表导入成功，共导入 ${courses.length} 门课程`);
    importNameDialogVisible.value = false;
    closeImportPreview();
    await loadSchedules(imported.id);
  } catch (error) {
    notifyError(getApiErrorMessage(error, "课表导入失败"));
  } finally {
    importUploading.value = false;
  }
}

/* ======================== 作息表管理 ======================== */
/** 作息表列表（模板 + 从已有课表提取的历史作息；来自课表的只读） */
const timetableList = ref<ScheduleTimetableOption[]>([]);
const timetableListLoading = ref(false);
const timetableManagerVisible = ref(false);

/** 新建 / 编辑作息表弹窗 */
const timetableFormVisible = ref(false);
const timetableSaving = ref(false);
/** 正在编辑的模板 id；null = 新建 */
const timetableEditingId = ref<number | null>(null);
const timetableDraftName = ref("");
const timetableDraftRows = ref<EditableTimetableRow[]>([]);

const timetableFormTitle = computed(() =>
  timetableEditingId.value == null ? "新建作息表" : "编辑作息表",
);

/** 作息表下拉 / 列表统一文案：名称（N 节）+ 来源课表后缀 */
function timetableOptionLabel(option: ScheduleTimetableOption): string {
  const suffix = option.fromSchedule ? " · 来自课表" : "";
  return `${option.name}（${option.times.length} 节）${suffix}`;
}

/** 列表里的前 2 节时间预览 */
function timetableTimesPreview(times: string[]): string {
  const preview = times.slice(0, 2).join(" / ");
  return times.length > 2 ? `${preview} …` : preview;
}

/** 拉取作息表列表（管理弹窗用，失败 notifyError） */
async function loadTimetableList(): Promise<void> {
  timetableListLoading.value = true;
  try {
    const response = await scheduleApi.getTimetables();
    timetableList.value = response.data ?? [];
  } catch (error) {
    timetableList.value = [];
    notifyError(getApiErrorMessage(error, "作息表加载失败"));
  } finally {
    timetableListLoading.value = false;
  }
}

function openTimetableManager(): void {
  timetableManagerVisible.value = true;
  void loadTimetableList();
}

function closeTimetableManager(): void {
  timetableManagerVisible.value = false;
}

/** 用一组时间填充作息表表单的编辑行 */
function fillTimetableDraftRows(times: string[]): void {
  timetableDraftRows.value = times.map((value) => ({
    key: nextTimetableRowKey(),
    value,
  }));
}

function openCreateTimetableForm(): void {
  if (timetableSaving.value) return;
  timetableEditingId.value = null;
  timetableDraftName.value = "";
  fillTimetableDraftRows([...DEFAULT_TIMETABLE]);
  timetableFormVisible.value = true;
}

function openEditTimetableForm(option: ScheduleTimetableOption): void {
  if (option.fromSchedule || option.id <= 0 || timetableSaving.value) return;
  timetableEditingId.value = option.id;
  timetableDraftName.value = option.name;
  fillTimetableDraftRows(option.times);
  timetableFormVisible.value = true;
}

/** 「来自课表」的只读作息也可以复制成一份可编辑模板 */
function copyTimetableAsNew(option: ScheduleTimetableOption): void {
  if (timetableSaving.value) return;
  timetableEditingId.value = null;
  timetableDraftName.value = option.name;
  fillTimetableDraftRows(option.times);
  timetableFormVisible.value = true;
}

function addTimetableDraftRow(): void {
  if (timetableSaving.value) return;
  if (timetableDraftRows.value.length >= 30) {
    notifyError("作息时间最多支持 30 节");
    return;
  }
  timetableDraftRows.value.push({ key: nextTimetableRowKey(), value: "" });
}

function removeTimetableDraftRow(index: number): void {
  if (timetableSaving.value) return;
  timetableDraftRows.value.splice(index, 1);
}

/** 校验作息表表单：名称非空 ≤100、≥1 节、每节 HH:mm-HH:mm 且结束晚于开始 */
function validateTimetableDraft(): string | null {
  const name = timetableDraftName.value.trim();
  if (!name) return "请输入作息表名称";
  if (name.length > 100) return "作息表名称不能超过 100 个字符";
  if (timetableDraftRows.value.length === 0) return "请至少添加一节作息时间";

  for (let index = 0; index < timetableDraftRows.value.length; index += 1) {
    const value = timetableDraftRows.value[index]!.value.trim();
    if (!value) return `第 ${index + 1} 节：不能为空`;
    if (!TIMETABLE_SLOT_PATTERN.test(value)) {
      return `第 ${index + 1} 节：格式应为 HH:mm-HH:mm`;
    }
    if (!parseTimetableSlot(value)) {
      return `第 ${index + 1} 节：结束时间必须晚于开始时间`;
    }
  }
  return null;
}

async function saveTimetableForm(): Promise<void> {
  const error = validateTimetableDraft();
  if (error) {
    notifyError(error);
    return;
  }

  const payload: TimetablePayload = {
    name: timetableDraftName.value.trim(),
    times: timetableDraftRows.value.map((row) => row.value.trim()),
  };
  timetableSaving.value = true;
  try {
    if (timetableEditingId.value == null) {
      await scheduleApi.createTimetable(payload);
      notifySuccess("作息表已创建");
    } else {
      await scheduleApi.updateTimetable(timetableEditingId.value, payload);
      notifySuccess("作息表已保存");
    }
    timetableFormVisible.value = false;
    await loadTimetableList();
    // 课表设置弹窗开着的话，套用下拉也同步刷新
    if (scheduleFormVisible.value) void loadScheduleFormTimetables();
  } catch (error) {
    notifyError(getApiErrorMessage(error, "作息表保存失败"));
  } finally {
    timetableSaving.value = false;
  }
}

/** 删除作息表模板（仅模板可删，来自课表的只读项没有入口） */
async function handleDeleteTimetable(
  option: ScheduleTimetableOption,
): Promise<void> {
  if (option.fromSchedule || option.id <= 0) return;
  try {
    await ElMessageBox.confirm(
      `确定删除作息表「${option.name}」吗？已套用它新建的课表不受影响。`,
      "删除作息表",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }

  try {
    await scheduleApi.removeTimetable(option.id);
    notifySuccess("作息表已删除");
    await loadTimetableList();
  } catch (error) {
    notifyError(getApiErrorMessage(error, "删除作息表失败"));
  }
}

/* ======================== 工具栏交互 ======================== */
async function handleScheduleChange(value: unknown): Promise<void> {
  if (typeof value !== "number") return;
  if (value === activeScheduleId.value) return;
  await selectSchedule(value);
}

function handleWeekChange(value: unknown): void {
  if (typeof value === "number") setWeek(value);
}

onMounted(() => {
  void loadSchedules();
});
</script>

<template>
  <el-scrollbar :wrap-style="scrollWrapStyle" view-class="schedule-scroll-view" class="schedule-scrollbar">
    <div class="schedule-page">
      <!-- ======================== 工具栏 ======================== -->
      <header class="schedule-card schedule-toolbar">
        <div class="schedule-toolbar-main">
          <el-select v-if="schedules.length > 1" :model-value="activeScheduleId ?? undefined"
            class="schedule-term-select" placeholder="选择课表" @change="handleScheduleChange">
            <el-option v-for="schedule in schedules" :key="schedule.id" :label="schedule.scheduleName"
              :value="schedule.id" />
          </el-select>

          <div v-if="activeSchedule" class="schedule-term-meta">
            <div v-if="schedules.length <= 1" class="schedule-term-name">
              {{ activeSchedule.scheduleName }}
            </div>
            <div class="schedule-term-range">{{ termRangeLabel }}</div>
          </div>
          <div v-else class="schedule-term-meta">
            <div class="schedule-term-name">课表</div>
            <div class="schedule-term-range">还没有课表</div>
          </div>
        </div>

        <div class="schedule-toolbar-actions">
          <template v-if="activeSchedule">
            <div class="schedule-week-nav">
              <button type="button" class="schedule-btn is-icon" :disabled="currentWeek <= 1" title="上一周"
                aria-label="上一周" @click="goPrevWeek">‹</button>
              <el-select v-model="currentWeek" class="schedule-week-select" @change="handleWeekChange">
                <el-option v-for="week in weekOptions" :key="week" :label="`第 ${week} 周`" :value="week" />
              </el-select>
              <button type="button" class="schedule-btn is-icon" :disabled="currentWeek >= weekCount" title="下一周"
                aria-label="下一周" @click="goNextWeek">›</button>
              <button type="button" class="schedule-btn" :class="isTodayWeek ? 'is-active' : 'is-ghost'"
                title="回到今天所在周" @click="goToday">今天</button>
            </div>
            <button type="button" class="schedule-btn is-primary" @click="openCreateCourse">添加课程</button>
            <button type="button" class="schedule-btn is-ghost" @click="openEditSchedule">课表设置</button>
            <button type="button" class="schedule-btn" @click="openCreateSchedule">新建课表</button>
            <button type="button" class="schedule-btn" @click="openTimetableManager">作息表</button>
            <button type="button" class="schedule-btn" :disabled="isImportBusy" @click="openImportPicker">
              {{ importButtonLabel }}
            </button>
          </template>
          <template v-else-if="!loading">
            <button type="button" class="schedule-btn is-primary" @click="openCreateSchedule">新建课表</button>
            <button type="button" class="schedule-btn" @click="openTimetableManager">作息表</button>
            <button type="button" class="schedule-btn" :disabled="isImportBusy" @click="openImportPicker">
              {{ importButtonLabel }}
            </button>
          </template>
        </div>

        <!-- 导入课表的隐藏文件选择框：由「导入课表」按钮触发（Excel 表格 / 截图 / PDF） -->
        <input ref="importInputRef" type="file" class="schedule-import-input" :accept="IMPORT_FILE_ACCEPT"
          @change="handleImportFileChange" />
      </header>

      <!-- ======================== 加载中 ======================== -->
      <!-- 骨架按真实布局铺满：左侧网格卡 + 右侧课程栏，避免页面在加载时缩成一条窄条 -->
      <div v-if="loading" class="schedule-body schedule-loading-body">
        <div class="schedule-card schedule-loading">
          <el-skeleton :rows="10" animated />
        </div>
        <aside class="schedule-card schedule-loading-side">
          <el-skeleton :rows="5" animated />
        </aside>
      </div>

      <!-- ======================== 没有任何课表 ======================== -->
      <div v-else-if="!activeSchedule" class="schedule-card schedule-empty">
        <div class="schedule-empty-icon">🗓</div>
        <div class="schedule-empty-title">还没有课表，先创建一个</div>
        <div class="schedule-empty-desc">设置学期名称、开课日期、周数与作息时间表，之后就可以添加课程了</div>
        <button type="button" class="schedule-btn is-primary" @click="openCreateSchedule">创建课表</button>
      </div>

      <!-- ======================== 课表主体 ======================== -->
      <div v-else class="schedule-body">
        <section class="schedule-card schedule-grid-card">
          <div class="schedule-week-strip">
            <div class="schedule-week-strip-text">
              第 {{ currentWeek }} 周 / 共 {{ weekCount }} 周<span v-if="isTodayWeek"
                class="schedule-week-strip-badge">本周</span> · {{ weekDateLabel }}
            </div>
            <div v-if="!isTodayWeek" class="schedule-week-strip-hint">
              <button type="button" class="schedule-link-btn" @click="goToday">回到本周（第 {{ todayWeek }} 周）</button>
            </div>
          </div>

          <div v-if="!hasCourses" class="schedule-grid-empty">
            还没有课程，点击右上角「添加课程」开始安排课表
          </div>
          <div v-else-if="courseBlocks.length === 0" class="schedule-grid-empty">
            第 {{ currentWeek }} 周暂无课程
          </div>

          <div class="timetable-scroll">
            <div class="timetable"
              :style="{ gridTemplateRows: `46px repeat(${Math.max(timetable.length, 1)}, var(--schedule-row-h, 56px))` }">
              <!-- 表头：节次列 + 周一到周日 -->
              <div class="timetable-corner">节次</div>
              <div v-for="day in DAY_OPTIONS" :key="`day-${day.value}`" class="timetable-day"
                :class="{ 'is-today': isTodayColumn(day.value) }">
                <span class="timetable-day-name">{{ day.label }}</span>
                <span class="timetable-day-date">{{ dayDateLabel(day.value) }}</span>
              </div>

              <!-- 每一节：左侧节次时间 + 7 天背景格（全部显式定位，保证课程块跨行不挤乱） -->
              <template v-for="(slot, slotIndex) in timetable" :key="`row-${slotIndex}`">
                <div class="timetable-time" :style="{ gridColumn: '1', gridRow: String(slotIndex + 2) }">
                  <span class="timetable-section-no">{{ slotIndex + 1 }}</span>
                  <span class="timetable-section-time">{{ slot }}</span>
                </div>
                <div v-for="day in DAY_OPTIONS" :key="`cell-${slotIndex}-${day.value}`" class="timetable-cell"
                  :class="{ 'is-today': isTodayColumn(day.value) }"
                  :style="{ gridColumn: String(day.value + 1), gridRow: String(slotIndex + 2) }"></div>
              </template>

              <!-- 课程块：按 sectionList 跨行，颜色来自课程数据 -->
              <button v-for="block in courseBlocks" :key="block.key" type="button" class="timetable-block"
                :class="{ 'is-active': activeBlockKey === block.key, 'is-compact': block.span <= 1 }"
                :style="block.style"
                :title="`${block.courseName} · ${dayLabel(block.dayOfWeek)} 第 ${formatSections(block.sectionList)} 节`"
                @click="openCourseDetail(block)">
                <span class="timetable-block-name">{{ block.courseName }}</span>
                <span class="timetable-block-meta">{{ block.location || "未填地点" }}</span>
                <span class="timetable-block-meta is-teacher">{{ block.teacher }}</span>
              </button>
            </div>
          </div>
        </section>

        <!-- 右侧：本周课程 + 全部课程图例（≤900px 隐藏） -->
        <aside class="schedule-card schedule-side">
          <div class="schedule-side-head">
            本周课程
            <span class="schedule-side-count">{{ weekCourseEntries.length }}</span>
          </div>
          <div v-if="weekCourseEntries.length > 0" class="schedule-side-list">
            <button v-for="entry in weekCourseEntries" :key="entry.key" type="button" class="schedule-side-item"
              @click="openCourseDetailFromSide(entry.course, entry.time.id)">
              <span class="schedule-dot" :style="{ backgroundColor: entry.course.color }"></span>
              <span class="schedule-side-item-main">
                <span class="schedule-side-item-name">{{ entry.course.courseName }}</span>
                <span class="schedule-side-item-meta">
                  {{ dayLabel(entry.time.dayOfWeek) }} · 第{{ formatSections(entry.time.sectionList) }}节 ·
                  {{ entry.time.location }}
                </span>
              </span>
            </button>
          </div>
          <div v-else class="schedule-side-empty">本周没有课程</div>

          <div class="schedule-side-sub">全部课程</div>
          <div v-if="detail && detail.courses.length > 0" class="schedule-legend">
            <span v-for="course in detail.courses" :key="course.id" class="schedule-legend-item">
              <span class="schedule-dot" :style="{ backgroundColor: course.color }"></span>{{ course.courseName }}
            </span>
          </div>
          <div v-else class="schedule-side-empty">暂无课程</div>
        </aside>
      </div>
    </div>

    <!-- ======================== 课程详情弹窗 ======================== -->
    <AppDialog v-model="courseDetailVisible" :title="detailCourse?.courseName ?? '课程详情'" content-width="440px"
      :close-on-click-modal="false">
      <div v-if="detailCourse" class="schedule-detail">
        <div class="schedule-detail-head">
          <span class="schedule-dot is-lg" :style="{ backgroundColor: detailCourse.color }"></span>
          <div>
            <div class="schedule-detail-name">{{ detailCourse.courseName }}</div>
            <div v-if="detailCourse.remark" class="schedule-detail-sub">{{ detailCourse.remark }}</div>
          </div>
        </div>

        <div class="schedule-detail-section-title">
          时间段（{{ detailCourse.times.length }}）
        </div>
        <div class="schedule-detail-times">
          <div v-for="time in detailCourse.times" :key="time.id" class="schedule-detail-time"
            :class="{ 'is-current': time.id === activeTimeId }">
            <div class="schedule-detail-time-head">
              {{ dayLabel(time.dayOfWeek) }} · 第{{ formatSections(time.sectionList) }}节
            </div>
            <div class="schedule-detail-time-meta">
              {{ formatWeeks(time.weekList) }} · {{ time.location || "未填地点" }} ·
              {{ time.teacher || "未填教师" }}
            </div>
            <div v-if="time.remark" class="schedule-detail-time-remark">{{ time.remark }}</div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="schedule-dialog-footer">
          <button type="button" class="schedule-btn is-danger" @click="handleDeleteCourse">删除课程</button>
          <span class="schedule-footer-spacer"></span>
          <button type="button" class="schedule-btn" @click="courseDetailVisible = false">关闭</button>
          <button type="button" class="schedule-btn is-primary" @click="handleEditCourse">编辑</button>
        </div>
      </template>
    </AppDialog>

    <!-- ======================== 添加 / 编辑课程弹窗 ======================== -->
    <AppDialog v-model="courseFormVisible" :title="courseDraft.id ? '编辑课程' : '添加课程'" content-width="660px"
      :close-on-click-modal="false">
      <div class="schedule-form">
        <div class="schedule-form-grid">
          <label class="schedule-field">
            <span>课程名称</span>
            <input v-model="courseDraft.courseName" class="schedule-input" maxlength="100" placeholder="如：高等数学" />
          </label>
          <div class="schedule-field">
            <span>课程颜色</span>
            <div class="schedule-color-row">
              <button v-for="color in PRESET_COURSE_COLORS" :key="color" type="button" class="schedule-color-swatch"
                :class="{ 'is-active': courseDraft.color === color }" :style="{ backgroundColor: color }" :title="color"
                :aria-label="`选择颜色 ${color}`" @click="courseDraft.color = color"></button>
              <label class="schedule-color-custom-wrap" title="自定义颜色">
                <input v-model="courseDraft.color" type="color" class="schedule-color-custom" />
                <span>自定义</span>
              </label>
            </div>
          </div>
        </div>

        <label class="schedule-field">
          <span>课程备注（可选）</span>
          <textarea v-model="courseDraft.remark" class="schedule-textarea" rows="2"
            placeholder="如教材、考试方式等"></textarea>
        </label>

        <div class="schedule-sub-head">
          <span>时间段（{{ courseDraft.times.length }}）</span>
          <button type="button" class="schedule-btn is-ghost is-small" @click="addTimeDraft">
            ＋ 添加时间段
          </button>
        </div>

        <div v-for="(time, index) in courseDraft.times" :key="index" class="schedule-time-card">
          <div class="schedule-time-card-head">
            <span>时间段 {{ index + 1 }}</span>
            <button type="button" class="schedule-btn is-danger is-small" :disabled="courseDraft.times.length <= 1"
              @click="removeTimeDraft(index)">删除</button>
          </div>

          <div class="schedule-form-grid">
            <label class="schedule-field">
              <span>星期</span>
              <el-select v-model="time.dayOfWeek" class="schedule-select">
                <el-option v-for="day in DAY_OPTIONS" :key="day.value" :label="day.label" :value="day.value" />
              </el-select>
            </label>
            <label class="schedule-field">
              <span>上课地点</span>
              <input v-model="time.location" class="schedule-input" maxlength="255" placeholder="如：A101" />
            </label>
            <label class="schedule-field">
              <span>任课教师</span>
              <input v-model="time.teacher" class="schedule-input" maxlength="100" placeholder="如：张老师" />
            </label>
            <label class="schedule-field">
              <span>时间段备注（可选）</span>
              <input v-model="time.remark" class="schedule-input" maxlength="255" placeholder="可选" />
            </label>
          </div>

          <div class="schedule-field">
            <div class="schedule-chip-head">
              <span>周次（已选 {{ time.weekList.length }} / {{ weekCount }}）</span>
              <span class="schedule-mini-actions">
                <button type="button" class="schedule-link-btn" @click="selectAllWeeks(time)">全选</button>
                <button type="button" class="schedule-link-btn" @click="invertWeeks(time)">反选</button>
              </span>
            </div>
            <div class="schedule-chip-group">
              <button v-for="week in weekOptions" :key="week" type="button" class="schedule-chip"
                :class="{ 'is-active': time.weekList.includes(week) }" @click="toggleWeek(time, week)">
                {{ week }}
              </button>
            </div>
          </div>

          <div class="schedule-field">
            <div class="schedule-chip-head">
              <span>节次（已选 {{ time.sectionList.length }}）</span>
            </div>
            <div class="schedule-chip-group">
              <button v-for="(slot, slotIndex) in timetable" :key="`section-${slotIndex}`" type="button"
                class="schedule-chip is-block" :class="{ 'is-active': time.sectionList.includes(slotIndex + 1) }"
                @click="toggleSection(time, slotIndex + 1)">
                <span class="schedule-chip-strong">{{ slotIndex + 1 }}</span>
                <span class="schedule-chip-sub">{{ slot }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="schedule-dialog-footer">
          <span class="schedule-footer-spacer"></span>
          <button type="button" class="schedule-btn" @click="courseFormVisible = false">取消</button>
          <button type="button" class="schedule-btn is-primary" :disabled="courseSaving" @click="handleSaveCourse">
            {{ courseSaving ? "保存中..." : "保存课程" }}
          </button>
        </div>
      </template>
    </AppDialog>

    <!-- ======================== 导入课表预检弹窗 ======================== -->
    <AppDialog v-model="importPreviewVisible" :title="importPreviewTitle" :subtitle="importPreviewSubtitle"
      content-width="860px" :closable="!importUploading" :close-on-click-modal="false"
      :close-on-press-escape="!importUploading" :show-close="!importUploading"
      @closed="resetImportPreview">
      <div v-if="importPreview" class="schedule-import-preview">
        <!-- OCR 来源提示：识别结果可能带错别字，提醒重点核对 -->
        <div v-if="importFileKind === 'ocr'" class="schedule-import-ocr-tip">
          以下内容由图片 / PDF 文字识别（OCR）得出，可能存在错别字，请重点核对课程名、节次、周次后再导入。
        </div>

        <!-- 摘要：默认名称 / 学期 / 日期 / 周数节次 / 课程数 -->
        <div class="schedule-import-summary">
          <div class="schedule-import-summary-item">
            <span>默认课表名</span>
            <strong>{{ importPreview.scheduleName || "—" }}</strong>
          </div>
          <div v-if="importPreview.semesterLabel" class="schedule-import-summary-item">
            <span>学期</span>
            <strong>{{ importPreview.semesterLabel }}</strong>
          </div>
          <div class="schedule-import-summary-item">
            <span>开课日期</span>
            <strong>{{ importPreview.startTime || "—" }}</strong>
          </div>
          <div class="schedule-import-summary-item">
            <span>周数 / 节次</span>
            <strong>{{ importPreview.weekCount }} 周 · {{ importTimetableRows.length }} 节</strong>
          </div>
          <div class="schedule-import-summary-item">
            <span>课程 / 时间段</span>
            <strong>{{ importEditedCourseCount }} 门 · {{ importRows.length }} 个</strong>
          </div>
        </div>

        <!-- 需要用户确认的提示 -->
        <div v-if="importPreview.warnings.length > 0" class="schedule-import-notice is-warning">
          <div class="schedule-import-notice-title">请核对以下提示</div>
          <ul class="schedule-import-notice-list">
            <li v-for="(warning, index) in importPreview.warnings" :key="`warning-${index}`">{{ warning }}</li>
          </ul>
        </div>

        <!-- 预检冲突 -->
        <div v-if="importPreview.conflicts.length > 0" class="schedule-import-notice is-danger">
          <div class="schedule-import-notice-title">检测到时间冲突（仍可导入，请导入后自行核对）</div>
          <ul class="schedule-import-notice-list">
            <li v-for="(conflict, index) in importPreview.conflicts" :key="`conflict-${index}`">{{ conflict }}</li>
          </ul>
        </div>

        <!-- 作息时间表：文件里有就沿用，没有则提供历史作息 / 默认 / 手动新建 -->
        <div class="schedule-import-timetable">
          <div class="schedule-import-timetable-head">
            <span class="schedule-import-timetable-title">作息时间表</span>
            <span class="schedule-import-timetable-source">
              {{ importPreview.timetableFromFile
                ? `已从文件读取 ${importPreview.timetable.length} 节作息`
                : "文件里没有作息时间表" }}
            </span>
          </div>

          <div class="schedule-import-timetable-actions">
            <span v-if="savedTimetables.length > 0" class="schedule-import-timetable-actions-label">
              使用已保存的作息
            </span>
            <el-select v-if="savedTimetables.length > 0" :model-value="selectedSavedTimetable ?? undefined"
              class="schedule-import-timetable-select" placeholder="使用已保存的作息" @change="applySavedTimetable">
              <el-option v-for="(option, index) in savedTimetables" :key="index"
                :label="timetableOptionLabel(option)" :value="index" />
            </el-select>
            <button type="button" class="schedule-btn is-ghost is-small" :disabled="isImportBusy"
              @click="useDefaultTimetable">使用默认作息</button>
          </div>

          <div v-if="!importPreview.timetableFromFile && !savedTimetablesLoading && savedTimetables.length === 0"
            class="schedule-import-timetable-notice">
            文件里没有作息时间表，也没有已保存的作息；可以直接编辑下方时间（新建作息），或使用默认作息。
          </div>

          <div class="schedule-import-timetable-list">
            <div v-for="(row, index) in importTimetableRows" :key="row.key" class="schedule-import-timetable-row">
              <span class="schedule-import-timetable-index">第 {{ index + 1 }} 节</span>
              <el-input v-model="row.value" size="small" class="schedule-import-timetable-input" maxlength="11"
                placeholder="HH:mm-HH:mm" :disabled="importUploading" @input="markTimetableEdited" />
              <button type="button" class="schedule-btn is-danger is-small" :disabled="importUploading"
                @click="removeImportTimetableRow(index)">删除</button>
            </div>
          </div>
          <div class="schedule-import-timetable-footer">
            <button type="button" class="schedule-btn is-ghost is-small" :disabled="isImportBusy"
              @click="addImportTimetableRow">＋ 添加一节</button>
          </div>
        </div>

        <!-- 课程明细：一行 = 一个时间段，可直接修改；核对无误再点「下一步」 -->
        <div class="schedule-sub-head">
          <span>课程明细（{{ importRows.length }} 个时间段，可直接修改）</span>
          <button type="button" class="schedule-btn is-ghost is-small" :disabled="isImportBusy" @click="addImportRow">
            ＋ 添加一行
          </button>
        </div>
        <div v-if="importRows.length > 0" class="schedule-import-table-wrap">
          <table class="schedule-import-table is-editable">
            <thead>
              <tr>
                <th>课程</th>
                <th class="is-day">星期</th>
                <th class="is-sections">节次</th>
                <th class="is-weeks">周次</th>
                <th>地点</th>
                <th>教师</th>
                <th class="is-action">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in importRows" :key="row.key">
                <td>
                  <div class="schedule-import-course-cell">
                    <span class="schedule-dot" :style="{ backgroundColor: row.color }"></span>
                    <el-input v-model="row.courseName" size="small" maxlength="100" placeholder="课程名"
                      :disabled="importUploading" />
                  </div>
                </td>
                <td>
                  <el-select v-model="row.dayOfWeek" size="small" class="schedule-import-day-select"
                    :disabled="importUploading">
                    <el-option v-for="day in DAY_OPTIONS" :key="day.value" :label="day.label" :value="day.value" />
                  </el-select>
                </td>
                <td>
                  <el-input v-model="row.sectionText" size="small" placeholder="如 1-2" :disabled="importUploading" />
                </td>
                <td>
                  <el-input v-model="row.weekText" size="small" placeholder="如 1-16" :disabled="importUploading" />
                </td>
                <td>
                  <el-input v-model="row.location" size="small" maxlength="255" placeholder="地点"
                    :disabled="importUploading" />
                </td>
                <td>
                  <el-input v-model="row.teacher" size="small" maxlength="100" placeholder="教师"
                    :disabled="importUploading" />
                </td>
                <td>
                  <button type="button" class="schedule-btn is-danger is-small" :disabled="importUploading"
                    @click="removeImportRow(index)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="schedule-side-empty">
          没有识别到课程，请点「添加一行」手动补充
        </div>
      </div>

      <template #footer>
        <div class="schedule-dialog-footer">
          <span class="schedule-footer-spacer"></span>
          <button type="button" class="schedule-btn" :disabled="importUploading" @click="closeImportPreview">
            取消
          </button>
          <button type="button" class="schedule-btn is-primary" :disabled="isImportBusy || !importPreview"
            @click="handleImportNext">
            {{ importUploading ? "导入中..." : "下一步：命名并导入" }}
          </button>
        </div>
      </template>
    </AppDialog>

    <!-- 命名并导入：名称默认取预检里的课表名，用户可改 -->
    <AppDialog v-model="importNameDialogVisible" title="命名并导入课表" content-width="480px"
      :closable="!importUploading" :close-on-click-modal="false"
      :close-on-press-escape="!importUploading" :show-close="!importUploading">
      <div class="schedule-import-name">
        <p class="schedule-import-name-tip">导入后会新建一张课表，可以在课表切换里找到它。</p>
        <label class="schedule-import-name-label" for="schedule-import-name-input">课表名称</label>
        <el-input id="schedule-import-name-input" v-model="importName" maxlength="100" show-word-limit
          placeholder="如：2025-2026 学年第一学期" :disabled="importUploading" autofocus
          @keyup.enter="confirmImportName" />
        <p v-if="importNameError" class="schedule-import-name-error">{{ importNameError }}</p>
      </div>
      <template #footer>
        <div class="schedule-dialog-footer">
          <span class="schedule-footer-spacer"></span>
          <button type="button" class="schedule-btn" :disabled="importUploading" @click="cancelImportName">
            取消
          </button>
          <button type="button" class="schedule-btn is-primary" :disabled="importUploading"
            @click="confirmImportName">
            {{ importUploading ? "导入中..." : "导入" }}
          </button>
        </div>
      </template>
    </AppDialog>

    <!-- ======================== 作息表管理弹窗 ======================== -->
    <AppDialog v-model="timetableManagerVisible" title="作息表管理" content-width="640px"
      :subtitle="timetableList.length > 0 ? `共 ${timetableList.length} 套` : ''" :close-on-click-modal="false">
      <div class="schedule-timetable-manager">
        <div v-if="timetableListLoading" class="schedule-timetable-empty">加载中…</div>
        <div v-else-if="timetableList.length === 0" class="schedule-timetable-empty">
          还没有保存过作息表，点下方「新建作息表」创建一套，之后新建课表或导入时可以一键套用。
        </div>
        <div v-else class="schedule-timetable-list">
          <div v-for="(option, index) in timetableList" :key="index" class="schedule-timetable-item">
            <div class="schedule-timetable-item-main">
              <div class="schedule-timetable-item-head">
                <span class="schedule-timetable-item-name">{{ option.name }}</span>
                <span v-if="option.fromSchedule" class="schedule-timetable-item-badge">来自课表 · 只读</span>
                <span class="schedule-timetable-item-badge">{{ option.times.length }} 节</span>
              </div>
              <div class="schedule-timetable-item-times">{{ timetableTimesPreview(option.times) }}</div>
            </div>
            <div class="schedule-timetable-item-actions">
              <template v-if="!option.fromSchedule && option.id > 0">
                <button type="button" class="schedule-btn is-ghost is-small"
                  @click="openEditTimetableForm(option)">编辑</button>
                <button type="button" class="schedule-btn is-danger is-small"
                  @click="handleDeleteTimetable(option)">删除</button>
              </template>
              <button v-else type="button" class="schedule-btn is-ghost is-small"
                @click="copyTimetableAsNew(option)">复制为新作息表</button>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="schedule-dialog-footer">
          <span class="schedule-footer-spacer"></span>
          <button type="button" class="schedule-btn" @click="closeTimetableManager">关闭</button>
          <button type="button" class="schedule-btn is-primary" @click="openCreateTimetableForm">新建作息表</button>
        </div>
      </template>
    </AppDialog>

    <!-- ======================== 新建 / 编辑作息表弹窗 ======================== -->
    <AppDialog v-model="timetableFormVisible" :title="timetableFormTitle" content-width="520px"
      :closable="!timetableSaving" :close-on-click-modal="false"
      :close-on-press-escape="!timetableSaving" :show-close="!timetableSaving">
      <div class="schedule-timetable-form">
        <label class="schedule-field">
          <span>作息表名称</span>
          <input v-model="timetableDraftName" class="schedule-input" maxlength="100" :disabled="timetableSaving"
            placeholder="如：夏季作息 / 高中部作息" />
        </label>

        <div class="schedule-sub-head">
          <span>作息时间（{{ timetableDraftRows.length }} 节）</span>
          <button type="button" class="schedule-btn is-ghost is-small" :disabled="timetableSaving"
            @click="addTimetableDraftRow">＋ 添加一节</button>
        </div>

        <div class="schedule-timetable-form-rows">
          <div v-for="(row, index) in timetableDraftRows" :key="row.key" class="schedule-timetable-form-row">
            <span class="schedule-timetable-form-index">第 {{ index + 1 }} 节</span>
            <el-input v-model="row.value" class="schedule-timetable-form-input" size="small" maxlength="11"
              placeholder="HH:mm-HH:mm" :disabled="timetableSaving" />
            <button type="button" class="schedule-btn is-danger is-small" :disabled="timetableSaving"
              @click="removeTimetableDraftRow(index)">删除</button>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="schedule-dialog-footer">
          <span class="schedule-footer-spacer"></span>
          <button type="button" class="schedule-btn" :disabled="timetableSaving"
            @click="timetableFormVisible = false">取消</button>
          <button type="button" class="schedule-btn is-primary" :disabled="timetableSaving" @click="saveTimetableForm">
            {{ timetableSaving ? "保存中..." : "保存" }}
          </button>
        </div>
      </template>
    </AppDialog>

    <!-- ======================== 课表设置弹窗 ======================== -->
    <AppDialog v-model="scheduleFormVisible" :title="scheduleDraft.id ? '课表设置' : '新建课表'" content-width="600px"
      :close-on-click-modal="false">
      <div class="schedule-form">
        <div class="schedule-form-grid">
          <label class="schedule-field">
            <span>课表名称</span>
            <input v-model="scheduleDraft.scheduleName" class="schedule-input" maxlength="100"
              placeholder="如：2026 春季学期" />
          </label>
          <label class="schedule-field">
            <span>开课日期（第一周周一）</span>
            <el-date-picker v-model="scheduleDraft.startTime" type="date" format="YYYY-MM-DD" value-format="YYYY-MM-DD"
              placeholder="选择开课日期" class="schedule-date-picker" />
          </label>
          <label class="schedule-field">
            <span>学期周数（1-100）</span>
            <input v-model.number="scheduleDraft.weekCount" type="number" min="1" max="100" class="schedule-input" />
          </label>
        </div>

        <label class="schedule-field">
          <span>课表备注（可选）</span>
          <textarea v-model="scheduleDraft.remark" class="schedule-textarea" rows="2"
            placeholder="如：示例课表（联调用）"></textarea>
        </label>

        <label class="schedule-field">
          <span>套用作息表（可选）</span>
          <el-select :model-value="scheduleFormTimetableIndex ?? undefined" class="schedule-select"
            placeholder="选择一套作息表填充下方时间" @change="applyScheduleFormTimetable">
            <el-option v-for="(option, index) in scheduleFormTimetableOptions" :key="index"
              :label="timetableOptionLabel(option)" :value="index" />
          </el-select>
        </label>

        <div class="schedule-sub-head">
          <span>作息时间表（{{ scheduleDraft.timetable.length }} 节）</span>
          <button type="button" class="schedule-btn is-ghost is-small" @click="addTimetableRow">
            ＋ 添加一节
          </button>
        </div>

        <div class="schedule-timetable-edit">
          <div v-for="index in timetableRows" :key="index" class="schedule-timetable-row">
            <span class="schedule-timetable-index">第 {{ index + 1 }} 节</span>
            <input v-model="scheduleDraft.timetable[index]" class="schedule-input" maxlength="11"
              placeholder="HH:mm-HH:mm" />
            <button type="button" class="schedule-btn is-danger is-small"
              :disabled="scheduleDraft.timetable.length <= 1" @click="removeTimetableRow(index)">删除</button>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="schedule-dialog-footer">
          <button v-if="scheduleDraft.id" type="button" class="schedule-btn is-danger" @click="handleDeleteSchedule">
            删除课表
          </button>
          <span class="schedule-footer-spacer"></span>
          <button type="button" class="schedule-btn" @click="scheduleFormVisible = false">取消</button>
          <button type="button" class="schedule-btn is-primary" :disabled="scheduleSaving" @click="handleSaveSchedule">
            {{ scheduleSaving ? "保存中..." : "保存" }}
          </button>
        </div>
      </template>
    </AppDialog>
  </el-scrollbar>
</template>

<style lang="scss">
// 课表页骨架与弹窗样式（全局样式，弹窗 teleport 到 body 后同样生效）
@use "@/features/schedule/style/index.scss";
</style>
