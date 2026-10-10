/**
 * @file HTTP 通用类型定义
 * @description 规范后端返回的数据结构
 */

/**
 * 统一后端返回格式
 * @template T 实际业务数据的类型
 */
export interface ResponseData<T = any> {
    /** 状态码，通常 200 为成功 */
    code: number;
    /** 业务数据 */
    data: T;
    /** 提示消息 */
    message: string;
}
