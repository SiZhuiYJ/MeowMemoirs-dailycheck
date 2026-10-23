import http from "@/libs/http";
import type { HttpRequestConfig } from "@/libs/http/type";
import type { UserProfile } from "../types";

/** 获取指定用户的主页信息（聊天页「查看主页」使用）。 */
export async function getUserProfile(
  userId: number,
  config: HttpRequestConfig = {},
) {
  return await http.get<UserProfile>(`/mm/Users/${userId}/profile`, undefined, config);
}
