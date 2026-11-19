/**
 * @file 课表接口请求（小程序端）
 * @description 走主业务 HTTP 实例（`@/libs/http/config`，开发环境自动探测可达后端），
 * 路径前缀 /mm。小程序端只读：只封装列表与详情，不提供课程/课表的增删改。
 */

import { http } from '@/libs/http/config';
import type { ScheduleDetail, ScheduleSummary } from './type';

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
};

export default ScheduleApi;
