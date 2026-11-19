/**
 * 课表相关类型定义。
 *
 * 与后端 `GET/POST /mm/Schedule` 契约一一对应（camelCase JSON）：
 * 课表（Schedule）→ 课程（Course）→ 上课时间段（CourseTime）三层结构。
 */

/** 课表概要（列表接口使用，不带课程明细） */
export interface ScheduleSummary {
  id: number;
  scheduleName: string;
  /** 开课日期 yyyy-MM-dd（学期第一周周一） */
  startTime: string;
  /** 学期总周数 1-100 */
  weekCount: number;
  /** 作息时间表：每个元素是一节课的时间段，如 "08:00-08:45"；长度 = 节次数 */
  timetable: string[];
  remark: string | null;
  courseCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 一门课的一段上课时间（不同星期 / 周次 / 地点各是一条） */
export interface CourseTime {
  id: number;
  courseId: number;
  location: string;
  teacher: string;
  /** 周次，如 [1,2,3]（1..weekCount） */
  weekList: number[];
  /** 节次，如 [1,2]（1..timetable.length） */
  sectionList: number[];
  /** 星期几：1-7（周一到周日） */
  dayOfWeek: number;
  remark: string | null;
}

/** 课程（含全部上课时间段） */
export interface Course {
  id: number;
  scheduleId: number;
  courseName: string;
  /** 课程颜色 #RRGGBB */
  color: string;
  remark: string | null;
  times: CourseTime[];
}

/** 课表详情（概要 + 课程列表） */
export interface ScheduleDetail extends ScheduleSummary {
  courses: Course[];
}

/** 保存课表请求体（id 省略 / 0 表示新建） */
export interface SchedulePayload {
  id?: number;
  scheduleName: string;
  startTime: string;
  weekCount: number;
  timetable: string[];
  remark?: string | null;
}

/** 保存课程时间段请求体（id 省略 / 0 表示新增） */
export interface CourseTimePayload {
  id?: number;
  location: string;
  teacher: string;
  weekList: number[];
  sectionList: number[];
  dayOfWeek: number;
  remark?: string | null;
}

/** 保存课程请求体（times 整体替换：未出现的旧时间段会被后端伪删除） */
export interface CoursePayload {
  id?: number;
  courseName: string;
  color: string;
  remark?: string | null;
  times: CourseTimePayload[];
}

/**
 * 课表网格里的一个课程块：
 * 已按「当前周 + 星期」过滤，并把 sectionList 换算成 CSS Grid 的行位置。
 */
export interface CourseBlock {
  /** 唯一 key：courseId-timeId */
  key: string;
  courseId: number;
  timeId: number;
  courseName: string;
  color: string;
  location: string;
  teacher: string;
  dayOfWeek: number;
  sectionList: number[];
  weekList: number[];
  /** 起始节次（1-based，已按 timetable 长度收敛） */
  startSection: number;
  /** 跨行数 */
  span: number;
  /** 直接绑定到课程块上的行内样式（grid 位置 + 课程色 CSS 变量） */
  style: Record<string, string>;
}

/** 课程表单里的时间段草稿 */
export interface CourseTimeDraft {
  id?: number;
  dayOfWeek: number;
  weekList: number[];
  sectionList: number[];
  location: string;
  teacher: string;
  remark: string;
}

/** 课程表单草稿（添加 / 编辑课程弹窗） */
export interface CourseDraft {
  id?: number;
  courseName: string;
  color: string;
  remark: string;
  times: CourseTimeDraft[];
}

/** 课表设置表单草稿（新建 / 编辑课表弹窗） */
export interface ScheduleDraft {
  id?: number;
  scheduleName: string;
  startTime: string;
  weekCount: number;
  timetable: string[];
  remark: string;
}
