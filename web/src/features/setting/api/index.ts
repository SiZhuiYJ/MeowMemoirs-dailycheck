import http from "@/libs/http";
import type {
  AdminFeedbackItemDto,
  AdminFeedbackListResponse,
  ChangelogListResponse,
  CreateFeedbackRequest,
  FeedbackAppFilter,
  FeedbackItemDto,
  FeedbackStatusFilter,
  LoginRecordListResponse,
  LoginScope,
  MyFeedbackListResponse,
} from "@/features/setting/types";

export const SettingApi = {
  UploadImage(formData: FormData) {
    return http.upload<{ key: string; previousKey?: string | null }>(
      "/mm/Files/avatar",
      formData,
    );
  },
  /**
   * 使用上次头像：服务端把「当前头像」与「上次头像」互换（可来回切）。
   * 无请求体，需登录；`previousKey` 是互换后新的上次头像 key。
   * 关闭全局错误提示，由调用方按 400/404 给出更明确的文案。
   */
  UsePreviousAvatar() {
    return http.post<{ key: string; previousKey?: string | null }>(
      "/mm/Files/avatar/use-previous",
      undefined,
      { showError: false },
    );
  },
  GetImage(url: string) {
    return http.download<Blob>(url);
  },
  /**
   * 上传个人主页头像卡背景图（multipart，字段名 file；可选 thumbnail）。
   * 服务端会统一转 WebP（最长边 1600px）并生成 `_thumb` 占位图。
   */
  UploadProfileBackground(formData: FormData) {
    return http.upload<{ key: string; thumbnailKey?: string }>(
      "/mm/Files/profile-background",
      formData,
    );
  },
  /** 恢复默认背景：清空当前用户的 profileBackgroundKey。 */
  DeleteProfileBackground() {
    return http.delete<{ success: boolean }>("/mm/Files/profile-background");
  },
  /** 分页获取本人登录记录（默认 pageSize 由调用方传 20）。 */
  GetLoginRecords(params: {
    page: number;
    pageSize: number;
    scope: LoginScope;
  }) {
    return http.get<LoginRecordListResponse>("/mm/LoginRecords", params);
  },
  /**
   * 获取公开的更新日志（匿名接口，无需登录）。
   * limit 可选，服务端默认 20 并夹到 1..50；不传时这里显式给 20。
   */
  GetChangelog(params?: { limit?: number }) {
    return http.get<ChangelogListResponse>(
      "/mm/Changelog",
      params ?? { limit: 20 },
    );
  },
  /**
   * 提交意见反馈（需登录）。
   * 网页端来源固定为 "web"；成功返回本人视角的单条反馈。
   * 错误提示（内容为空 / 超长等）走全局提示，调用方只处理成功后的刷新。
   */
  SubmitFeedback(data: CreateFeedbackRequest) {
    return http.post<FeedbackItemDto>("/mm/Feedback", data);
  },
  /**
   * 分页获取「我的反馈」（需登录）。
   * 关闭全局错误提示：列表失败由页面内的错误态 + 重试按钮承接，
   * 避免网络抖动时全局弹窗刷屏。
   */
  GetMyFeedback(params: { page: number; pageSize: number }) {
    return http.get<MyFeedbackListResponse>("/mm/Feedback/mine", params, {
      showError: false,
    });
  },
  /**
   * 管理员分页查看全部反馈（仅管理员，非管理员 403）。
   * 同样关闭全局提示：403 要在页面里展示「无权限」而不是弹一个转瞬即逝的 warning。
   */
  GetAdminFeedback(params: {
    page: number;
    pageSize: number;
    status: FeedbackStatusFilter;
    keyword?: string;
    app: FeedbackAppFilter;
  }) {
    return http.get<AdminFeedbackListResponse>("/mm/Feedback", params, {
      showError: false,
    });
  },
  /**
   * 管理员回复某条反馈（仅管理员；重复回复视为覆盖）。
   * 保留全局错误提示（内容为空 / 超长 / 反馈不存在），页面只需处理成功后的局部更新。
   */
  ReplyFeedback(id: number, replyContent: string) {
    return http.post<AdminFeedbackItemDto>(`/mm/Feedback/${id}/reply`, {
      replyContent,
    });
  },
};
