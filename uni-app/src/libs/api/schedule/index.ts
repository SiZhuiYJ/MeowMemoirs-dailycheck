/**
 * @file 课表接口请求（小程序端）
 * @description 走主业务 HTTP 实例（`@/libs/http/config`，开发环境自动探测可达后端），
 * 路径前缀 /mm。小程序端只读：只封装列表与详情；写操作只有「导入课表」，分两套：
 * · Excel：选 .xlsx/.xls → Preview 解析预检 → Import 重新上传并保存；
 * · PDF/图片兜底：选 .pdf/.png/.jpg/.jpeg/.webp/.bmp → Ocr/Preview 识别预检
 *   → Import/Confirm 把预检结果（courses 原样回传）保存入库。
 * 预检接口都是 multipart/form-data，共用同一个上传实现；Confirm 走 http 实例 POST JSON。
 */

import { http } from '@/libs/http/config';
import { getAuthToken } from '@/libs/http';
import { resolveApiBase } from '@/libs/http/apiBase';
import type {
  Course,
  SavedTimetable,
  ScheduleDetail,
  ScheduleImportPreview,
  ScheduleSummary,
} from './type';

/**
 * 导入课表的可选参数（契约里的可选项，不传时由后端按文件名 / 导入内容兜底）
 */
export interface ScheduleImportOptions {
  /** 导入后的课表名称（不传时后端用文件内标题 / 文件名） */
  scheduleName?: string;
  /** 学期第一周周一，格式 yyyy-MM-dd */
  startTime?: string;
  /** 学期总周数 */
  weekCount?: number;
}

/**
 * 按预检结果正式保存（OCR / 图片流程用）的请求体。
 * 直接把预检返回的 courses / timetable 原样回传，服务端按同样的规则校验后入库。
 */
export interface ScheduleImportConfirmPayload {
  /** 课表名称（用户输入，留空时后端用「导入的课表」） */
  scheduleName: string;
  /** 开课日期 yyyy-MM-dd（可选） */
  startTime?: string;
  /** 学期总周数（可选） */
  weekCount?: number;
  /** 作息时间表（可选，不传则后端按节次数生成默认值） */
  timetable?: string[];
  /** 课程列表（结构与预检返回的 courses 一致，ID 传 0 即可） */
  courses: Course[];
}

/**
 * 新建 / 修改课表的请求体（POST /mm/Schedule，ScheduleEditDto）。
 * id 省略或 0 = 新建；>0 = 修改该课表的设置（不会动课程）。
 */
export interface ScheduleEditPayload {
  /** 课表 ID（省略或 0 = 新建） */
  id?: number;
  /** 课表名称（1-100 字） */
  scheduleName: string;
  /** 开课日期 yyyy-MM-dd */
  startTime: string;
  /** 学期总周数（1-100） */
  weekCount: number;
  /** 作息时间表（1-30 节，每项 HH:mm-HH:mm） */
  timetable: string[];
  /** 备注（可选） */
  remark?: string;
}

/**
 * 新建 / 修改作息表模板的请求体（POST/PUT /mm/Schedule/Timetables）。
 */
export interface TimetablePayload {
  /** 作息表名称（1-100 字） */
  name: string;
  /** 作息时间（1-30 节，每项 HH:mm-HH:mm） */
  times: string[];
}

/**
 * 从上传接口返回的错误 body 中提取后端文案。
 * 后端错误结构为 `{ message: "..." }`；body 不是 JSON 时回退到通用提示。
 * @param {string} body uni.uploadFile 返回的字符串 body
 * @param {number} statusCode HTTP 状态码
 * @returns {string} 可直接展示给用户的错误文案
 */
function resolveImportErrorMessage(body: string, statusCode: number): string {
  try {
    const data = body ? JSON.parse(body) : null;
    const message = String(data?.message ?? data?.Message ?? data?.title ?? '').trim();
    if (message) return message;
  } catch (e) {
    // body 不是 JSON（网关错误页等）：走下面的兜底文案
  }
  if (statusCode === 401) return '登录状态已过期，请重新登录';
  return '课表导入失败，请稍后重试';
}

/**
 * 课表导入相关的 multipart 上传公共逻辑（Preview / Import 共用）。
 *
 * 这两个接口是 multipart/form-data，不能走 http 实例，因此直接用 uni.uploadFile：
 * · 文件字段名固定为 file；
 * · baseURL 复用 apiBase 的解析结果（开发环境自动探测，生产为固定域名），不写死；
 * · token 复用 http 层注入的登录态（见 getAuthToken），不另读本地存储。
 *
 * @param {string} path 接口路径（以 / 开头，如 /mm/Schedule/Import）
 * @param {string} filePath wx.chooseMessageFile 返回的本地临时文件路径
 * @param {Record<string, string | number>} formData 额外表单字段
 * @param {string} parseErrorMessage 2xx 但 body 不是合法 JSON 时的兜底文案
 * @returns {Promise<T>} 解析后的响应体
 */
async function uploadScheduleFile<T>(
  path: string,
  filePath: string,
  formData: Record<string, string | number>,
  parseErrorMessage: string,
): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new Error('登录状态已过期，请重新登录');

  const baseURL = await resolveApiBase();

  return new Promise<T>((resolve, reject) => {
    uni.uploadFile({
      url: `${baseURL}${path}`,
      filePath,
      // 后端按字段名 file 取文件，不能改名
      name: 'file',
      header: { Authorization: `Bearer ${token}` },
      formData,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(res.data) as T);
          } catch (e) {
            reject(new Error(parseErrorMessage));
          }
          return;
        }
        reject(new Error(resolveImportErrorMessage(res.data, res.statusCode)));
      },
      fail: (err) => {
        const errMsg = err?.errMsg || '';
        reject(new Error(errMsg.includes('timeout') ? '上传超时，请稍后重试' : '网络异常，请检查网络后重试'));
      },
    });
  });
}

/**
 * 把可选的导入参数转成 formData：空值不发送，交给后端用文件名/默认值兜底。
 */
function buildImportFormData(options: ScheduleImportOptions): Record<string, string | number> {
  const formData: Record<string, string | number> = {};
  const scheduleName = (options.scheduleName ?? '').trim();
  if (scheduleName) formData.scheduleName = scheduleName;
  if (options.startTime) formData.startTime = options.startTime;
  if (typeof options.weekCount === 'number' && Number.isFinite(options.weekCount)) {
    formData.weekCount = options.weekCount;
  }
  return formData;
}

/**
 * 课表接口 API 对象
 */
export const ScheduleApi = {
  /**
   * 获取我的课表列表（概要）
   * @returns {Promise<ScheduleSummary[]>} 课表列表
   */
  list(): Promise<ScheduleSummary[]> {
    return http.get<ScheduleSummary[]>('/mm/Schedule').then((res) => res.data);
  },

  /**
   * 获取课表详情（含课程与时间段）
   * @param {number} id 课表 ID
   * @returns {Promise<ScheduleDetail>} 课表详情
   */
  detail(id: number): Promise<ScheduleDetail> {
    return http.get<ScheduleDetail>(`/mm/Schedule/${id}`).then((res) => res.data);
  },

  /**
   * 新建 / 修改课表（POST /mm/Schedule）。
   * id 省略或 0 = 新建；>0 = 修改该课表设置（课程不受影响）。
   * 写接口，显式关闭自动重试，避免网络抖动时重复创建课表。
   * @param {ScheduleEditPayload} payload 课表名 / 开课日期 / 周数 / 作息
   * @returns {Promise<ScheduleDetail>} 保存后的课表详情
   */
  createSchedule(payload: ScheduleEditPayload): Promise<ScheduleDetail> {
    return http
      .post<ScheduleDetail>('/mm/Schedule', payload, { retryCount: 0 })
      .then((res) => res.data);
  },

  /**
   * 新建作息表模板。
   * @param {TimetablePayload} payload 名称 + 作息时间
   * @returns {Promise<SavedTimetable>} 新建的模板
   */
  createTimetable(payload: TimetablePayload): Promise<SavedTimetable> {
    return http
      .post<SavedTimetable>('/mm/Schedule/Timetables', payload, { retryCount: 0 })
      .then((res) => res.data);
  },

  /**
   * 修改作息表模板。
   * @param {number} id 模板 ID（必须 > 0，来自课表的作息不可改）
   * @param {TimetablePayload} payload 名称 + 作息时间
   * @returns {Promise<SavedTimetable>} 修改后的模板
   */
  updateTimetable(id: number, payload: TimetablePayload): Promise<SavedTimetable> {
    return http
      .put<SavedTimetable>(`/mm/Schedule/Timetables/${id}`, payload, { retryCount: 0 })
      .then((res) => res.data);
  },

  /**
   * 删除作息表模板（伪删除）。
   * @param {number} id 模板 ID（必须 > 0，来自课表的作息不可删）
   * @returns {Promise<void>}
   */
  removeTimetable(id: number): Promise<void> {
    return http
      .delete(`/mm/Schedule/Timetables/${id}`, { retryCount: 0 })
      .then(() => undefined);
  },

  /**
   * 获取当前用户历史保存过的作息时间表（去重、最近更新的在前）。
   * 导入预检时文件里没有作息，可让用户直接复用其中一套。
   * @returns {Promise<SavedTimetable[]>} 作息列表（可能为空）
   */
  getTimetables(): Promise<SavedTimetable[]> {
    return http.get<SavedTimetable[]>('/mm/Schedule/Timetables').then((res) => res.data);
  },

  /**
   * 预检导入：只解析文件，不写库，返回识别结果供用户确认。
   * @param {string} filePath wx.chooseMessageFile 返回的本地临时文件路径
   * @returns {Promise<ScheduleImportPreview>} 预检结果（课程 / 周次 / 冲突 / 提示）
   */
  previewFile(filePath: string): Promise<ScheduleImportPreview> {
    return uploadScheduleFile<ScheduleImportPreview>(
      '/mm/Schedule/Import/Preview',
      filePath,
      {},
      '解析结果无法读取，请稍后重试',
    );
  },

  /**
   * OCR 预检导入：识别课表截图 / PDF，只识别不写库，返回识别结果供用户确认。
   * 服务端 OCR 较慢（单页约 5~15 秒），调用方需要更长的 loading 文案并防重复点击。
   * @param {string} filePath wx.chooseMessageFile 返回的本地临时文件路径（pdf / png / jpg / jpeg / webp / bmp）
   * @returns {Promise<ScheduleImportPreview>} 预检结果（课程 / 周次 / 冲突 / 提示）
   */
  previewOcrFile(filePath: string): Promise<ScheduleImportPreview> {
    return uploadScheduleFile<ScheduleImportPreview>(
      '/mm/Schedule/Import/Ocr/Preview',
      filePath,
      {},
      '识别结果无法读取，请稍后重试',
    );
  },

  /**
   * 导入课表：把微信会话里的文件上传给后端解析，成功后返回新建课表的详情。
   * 建议先调 previewFile 让用户确认，再用同一个 tempFilePath 调本方法正式保存。
   *
   * @param {string} filePath wx.chooseMessageFile 返回的本地临时文件路径
   * @param {ScheduleImportOptions} options 课表名 / 学期起始日 / 总周数（均可选）
   * @returns {Promise<ScheduleDetail>} 新导入课表的详情（结构同 GET /mm/Schedule/{id}）
   */
  importFile(filePath: string, options: ScheduleImportOptions = {}): Promise<ScheduleDetail> {
    return uploadScheduleFile<ScheduleDetail>(
      '/mm/Schedule/Import',
      filePath,
      buildImportFormData(options),
      '导入返回数据无法解析，请稍后重试',
    );
  },

  /**
   * 按预检结果正式保存（OCR / 图片流程用）：不再上传文件，直接把预检结果提交入库。
   * 走 http 实例（POST JSON）。这是写接口，显式关闭自动重试——网络抖动重试可能重复创建课表。
   *
   * @param {ScheduleImportConfirmPayload} payload 课表名 + 预检返回的日期/周数/作息/课程
   * @returns {Promise<ScheduleDetail>} 新导入课表的详情（结构同 GET /mm/Schedule/{id}）
   */
  confirmImport(payload: ScheduleImportConfirmPayload): Promise<ScheduleDetail> {
    return http
      .post<ScheduleDetail>('/mm/Schedule/Import/Confirm', payload, { retryCount: 0 })
      .then((res) => res.data);
  },
};

export default ScheduleApi;
