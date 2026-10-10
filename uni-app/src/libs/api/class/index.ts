/**
 * @file 课程相关接口请求
 * @description 封装课程列表获取相关的后端接口
 */

import type { ResponseData } from "@/libs/http/type";
import type { ClassDto } from "@/libs/api/class/type";
import { http } from '@/libs/class/config';

/**
 * 课程接口 API 对象
 */
export const ClassApi = {
    /**
     * 获取所有课程列表
     * @returns {Promise<ResponseData<ClassDto[]>>} 课程列表响应数据
     */
    PostClassList(): Promise<ResponseData<ClassDto[]>> {
        return http.post('/Classes/PostClassesList').then(res => res.data as ResponseData<ClassDto[]>);
    },

    /**
     * 根据用户 ID 获取课程列表
     * @param {number} userID - 用户唯一标识 ID
     * @returns {Promise<ResponseData<ClassDto[]>>} 该用户的课程列表响应数据
     */
    PostClassesByID(userID: number): Promise<ResponseData<ClassDto[]>> {
        return http.post('/Classes/PostClassesListByID', null, { params: { userId: userID } })
            .then(res => res.data as ResponseData<ClassDto[]>);
    }
};
