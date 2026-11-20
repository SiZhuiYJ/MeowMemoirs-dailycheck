/**
 * @file 课表接口请求（小程序端）
 * @description 走主业务 HTTP 实例（`@/libs/http/config`，开发环境自动探测可达后端），
 * 路径前缀 /mm。小程序端只读：只封装列表与详情；唯一的写操作是「导入课表」——
 * 从微信会话选 Excel（.xlsx/.xls），用 uni.uploadFile 以 multipart 上传，服务端负责解析并创建课表。
 */

import { http } from '@/libs/http/config';
import { getAuthToken } from '@/libs/http';
import { resolveApiBase } from '@/libs/http/apiBase';
import type { ScheduleDetail, ScheduleSummary } from './type';

/**
 * 导入课表的可选参数（契约里的可选项，不传时由后端按文件名 / 导入内容兜底）
 */
export interface ScheduleImportOptions {
  /** 导入后的课表名称（不传时后端用文件名） */
  scheduleName?: string;
  /** 学期第一周周一，格式 yyyy-MM-dd */
  startTime?: string;
  /** 学期总周数 */
  weekCount?: number;
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
   * 导入课表：把微信会话里的文件上传给后端解析，成功后返回新建课表的详情。
   *
   * 该接口是 multipart/form-data，不能走 http 实例，因此直接用 uni.uploadFile：
   * · 文件字段名固定为 file；
   * · baseURL 复用 apiBase 的解析结果（开发环境自动探测，生产为固定域名），不写死；
   * · token 复用 http 层注入的登录态（见 getAuthToken），不另读本地存储。
   *
   * @param {string} filePath wx.chooseMessageFile 返回的本地临时文件路径
   * @param {ScheduleImportOptions} options 课表名 / 学期起始日 / 总周数（均可选）
   * @returns {Promise<ScheduleDetail>} 新导入课表的详情（结构同 GET /mm/Schedule/{id}）
   */
  async importFile(filePath: string, options: ScheduleImportOptions = {}): Promise<ScheduleDetail> {
    const token = getAuthToken();
    if (!token) throw new Error('登录状态已过期，请重新登录');

    const baseURL = await resolveApiBase();

    // 可选字段按契约放进 formData；空值不发送，交给后端用文件名/默认值兜底
    const formData: Record<string, string | number> = {};
    const scheduleName = (options.scheduleName ?? '').trim();
    if (scheduleName) formData.scheduleName = scheduleName;
    if (options.startTime) formData.startTime = options.startTime;
    if (typeof options.weekCount === 'number' && Number.isFinite(options.weekCount)) {
      formData.weekCount = options.weekCount;
    }

    return new Promise<ScheduleDetail>((resolve, reject) => {
      uni.uploadFile({
        url: `${baseURL}/mm/Schedule/Import`,
        filePath,
        // 后端按字段名 file 取文件，不能改名
        name: 'file',
        header: { Authorization: `Bearer ${token}` },
        formData,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(res.data) as ScheduleDetail);
            } catch (e) {
              reject(new Error('导入返回数据无法解析，请稍后重试'));
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
  },
};

export default ScheduleApi;
