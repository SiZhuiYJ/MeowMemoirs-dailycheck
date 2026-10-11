import type {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import axios, { AxiosHeaders } from "axios";
import type { AuthData } from "@/features/auth/types";
import { useAuthStore } from "@/features/auth/stores";
import { notifyWarning } from "@/utils/notification";
import router from "@/routers/index";
import { httpConfig as defaultHttpConfig, type HttpConfig } from "./config";
import type { ApiResponse, HttpRequestConfig } from "./type";
import { telemetry } from "@/libs/telemetry";

/**
 * HTTP 客户端封装：
 * 1) 统一 token 注入；
 * 2) 统一响应解包与错误处理；
 * 3) 并发请求上限控制；
 * 4) 相同请求节流复用；
 * 5) 401 自动刷新 token（带并发锁）。
 */
class MM {
  private instance: AxiosInstance;

  /** 最大并发请求数。 */
  private maxConcurrent: number;

  /** 当前进行中的请求数。 */
  private currentConcurrent = 0;

  /** 请求排队队列（超过并发上限时入队）。 */
  private requestQueue: Array<{
    config: HttpRequestConfig;
    resolve: (value: AxiosResponse | PromiseLike<AxiosResponse>) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  /** 是否开启相同请求复用。 */
  private throttleEnabled: boolean;

  /** 进行中的“相同请求”映射，避免短时间重复发起。 */
  private throttleMap = new Map<string, Promise<AxiosResponse>>();

  /** 节流 key 生成器。 */
  private throttleKeyGenerator: (config: AxiosRequestConfig) => string;

  /**
   * token 刷新中的 Promise 锁：
   * - 有值表示正在刷新；
   * - 其他 401 请求等待该 Promise，避免并发刷新风暴。
   */
  private refreshPromise: Promise<void> | null = null;

  /** 不需要携带 accessToken 的公开接口。 */
  private anonymousAuthPathRegex = /\/mm\/Auth\/(refresh|login(?:-account|-email-code)?|register|email-code|validate-account)$/i;

  constructor(axiosConfig: AxiosRequestConfig, httpConfig?: Partial<HttpConfig>) {
    this.instance = axios.create(axiosConfig);
    const finalConfig = { ...defaultHttpConfig, ...httpConfig };

    this.maxConcurrent = finalConfig.maxConcurrentRequests;
    this.throttleEnabled = finalConfig.throttleEnabled;
    this.throttleKeyGenerator = finalConfig.throttleKeyGenerator!;

    this.interceptors();
  }

  /** 注册请求与响应拦截器。 */
  private interceptors() {
    this.instance.interceptors.request.use(
      (config) => this.handleRequest(config),
      (error) => this.handleRequestError(error),
    );

    this.instance.interceptors.response.use(
      (response) => this.handleResponse(response),
      (error) => this.handleResponseError(error),
    );
  }

  /**
   * 请求拦截：注入 accessToken。
   */
  private async handleRequest(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
    const auth = useAuthStore();
    config.headers = this.normalizeHeaders(config.headers);
    if (auth.accessToken && !config.skipAuth) {
      config.headers.set("Authorization", `Bearer ${auth.accessToken}`);
    }
    return Promise.resolve(config);
  }

  private async handleRequestError(error: AxiosError): Promise<never> {
    telemetry.captureError("http-request-error", error, {
      url: error.config?.url,
      method: error.config?.method,
    });
    return Promise.reject(error);
  }

  /**
   * 响应拦截：兼容 plain JSON 与后端包裹结构 ApiResponse<T>。
   * 如需拿原始 AxiosResponse，请传 originalResponse: true。
   */
  private async handleResponse<T>(response: AxiosResponse<T | ApiResponse<T>>): Promise<AxiosResponse<T>> {
    const config = response.config as HttpRequestConfig;

    if (config.originalResponse) {
      return Promise.resolve(response as AxiosResponse<T>);
    }

    const payload = response.data;
    if (response.status === 204 || payload === null || payload === undefined || payload === "") {
      return Promise.resolve(response as AxiosResponse<T>);
    }

    if (this.isApiResponse<T>(payload)) {
      const isSuccess = payload.success === true || payload.code === 0 || payload.code === 200;
      if (!isSuccess) {
        const message = payload.message || "请求失败";
        telemetry.track("http", "http-business-error", {
          url: config.url,
          method: config.method,
          code: payload.code,
          message,
        }, "error");
        if (config.showError !== false) {
          notifyWarning(message);
        }
        return Promise.reject(new Error(message));
      }

      response.data = payload.data as T;
    }

    return Promise.resolve(response as AxiosResponse<T>);
  }

  private isApiResponse<T>(payload: unknown): payload is ApiResponse<T> {
    if (!payload || typeof payload !== "object") {
      return false;
    }

    const candidate = payload as Partial<ApiResponse<T>>;
    return typeof candidate.code === "number" && "data" in candidate && "message" in candidate;
  }

  private getResponseErrorMessage(error: AxiosError) {
    const data = error.response?.data;
    if (typeof data === "string" && data.trim()) {
      return data;
    }

    if (data && typeof data === "object") {
      const payload = data as {
        message?: string;
        title?: string;
        error?: string;
        errors?: Record<string, string[]>;
      };

      if (payload.message) return payload.message;
      if (payload.title) return payload.title;
      if (payload.error) return payload.error;

      const firstValidationError = payload.errors
        ? Object.values(payload.errors).flat().find(Boolean)
        : undefined;
      if (firstValidationError) return firstValidationError;
    }

    return error.message || "请求失败";
  }

  /**
   * 响应错误拦截：
   * - 401 自动刷新 token 并重放原请求；
   * - 支持 5xx 退避重试；
   * - 其余错误透传。
   */
  private async handleResponseError(error: AxiosError) {
    const auth = useAuthStore();
    const status = error.response?.status;
    const config = error.config as HttpRequestConfig | undefined;

    if (!config) {
      return Promise.reject(error);
    }

    // 刷新接口自己失败时，直接判定登录过期，避免死循环。
    const isRefreshRequest = config.url?.includes("/mm/Auth/refresh");
    if (isRefreshRequest && status === 401) {
      // 登出前最后一搏：若其它标签页/窗口刚拿到新会话，直接复用，不要把人踢出去
      if (auth.adoptSessionFromStorage()) {
        telemetry.track("auth", "auth-refresh-recovered", {
          reason: "刷新被拒但存在更新的会话，已复用",
        }, "warn");
        config.headers = this.normalizeHeaders(config.headers);
        config.headers.set("Authorization", `Bearer ${auth.accessToken}`);
        return this.instance(config);
      }

      telemetry.track("auth", "auth-refresh-rejected", {
        url: config.url,
        status,
        serverMessage: this.getResponseErrorMessage(error),
      }, "error");
      this.clearAuthAndRedirect(`刷新令牌被服务端拒绝(${status})`);
      return Promise.reject({ ...error, hasClearedAuth: true });
    }

    if (status === 401) {
      // 记录是「哪个请求」触发的 401：这是判断「谁把令牌踢掉」的关键线索
      telemetry.track("auth", "auth-401", {
        url: config.url,
        method: config.method,
        hadRefreshToken: Boolean(auth.refreshToken),
        alreadyRetried: Boolean(config._retry),
        skipAuthRefresh: Boolean(config.skipAuthRefresh),
        serverMessage: this.getResponseErrorMessage(error),
        accessTokenTail: auth.accessToken ? String(auth.accessToken).slice(-12) : null,
      }, "warn");
    }

    if (status === 401 && auth.refreshToken && !config._retry && !config.skipAuthRefresh) {
      config._retry = true;
      try {
        await this.refreshTokenWithLock();
        config.headers = this.normalizeHeaders(config.headers);
        config.headers.set("Authorization", `Bearer ${auth.accessToken}`);
        return this.instance(config);
      } catch (refreshError) {
        const shouldLogout = this.shouldForceLogout(refreshError);
        telemetry.track("auth", "auth-refresh-failed", {
          url: config.url,
          status: (refreshError as AxiosError)?.response?.status,
          message: this.getResponseErrorMessage(refreshError as AxiosError),
          willForceLogout: shouldLogout,
        }, "error");
        if (shouldLogout) {
          this.clearAuthAndRedirect(
            `刷新令牌失败(status=${(refreshError as AxiosError)?.response?.status ?? "无响应"})，触发请求：${config.url}`,
          );
        } else if (config.showError !== false) {
          notifyWarning("网络异常，登录状态刷新失败，请稍后重试");
        }
        return Promise.reject(refreshError);
      }
    }

    // 仅针对 5xx 执行重试（指数退避）。
    const retryCount = config.retryCount ?? 0;
    config._retryCount = config._retryCount ?? 0;
    if (retryCount > 0 && config._retryCount < retryCount && (status ?? 0) >= 500) {
      config._retryCount += 1;
      await this.sleep(500 * config._retryCount);
      return this.instance(config);
    }

    if (config.showError !== false) {
      notifyWarning(this.getResponseErrorMessage(error));
    }

    if (status && status >= 400 && status !== 401) {
      telemetry.track("http", "http-error", {
        url: config.url,
        method: config.method,
        status,
        message: this.getResponseErrorMessage(error),
      }, status >= 500 ? "error" : "warn");
    }

    return Promise.reject(error);
  }

  /**
   * 刷新 token 的并发锁实现。
   */
  private async refreshTokenWithLock() {
    if (!this.refreshPromise) {
      const auth = useAuthStore();
      const startedAt = Date.now();

      // 先看其他标签页是否已经刷新过：
      // 后端每个用户只保留一份令牌，重复刷新会把对方挤下线，这里能复用就复用。
      if (auth.adoptSessionFromStorage()) {
        telemetry.track("auth", "auth-refresh-skipped", {
          reason: "其他标签页已刷新，直接复用其令牌",
        }, "info");
        return;
      }

      telemetry.track("auth", "auth-refresh-start", {
        refreshTokenTail: auth.refreshToken ? String(auth.refreshToken).slice(-12) : null,
        reason: "收到 401 后自动刷新",
      }, "info");

      this.refreshPromise = this.post<AuthData>("/mm/Auth/refresh", {
        refreshToken: auth.refreshToken,
      }, {
        skipAuth: true,
        skipAuthRefresh: true,
      })
        .then((refreshResponse) => {
          auth.setSession(refreshResponse.data);
          telemetry.track("auth", "auth-refresh-success", {
            inMs: Date.now() - startedAt,
            newAccessTokenTail: String(refreshResponse.data?.token ?? "").slice(-12),
            expiresAt: refreshResponse.data?.accessTokenExpiresAt,
          }, "info");
        })
        .catch((error) => {
          telemetry.track("auth", "auth-refresh-http-failed", {
            inMs: Date.now() - startedAt,
            status: (error as AxiosError)?.response?.status,
            message: (error as AxiosError)?.message,
          }, "error");
          throw error;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    return this.refreshPromise;
  }

  /**
   * 对外暴露的「单飞」刷新：所有刷新入口（自动续期定时器 / 401 兜底）
   * 共用同一把锁，避免同一时刻发出两次刷新。
   */
  async refreshSession(): Promise<void> {
    await this.refreshTokenWithLock();
  }

  /** 登录状态失效后统一处理。 */
  private clearAuthAndRedirect(reason = "未知") {
    const auth = useAuthStore();
    telemetry.track("auth", "auth-force-logout", {
      reason,
      route: router.currentRoute.value.fullPath,
      accessTokenTail: auth.accessToken ? String(auth.accessToken).slice(-12) : null,
      refreshTokenTail: auth.refreshToken ? String(auth.refreshToken).slice(-12) : null,
    }, "error");
    // 强制登出前先落盘并上报，避免跳转/刷新把现场丢掉
    telemetry.flush(true);
    auth.clear();
    notifyWarning("登录过期，请重新登录");
    if (router.currentRoute.value.path !== "/login") {
      router.push("/login");
    }
  }

  private shouldForceLogout(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    const status = error.response?.status;
    return status === 401 || status === 403;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 请求统一入口：
   * - 若开启节流，短时间内相同请求直接复用 Promise；
   * - 实际发送前经过并发队列控制。
   */
  private async requestWithControl<T>(config: HttpRequestConfig): Promise<AxiosResponse<T>> {
    let throttleKey: string | undefined;

    const allowDuplicate = (config as HttpRequestConfig).allowDuplicate === true;
    if (this.throttleEnabled && !allowDuplicate) {
      throttleKey = this.throttleKeyGenerator(config);
      const existingPromise = this.throttleMap.get(throttleKey);
      if (existingPromise) {
        return existingPromise as Promise<AxiosResponse<T>>;
      }
    }

    const requestPromise = this.executeRequest<T>(config);

    if (throttleKey) {
      this.throttleMap.set(throttleKey, requestPromise as Promise<AxiosResponse>);
      requestPromise
        .finally(() => {
          this.throttleMap.delete(throttleKey);
        })
        .catch(() => {
          // 仅用于清理节流映射，不吞掉业务层错误。
        });
    }

    return requestPromise;
  }

  /** 执行请求（并发槽位不足则入队等待）。 */
  private executeRequest<T>(config: HttpRequestConfig): Promise<AxiosResponse<T>> {
    return new Promise((resolve, reject) => {
      const runRequest = () => {
        this.currentConcurrent += 1;
        this.instance
          .request(config)
          .then((response) => {
            this.currentConcurrent -= 1;
            resolve(response as AxiosResponse<T>);
            this.next();
          })
          .catch((error) => {
            this.currentConcurrent -= 1;
            reject(error);
            this.next();
          });
      };

      if (this.currentConcurrent < this.maxConcurrent) {
        runRequest();
      } else if (config.priority) {
        // 交互请求（发送消息等）插队，避免排在后台批量请求后面
        this.requestQueue.unshift({ config, resolve, reject });
      } else {
        this.requestQueue.push({ config, resolve, reject });
      }
    });
  }

  /** 从队列中取下一个请求执行。 */
  private next() {
    if (this.requestQueue.length === 0 || this.currentConcurrent >= this.maxConcurrent) {
      return;
    }

    const nextRequest = this.requestQueue.shift();
    if (!nextRequest) return;

    this.currentConcurrent += 1;
    this.instance
      .request(nextRequest.config)
      .then((response) => {
        this.currentConcurrent -= 1;
        nextRequest.resolve(response);
        this.next();
      })
      .catch((error) => {
        this.currentConcurrent -= 1;
        nextRequest.reject(error);
        this.next();
      });
  }

  private normalizeHeaders(headers?: HttpRequestConfig["headers"] | InternalAxiosRequestConfig["headers"]) {
    return AxiosHeaders.from(
      (headers ?? {}) as Parameters<typeof AxiosHeaders.from>[0],
    );
  }

  private withRequestDefaults(config: HttpRequestConfig, method: string, url: string): HttpRequestConfig {
    return {
      ...config,
      method,
      url,
      headers: this.normalizeHeaders(config.headers),
      skipAuth: config.skipAuth ?? this.anonymousAuthPathRegex.test(url),
    };
  }

  private isRequestConfig(value: unknown): value is HttpRequestConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const configKeys = new Set([
      "url",
      "method",
      "baseURL",
      "headers",
      "params",
      "data",
      "timeout",
      "withCredentials",
      "responseType",
      "signal",
      "paramsSerializer",
      "onUploadProgress",
      "onDownloadProgress",
      "validateStatus",
      "showError",
      "originalResponse",
      "retryCount",
      "allowDuplicate",
      "skipAuth",
      "skipAuthRefresh",
      "priority",
    ]);

    return Object.keys(value).some((key) => configKeys.has(key));
  }

  /** GET 请求。 */
  async get<T>(url: string, paramsOrConfig?: object, config: HttpRequestConfig = {}) {
    const finalConfig = this.isRequestConfig(paramsOrConfig)
      ? paramsOrConfig
      : { ...config, params: paramsOrConfig };

    return this.requestWithControl<T>(
      this.withRequestDefaults(finalConfig, "GET", url),
    );
  }

  /** POST 请求。 */
  async post<T>(url: string, data?: unknown, config: HttpRequestConfig = {}) {
    return this.requestWithControl<T>(
      this.withRequestDefaults({ ...config, data }, "POST", url),
    );
  }

  /** PUT 请求。 */
  async put<T>(url: string, data?: unknown, config: HttpRequestConfig = {}) {
    return this.requestWithControl<T>(
      this.withRequestDefaults({ ...config, data }, "PUT", url),
    );
  }

  /** DELETE 请求。 */
  async delete<T>(url: string, config: HttpRequestConfig = {}) {
    return this.requestWithControl<T>(
      this.withRequestDefaults(config, "DELETE", url),
    );
  }

  /** 文件下载请求（blob）。 */
  async download<T>(url: string, data?: unknown, config: HttpRequestConfig = {}) {
    return this.requestWithControl<T>(
      this.withRequestDefaults({ ...config, data, responseType: "blob" }, "POST", url),
    );
  }

  /** 获取图片二进制（arraybuffer）。 */
  async getImage<T>(url: string, config: HttpRequestConfig = {}) {
    return this.requestWithControl<T>(
      this.withRequestDefaults({ ...config, responseType: "arraybuffer" }, "GET", url),
    );
  }

  /** 文件上传请求（multipart/form-data）。 */
  async upload<T>(url: string, formData?: BodyInit | object, config: HttpRequestConfig = {}) {
    return this.requestWithControl<T>(
      this.withRequestDefaults({ ...config, data: formData }, "POST", url),
    );
  }
}

export default MM;
