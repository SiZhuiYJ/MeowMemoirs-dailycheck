import { notifyError } from "@/utils/notification";

export function useErrorHandler() {
  function resolveErrorMessage(error: any, fallback: string): string {
    const isTimeout = error?.code === "ECONNABORTED";
    const isNetworkError =
      error?.message === "Network Error" || !error?.response;

    if (isTimeout) {
      return "请求超时，请检查网络后重试";
    }
    if (isNetworkError) {
      return "无法连接服务器，请确认服务已启动并检查网络";
    }

    return error?.response?.data?.message || error?.message || fallback;
  }

  function setError(error: any, fallback: string) {
    notifyError(resolveErrorMessage(error, fallback));
  }

  function clearError() {
    // 使用全局消息提示后不再维护 chat.errorMessage 状态
  }

  return { setError, clearError };
}
