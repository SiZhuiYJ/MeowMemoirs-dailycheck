// 课表接口封装：与后端 ScheduleController 契约一一对应。
// 说明：所有接口都关闭了 http 层的全局错误提示（showError: false），
// 由页面统一用 notifyError 展示更精确的文案，避免重复弹提示。
import http from "@/libs/http";
import type {
  Course,
  CoursePayload,
  ScheduleDetail,
  SchedulePayload,
  ScheduleSummary,
} from "../types";

export const scheduleApi = {
  /** 我的课表列表（概要） */
  async list() {
    return await http.get<ScheduleSummary[]>("/mm/Schedule", undefined, {
      showError: false,
    });
  },

  /** 课表详情（含课程 + 时间段） */
  async detail(id: number) {
    return await http.get<ScheduleDetail>(`/mm/Schedule/${id}`, undefined, {
      showError: false,
    });
  },

  /** 新建 / 更新课表（id=0 或省略表示新建），返回课表详情 */
  async save(payload: SchedulePayload) {
    return await http.post<ScheduleDetail>("/mm/Schedule", payload, {
      showError: false,
    });
  },

  /** 删除课表（伪删除，连带课程与时间段），返回 204 */
  async remove(id: number) {
    return await http.delete(`/mm/Schedule/${id}`, { showError: false });
  },

  /** 新建 / 更新课程（times 整体替换），返回课程 */
  async saveCourse(scheduleId: number, payload: CoursePayload) {
    return await http.post<Course>(
      `/mm/Schedule/${scheduleId}/Course`,
      payload,
      { showError: false },
    );
  },

  /** 课程详情 */
  async courseDetail(scheduleId: number, courseId: number) {
    return await http.get<Course>(
      `/mm/Schedule/${scheduleId}/Course/${courseId}`,
      undefined,
      { showError: false },
    );
  },

  /** 删除课程（伪删除，连带时间段），返回 204 */
  async removeCourse(scheduleId: number, courseId: number) {
    return await http.delete(
      `/mm/Schedule/${scheduleId}/Course/${courseId}`,
      { showError: false },
    );
  },
};
