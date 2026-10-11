// config.ts
import type { AxiosRequestConfig } from "axios";
export interface HttpConfig {
    maxConcurrentRequests: number;          // 最大并发请求数
    throttleEnabled: boolean;                // 是否启用请求节流
    throttleKeyGenerator?: (config: AxiosRequestConfig) => string; // 自定义节流 key 生成函数
}

// 默认配置
export const httpConfig: HttpConfig = {
    // 5 太低：进入聊天页/切换会话时会同时发出「会话详情 + 消息列表 + 批量已读状态」等请求，
    // 队列被后台请求占满后，用户主动发送的消息只能排在队尾，表现为「发消息要等半天」。
    maxConcurrentRequests: 12,
    throttleEnabled: true,
    throttleKeyGenerator: (config) => {
        // 默认 key 生成规则：method + url + 排序后的 params/data
        const method = config.method || 'get';
        const url = config.url || '';
        const params = config.params ? JSON.stringify(sortObject(config.params)) : '';
        const data = config.data ? JSON.stringify(sortObject(config.data)) : '';
        return `${method}:${url}:${params}:${data}`;
    }
};

// 辅助函数：递归排序对象属性，保证序列化结果稳定
function sortObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortObject);
    const sortedKeys = Object.keys(obj).sort();
    const result: any = {};
    for (const key of sortedKeys) {
        result[key] = sortObject(obj[key]);
    }
    return result;
}
