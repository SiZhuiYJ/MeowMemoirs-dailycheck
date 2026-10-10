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
 * @param {string} url 基础路径 baseURL
 * @param {CreateHttpOptions} globalOptions 全局配置
 */
const createHttp = (url: string, globalOptions: CreateHttpOptions = {}) => {
    const baseURL = url;
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
        // 拼接基础路径
        if (options.baseURL !== undefined) {
            if (!url.startsWith('http')) {
                url = (options.baseURL || baseURL) + url;
            }
        } else {
            if (!url.startsWith('http')) {
                url = baseURL + url;
            }
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
                        // 登录或注册接口返回 401 不重试
                        if (options.url?.includes('/Auth/login') || options.url?.includes('/Auth/register')) {
                            reject(response);
                            return;
                        }

                        if (!auth) {
                            reject(response);
                            return;
                        }

                        // 无感刷新 Token 逻辑
                        if (auth.refreshToken) {
                            try {
                                // 刷新接口本身返回 401，说明 Refresh Token 也失效了
                                if (options.url?.includes('/Auth/refresh')) {
                                    auth.clear();
                                    uni.reLaunch({ url: '/pages/auth/index' });
                                    reject(response);
                                    return;
                                }

                                const refreshRes = await uni.request({
                                    url: baseURL + '/mm/Auth/refresh',
                                    method: 'POST',
                                    data: { refreshToken: auth.refreshToken },
                                });

                                if (refreshRes.statusCode === 200) {
                                    auth.setSession(refreshRes.data as any);
                                    // 刷新成功后重试原请求
                                    const retryRes = await coreRequest<T>(options);
                                    resolve(retryRes);
                                } else {
                                    auth.clear();
                                    uni.reLaunch({ url: '/pages/auth/index' });
                                    reject(response);
                                }
                            } catch (e) {
                                auth.clear();
                                uni.reLaunch({ url: '/pages/auth/index' });
                                reject(e);
                            }
                        } else {
                            auth.clear();
                            uni.reLaunch({ url: '/pages/auth/index' });
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
                // 401 错误不进行普通重试，由 coreRequest 内部处理刷新逻辑
                if (error.statusCode === 401 || currentRetry >= retryCount) {
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
