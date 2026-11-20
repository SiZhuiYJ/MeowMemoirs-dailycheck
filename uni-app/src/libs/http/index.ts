/**
 * @file 核心 HTTP 请求工具
 * @description 基于 uni.request 封装，支持：
 * 1. 基础路径配置 (baseURL)
 * 2. 自动 Token 注入与无感刷新 (Authorization)
 * 3. 请求并发控制 (Concurrency Limit)
 * 4. 请求重试机制 (Retry Mechanism)
 * 5. 重复请求拦截/合并 (Request Deduplication)
 * 6. 参数序列化 (Params Serialization)
 */

import { getClientDeviceModel, getClientPlatform, getDeviceId } from '@/utils/systemInfo';

/** 
 * 外部注入的 Auth Store 实例
 * 用于避免循环依赖，在应用初始化时通过 setAuthStore 注入
 */
let authStore: any = null;

/**
 * 设置认证存储实例
 * @param {any} store Pinia 或其他状态管理库的 Auth Store
 */
export const setAuthStore = (store: any) => {
    authStore = store;
};

/**
 * 读取当前注入的 Auth Store 的 access token。
 * 供不走 uni.request 封装的通道（如 uni.uploadFile 上传）手动拼 Authorization 头，
 * 保证 token 来源与本实例注入的登录态一致，而不是在业务代码里另读本地存储。
 * @returns {string | null} access token；未登录 / 未注入时返回 null
 */
export const getAuthToken = (): string | null => {
    const token = authStore?.accessToken;
    return typeof token === 'string' && token ? token : null;
};

/**
 * 单次请求配置项
 */
interface RequestConfig extends UniApp.RequestOptions {
    /** 覆盖全局基础路径 */
    baseURL?: string;
    /** URL 查询参数 */
    params?: any;
    /** 当前请求重试次数 */
    retryCount?: number;
    /** 重试延迟 (ms) */
    retryDelay?: number;
    /** 防抖间隔 (ms) */
    preventDuplicateInterval?: number;
    /**
     * 401 时跳过「自动刷新令牌 + 重放」逻辑，直接把 401 抛给调用方。
     * 适用于「401 代表业务错误」的接口：例如微信绑定接口在微信 code 无效时返回 401，
     * 此时刷新令牌再重放只会消费掉同一个一次性 code，错误信息反而更乱。
     */
    skipAuthRefresh?: boolean;
    /** 内部标记：本次请求已经用刷新后的令牌重放过一次，用于防止 401 无限刷新死循环 */
    _retriedAfterRefresh?: boolean;
}

/**
 * HTTP 实例创建选项
 */
interface CreateHttpOptions {
    /** 并发请求上限 */
    concurrencyLimit?: number;
    /** 全局默认重试次数 */
    retryCount?: number;
    /** 全局默认重试延迟 (ms) */
    retryDelay?: number;
    /** 全局默认防抖间隔 (ms) */
    preventDuplicateInterval?: number;
}

/** 
 * 简化的请求配置，不含 URL
 */
type HttpConfig = Omit<RequestConfig, 'url'>;

/**
 * HTTP 响应结构定义
 */
interface HttpResponse<T = any> {
    /** 业务数据 */
    data: T;
    /** HTTP 状态码 */
    statusCode: number;
    /** 响应头 */
    header: any;
    /** Cookie 列表 */
    cookies: string[];
    /** 错误消息 */
    errMsg: string;
}

/**
 * 创建 HTTP 请求实例
 * @param {string | (() => string | Promise<string>)} url 基础路径（或返回基础路径的解析器）
 * @param {CreateHttpOptions} globalOptions 全局配置
 */
const createHttp = (
    url: string | (() => string | Promise<string>),
    globalOptions: CreateHttpOptions = {},
) => {
    /** 解析当前基础路径：开发环境可由解析器自动选择可达后端 */
    const resolveBaseURL = async (override?: string): Promise<string> => {
        if (override) return override;
        return typeof url === 'function' ? await url() : url;
    };
    const {
        concurrencyLimit = Infinity,
        retryCount: globalRetryCount = 0,
        retryDelay: globalRetryDelay = 1000,
        preventDuplicateInterval: globalDuplicateInterval = 0,
    } = globalOptions;

    /** 当前活跃请求数 */
    let activeRequests = 0;
    /** 并发等待队列 */
    const queue: Array<() => void> = [];
    /** 正在执行中的请求映射 (用于合并相同请求) */
    const inFlightRequests = new Map<string, Promise<HttpResponse<any>>>();
    /** 上次请求完成时间映射 (用于防抖) */
    const lastRequestTimes = new Map<string, number>();

    /** 刷新令牌的「单飞」Promise：并发 401 只刷新一次，避免同一个 refreshToken 并发请求把会话挤掉 */
    let refreshSessionPromise: Promise<void> | null = null;

    /**
     * 用 refreshToken 换取新会话（全局单飞）。
     * 失败时抛出错误，由调用方统一清理登录态，避免每个请求各自 reLaunch。
     */
    const refreshAccessToken = (): Promise<void> => {
        if (!refreshSessionPromise) {
            const auth = authStore;
            refreshSessionPromise = (async () => {
                const refreshBaseURL = await resolveBaseURL();
                const refreshRes = await uni.request({
                    url: refreshBaseURL + '/mm/Auth/refresh',
                    method: 'POST',
                    data: { refreshToken: auth.refreshToken },
                });
                if (refreshRes.statusCode !== 200) {
                    throw refreshRes;
                }
                auth.setSession(refreshRes.data as any);
            })().finally(() => {
                refreshSessionPromise = null;
            });
        }
        return refreshSessionPromise;
    };

    /**
     * 生成请求唯一标识 (指纹)
     * @param {RequestConfig} options 请求配置
     * @returns {string} 指纹字符串
     */
    const getRequestFingerprint = (options: RequestConfig) => {
        const { method, url, data, params } = options;
        return `${method}:${url}:${JSON.stringify(data)}:${JSON.stringify(params)}`;
    };

    /**
     * 处理并发队列中的下一个请求
     */
    const processQueue = () => {
        if (queue.length > 0 && activeRequests < concurrencyLimit) {
            const next = queue.shift();
            if (next) {
                activeRequests++;
                next();
            }
        }
    };

    /**
     * 核心请求执行逻辑 (处理 URL 拼接、Token 注入、状态码响应、Token 刷新)
     * @template T 预期响应数据类型
     * @param {RequestConfig} options 请求配置
     * @returns {Promise<HttpResponse<T>>}
     */
    const coreRequest = async <T = any>(options: RequestConfig): Promise<HttpResponse<T>> => {
        const auth = authStore;

        let url = options.url;
        // 拼接基础路径（开发环境这里会等自动探测完成，生产环境直接返回域名）
        const resolvedBaseURL = await resolveBaseURL(options.baseURL);
        if (!url.startsWith('http')) {
            url = resolvedBaseURL + url;
        }

        // 序列化 URL 参数
        if (options.params) {
            const query = Object.keys(options.params)
                .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(options.params[k])}`)
                .join('&');
            url += (url.includes('?') ? '&' : '?') + query;
        }

        // 注入认证头
        const headers = options.header || {};
        if (auth && auth.accessToken) {
            headers['Authorization'] = `Bearer ${auth.accessToken}`;
        }

        // 上报客户端平台 / 机型 / 设备 ID：后端登录记录按设备维度归并（取不到就跳过，绝不影响请求）
        try {
            const clientPlatform = getClientPlatform();
            if (clientPlatform) headers['X-Client-Platform'] = clientPlatform;
            const clientDevice = getClientDeviceModel();
            if (clientDevice) headers['X-Client-Device'] = clientDevice;
            const deviceId = getDeviceId();
            // 调用方显式传了 X-Device-Id 时保持原值，不覆盖
            if (deviceId && !headers['X-Device-Id']) headers['X-Device-Id'] = deviceId;
        } catch (e) {
            // 系统信息不可用时忽略：后端会用 User-Agent 兜底
        }

        return new Promise((resolve, reject) => {
            uni.request({
                ...options,
                url,
                header: headers,
                success: async (res) => {
                    const response = res as HttpResponse<T>;
                    // 成功处理 (2xx)
                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        resolve(response);
                    } 
                    // 认证失效处理 (401)
                    else if (response.statusCode === 401) {
                        // 登录或注册接口返回 401 表示账号密码错误，不刷新、不重试
                        if (options.url?.includes('/Auth/login') || options.url?.includes('/Auth/register')) {
                            reject(response);
                            return;
                        }

                        if (!auth) {
                            reject(response);
                            return;
                        }

                        // 刷新接口自己返回 401，说明 Refresh Token 也失效了
                        if (options.url?.includes('/Auth/refresh')) {
                            auth.clear();
                            uni.reLaunch({ url: '/pages/auth/index' });
                            reject(response);
                            return;
                        }

                        // 调用方声明该接口的 401 是业务错误（如微信绑定 code 失效），直接抛给调用方
                        if (options.skipAuthRefresh) {
                            reject(response);
                            return;
                        }

                        // 没有 refreshToken 无法续期：清理登录态并回登录页（保持原有行为，避免接口静默 401）
                        if (!auth.refreshToken) {
                            auth.clear();
                            uni.reLaunch({ url: '/pages/auth/index' });
                            reject(response);
                            return;
                        }

                        // 本次请求已经用刷新后的新令牌重放过一次仍是 401：不再刷新，直接抛给调用方。
                        // 缺少这条会形成 401 → 刷新 → 重放 → 401 的无限循环（表现为「点了没反应」），
                        // 并反复消费微信 code 这类一次性凭证。
                        if (options._retriedAfterRefresh) {
                            reject(response);
                            return;
                        }

                        options._retriedAfterRefresh = true;
                        try {
                            // 并发 401 共用同一次刷新（单飞），避免把彼此挤下线
                            await refreshAccessToken();
                            resolve(await coreRequest<T>(options));
                        } catch {
                            // 刷新失败视为登录态失效：清理并回登录页；已无令牌时避免重复跳转
                            const hadToken = !!auth.accessToken;
                            auth.clear();
                            if (hadToken) {
                                uni.reLaunch({ url: '/pages/auth/index' });
                            }
                            reject(response);
                        }
                    } else {
                        reject(response);
                    }
                },
                fail: (err) => {
                    reject(err);
                },
            });
        });
    };

    /**
     * 带策略的请求方法 (并发控制、重试、防抖)
     * @template T 预期响应数据类型
     * @param {RequestConfig} options 请求配置
     */
    const request = async <T = any>(options: RequestConfig): Promise<HttpResponse<T>> => {
        const fingerprint = getRequestFingerprint(options);
        const duplicateInterval = options.preventDuplicateInterval ?? globalDuplicateInterval;

        // 1. 请求合并与重复请求拦截
        if (duplicateInterval > 0) {
            // 合并正在进行中的相同请求 (只要在 duplicateInterval 开启的情况下，同一时间只允许一个相同请求在飞)
            if (inFlightRequests.has(fingerprint)) {
                return inFlightRequests.get(fingerprint) as Promise<HttpResponse<T>>;
            }

            // 拦截过快触发的重复请求 (主要针对非 GET 的误触/双击)
            // 如果请求已经完成，但处于极短的冷却期内 (如 100ms)，则拦截以防止硬件层面的重复触发
            const lastTime = lastRequestTimes.get(fingerprint);
            const now = Date.now();
            if (lastTime && now - lastTime < 100) {
                if (options.method !== 'GET') {
                    return Promise.reject({ errMsg: 'Duplicate request', isDuplicate: true });
                }
            }
        }

        const retryCount = options.retryCount ?? globalRetryCount;
        const retryDelay = options.retryDelay ?? globalRetryDelay;

        /**
         * 尝试执行请求 (包含并发控制和重试逻辑)
         */
        const attemptRequest = async (currentRetry: number): Promise<HttpResponse<T>> => {
            // 2. 并发控制：若超出限制则进入队列等待
            if (activeRequests >= concurrencyLimit) {
                await new Promise<void>((resolve) => {
                    queue.push(resolve);
                });
            } else {
                activeRequests++;
            }

            try {
                const response = await coreRequest<T>(options);
                return response;
            } catch (error: any) {
                // 401 由 coreRequest 内部处理刷新逻辑，这里不重试。
                // 其它 4xx 是业务/参数错误（409 冲突、400 参数、404 不存在等），重试只会拿到同样结果；
                // 对「微信 code 只能消费一次」这类一次性凭证接口，重试还会把 code 用废、把 409 变成 401
                // （绑定微信冲突时就出现过：第一次 409，http 层自动重试同一 code → 微信返回 invalid code → 401）。
                // 因此只有网络错误与 5xx 才做普通重试。
                const statusCode = error?.statusCode;
                const isClientError =
                    typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
                if (statusCode === 401 || isClientError || currentRetry >= retryCount) {
                    throw error;
                }
                // 指数补偿或简单延迟重试
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
                return attemptRequest(currentRetry + 1);
            } finally {
                activeRequests--;
                processQueue();
            }
        };

        const requestPromise = attemptRequest(0);

        // 管理请求指纹映射
        if (duplicateInterval > 0) {
            inFlightRequests.set(fingerprint, requestPromise);
            lastRequestTimes.set(fingerprint, Date.now());

            requestPromise.finally(() => {
                inFlightRequests.delete(fingerprint);
                // 延迟清理防抖记录
                setTimeout(() => {
                    lastRequestTimes.delete(fingerprint);
                }, duplicateInterval);
            });
        }

        return requestPromise;
    };

    return {
        /** 发起 GET 请求 */
        get: <T = any>(url: string, config?: HttpConfig) => request<T>({ ...config, url, method: 'GET' } as RequestConfig),
        /** 发起 POST 请求 */
        post: <T = any>(url: string, data?: any, config?: HttpConfig) => request<T>({ ...config, url, method: 'POST', data } as RequestConfig),
        /** 发起 PUT 请求 */
        put: <T = any>(url: string, data?: any, config?: HttpConfig) => request<T>({ ...config, url, method: 'PUT', data } as RequestConfig),
        /** 发起 DELETE 请求 */
        delete: <T = any>(url: string, config?: HttpConfig) => request<T>({ ...config, url, method: 'DELETE' } as RequestConfig),
    };
};

export default createHttp;
