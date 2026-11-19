/**
 * @file 课表相关类型定义
 * @description 与后端 Schedule / Course / CourseTime 三层模型一一对应（camelCase JSON）。
 * 接口契约见 _log/ui-refactor/schedule-feature-spec.md 第一节。
 */

/**
 * 课表概要（GET /mm/Schedule 列表项）
 */
export interface ScheduleSummary {
  /** 课表 ID */
  id: number;
  /** 课表名称，如「2026 春季学期」 */
  scheduleName: string;
  /** 学期第一周周一，格式 yyyy-MM-dd */
  startTime: string;
  /** 学期总周数（1-100） */
  weekCount: number;
  /** 每节课的时间段，如 ["08:00-08:45", ...]，数组下标 + 1 即节次 */
  timetable: string[];
  /** 备注 */
  remark: string | null;
  /** 课程数量（列表接口直接返回，避免为了计数再拉详情） */
  courseCount: number;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/**
 * 课表详情（GET /mm/Schedule/{id}）
 */
export interface ScheduleDetail extends ScheduleSummary {
  /** 课表下的全部课程（含各自的时间段） */
  courses: Course[];
}

/**
 * 课程
 */
export interface Course {
  /** 课程 ID */
  id: number;
  /** 所属课表 ID */
  scheduleId: number;
  /** 课程名称 */
  courseName: string;
  /** 课程颜色 #RRGGBB（课表块的左侧条用原色，浅底用其低透明度 rgba） */
  color: string;
  /** 课程备注 */
  remark: string | null;
  /** 该课程的全部上课时间段（一门课多段：不同星期 / 周次 / 地点） */
  times: CourseTime[];
}

/**
 * 课程时间段
 */
export interface CourseTime {
  /** 时间段 ID */
  id: number;
  /** 所属课程 ID */
  courseId: number;
  /** 上课地点 */
  location: string;
  /** 授课教师 */
  teacher: string;
  /** 生效周次，如 [1,2,3]（1..weekCount） */
  weekList: number[];
  /** 上课节次，如 [1,2]（1..timetable.length，最大 30） */
  sectionList: number[];
  /** 星期几：1-7，周一到周日 */
  dayOfWeek: number;
  /** 时间段备注 */
  remark: string | null;
}
