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
/** 预检通过后待正式导入的同一个文件 */
const pendingImportFile = ref<File | null>(null);
/** 本次选择的文件走哪条链路（Excel 解析 / OCR），选文件时确定 */
const importFileKind = ref<ImportFileKind>("excel");

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

/** 预检课程明细行：一节课一行（课程 × 时间段） */
interface ImportPreviewRow {
  key: string;
  courseName: string;
  dayOfWeek: number;
  sectionList: number[];
  weekList: number[];
  location: string;
  teacher: string;
}

/**
 * 预检数据里的课程 / 时间段 id 都是 0（还没入库），
 * 所以用两层下标拼 key，不能像详情页那样用 course.id-time.id。
 */
const importPreviewRows = computed<ImportPreviewRow[]>(() => {
  const rows: ImportPreviewRow[] = [];
  importPreview.value?.courses.forEach((course, courseIndex) => {
    course.times.forEach((time, timeIndex) => {
      rows.push({
        key: `${courseIndex}-${timeIndex}`,
        courseName: course.courseName,
        dayOfWeek: time.dayOfWeek,
        sectionList: time.sectionList,
        weekList: time.weekList,
        location: time.location,
        teacher: time.teacher,
      });
    });
  });
  return rows;
});

/** 周次压缩展示：1,2,3,4,9,10 → "1-4,9-10"（复用节次压缩逻辑，只把顿号换成逗号） */
function formatWeekRanges(weeks: number[]): string {
  return formatSections(weeks).split("、").join(",");
}

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
    pendingImportFile.value = file;
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

/** 关闭预检对话框：丢弃本次选择的文件，不调用正式导入接口 */
function closeImportPreview(): void {
  importPreviewVisible.value = false;
}

/** 等对话框关闭动画结束后再清空数据，避免关闭过程中表格内容闪空 */
function resetImportPreview(): void {
  importPreview.value = null;
  pendingImportFile.value = null;
}

/** 第二步：打开「命名并导入」弹窗（名称默认取预检里的课表名） */
function handleImportNext(): void {
  const preview = importPreview.value;
  const file = pendingImportFile.value;
  if (!preview || !file || isImportBusy.value) return;

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

/** 校验名称后正式保存：Excel 重新上传文件解析；OCR 直接把预检结果存库（不重复识别） */
async function confirmImportName(): Promise<void> {
  const preview = importPreview.value;
  const file = pendingImportFile.value;
  if (!preview || !file || importUploading.value) return;

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
    // OCR 结果直接回传预检数据，避免再跑一次 5~15 秒的识别；Excel 继续走文件导入接口
    const response =
      importFileKind.value === "ocr"
        ? await scheduleApi.confirmImport({
            scheduleName: name,
            startTime: preview.startTime,
            weekCount: preview.weekCount,
            timetable: preview.timetable,
            courses: preview.courses,
          })
        : await scheduleApi.importSchedule({ file, scheduleName: name });
    const imported = response.data;
    const courseCount =
      typeof imported.courseCount === "number"
        ? imported.courseCount
        : (imported.courses?.length ?? 0);
    notifySuccess(`课表导入成功，共导入 ${courseCount} 门课程`);
    importNameDialogVisible.value = false;
    closeImportPreview();
    await loadSchedules(imported.id);
  } catch (error) {
    notifyError(getApiErrorMessage(error, "课表导入失败"));
  } finally {
    importUploading.value = false;
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
            <button type="button" class="schedule-btn" :disabled="isImportBusy" @click="openImportPicker">
              {{ importButtonLabel }}
            </button>
          </template>
          <template v-else-if="!loading">
            <button type="button" class="schedule-btn is-primary" @click="openCreateSchedule">新建课表</button>
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
    <AppDialog v-model="importPreviewVisible" :title="importPreviewTitle"
      :subtitle="importPreview ? `${importPreview.courseCount} 门课程 · ${importPreview.timeCount} 个时间段` : ''"
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
            <strong>{{ importPreview.weekCount }} 周 · {{ importPreview.sectionCount }} 节</strong>
          </div>
          <div class="schedule-import-summary-item">
            <span>课程 / 时间段</span>
            <strong>{{ importPreview.courseCount }} 门 · {{ importPreview.timeCount }} 个</strong>
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

        <!-- 课程明细：一节课一行，让用户核对识别结果 -->
        <div class="schedule-sub-head">
          <span>课程明细（{{ importPreviewRows.length }} 个时间段）</span>
        </div>
        <div v-if="importPreviewRows.length > 0" class="schedule-import-table-wrap">
          <table class="schedule-import-table">
            <thead>
              <tr>
                <th>课程</th>
                <th class="is-narrow">星期</th>
                <th class="is-narrow">节次</th>
                <th>周次</th>
                <th>地点</th>
                <th>教师</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in importPreviewRows" :key="row.key">
                <td>{{ row.courseName }}</td>
                <td>{{ dayLabel(row.dayOfWeek) }}</td>
                <td>第{{ formatSections(row.sectionList) }}节</td>
                <td>{{ formatWeekRanges(row.weekList) }}</td>
                <td>{{ row.location || "—" }}</td>
                <td>{{ row.teacher || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="schedule-side-empty">没有识别到课程</div>
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
