// 课表接口封装：与后端 ScheduleController 契约一一对应。
// 说明：所有接口都关闭了 http 层的全局错误提示（showError: false），
// 由页面统一用 notifyError 展示更精确的文案，避免重复弹提示。
import http from "@/libs/http";
import type {
  Course,
  CoursePayload,
  ScheduleDetail,
  ScheduleImportConfirmPayload,
  ScheduleImportPayload,
  ScheduleImportPreview,
  SchedulePayload,
  ScheduleSummary,
  ScheduleTimetableOption,
  TimetablePayload,
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

  /**
   * 作息表列表：模板在前，再补上从已有课表提取的历史作息。
   * 导入预检弹窗 / 作息表管理 / 课表设置套用都用它；失败由页面处理。
   */
  async getTimetables() {
    return await http.get<ScheduleTimetableOption[]>(
      "/mm/Schedule/Timetables",
      undefined,
      { showError: false },
    );
  },

  /** 新建作息表模板，返回创建后的条目 */
  async createTimetable(payload: TimetablePayload) {
    return await http.post<ScheduleTimetableOption>(
      "/mm/Schedule/Timetables",
      payload,
      { showError: false },
    );
  },

  /** 修改作息表模板，返回更新后的条目 */
  async updateTimetable(id: number, payload: TimetablePayload) {
    return await http.put<ScheduleTimetableOption>(
      `/mm/Schedule/Timetables/${id}`,
      payload,
      { showError: false },
    );
  },

  /** 删除作息表模板（伪删除），返回 204 */
  async removeTimetable(id: number) {
    return await http.delete(`/mm/Schedule/Timetables/${id}`, {
      showError: false,
    });
  },

  /**
   * 导入预检（multipart/form-data，只解析不写库）。
   * 返回解析出的课表信息、课程明细、提示（warnings）与冲突（conflicts），
   * 前端让用户确认后再调用 importSchedule 正式保存。
   */
  async previewImport(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return await http.upload<ScheduleImportPreview>(
      "/mm/Schedule/Import/Preview",
      formData,
      {
        showError: false,
        // FormData 节流 key 会退化成 "{}"，避免不同文件的预检被误判为重复请求
        allowDuplicate: true,
      },
    );
  },

  /**
   * OCR 预检（图片 / PDF，multipart/form-data，只识别不写库）。
   * OCR 较慢（Termux 单页约 5~15 秒），返回结构与 Excel 预检一致。
   */
  async previewOcrImport(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return await http.upload<ScheduleImportPreview>(
      "/mm/Schedule/Import/Ocr/Preview",
      formData,
      {
        showError: false,
        // FormData 节流 key 会退化成 "{}"，避免不同文件的 OCR 预检被误判为重复请求
        allowDuplicate: true,
      },
    );
  },

  /**
   * 按预检结果正式保存（JSON，OCR / 图片流程用）。
   * 直接把预检返回的 courses 原样传回，不用再上传文件 / 重新 OCR。
   */
  async confirmImport(payload: ScheduleImportConfirmPayload) {
    return await http.post<ScheduleDetail>(
      "/mm/Schedule/Import/Confirm",
      payload,
      { showError: false },
    );
  },

  /**
   * 导入课表（multipart/form-data）。
   * file 必填；scheduleName / startTime / weekCount 可选（不传时后端用文件名等默认值）。
   * 返回导入后新建的课表详情（结构与 detail 相同）。
   */
  async importSchedule(payload: ScheduleImportPayload) {
    const formData = new FormData();
    formData.append("file", payload.file);
    if (payload.scheduleName?.trim()) {
      formData.append("scheduleName", payload.scheduleName.trim());
    }
    if (payload.startTime) {
      formData.append("startTime", payload.startTime);
    }
    if (payload.weekCount != null) {
      formData.append("weekCount", String(payload.weekCount));
    }

    return await http.upload<ScheduleDetail>("/mm/Schedule/Import", formData, {
      showError: false,
      // FormData 无法参与节流 key 计算（JSON.stringify 退化成 "{}"），
      // 不同文件的导入请求会互相误判为重复请求，这里禁用复用。
      allowDuplicate: true,
    });
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
