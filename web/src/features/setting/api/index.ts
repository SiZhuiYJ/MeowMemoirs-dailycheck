import http from "@/libs/http";
import type {
  LoginRecordListResponse,
  LoginScope,
} from "@/features/setting/types";

export const SettingApi = {
  UploadImage(formData: FormData) {
    return http.upload<{ key: string }>("/mm/Files/avatar", formData);
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
};
