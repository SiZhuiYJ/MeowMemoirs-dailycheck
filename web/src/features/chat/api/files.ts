import type { AxiosProgressEvent } from "axios";
import { API_BASE_URL } from "@/config";
import fileHttp from "@/libs/http/file";
import { getConversationAvatarUrl as buildConversationAvatarUrl } from "@/utils/avatar";

export interface ChatFileInfo {
  fileKey: string;
  originalFileName: string;
  fileSize: number;
  contentType: string;
}

export interface ChatUploadOptions {
  onUploadProgress?: (event: AxiosProgressEvent) => void;
}

export async function uploadChatFile(
  conversationId: number,
  file: File,
  options: ChatUploadOptions = {},
) {
  const formData = new FormData();
  formData.append("file", file);

  return await fileHttp.upload<ChatFileInfo>(
    `/mm/files/chat/${conversationId}/upload`,
    formData,
    {
      allowDuplicate: true,
      onUploadProgress: options.onUploadProgress,
    },
  );
}

export function getChatFileUrl(fileKey: string): string {
  if (!fileKey) return "";
  return `${API_BASE_URL}/mm/files/chat/${fileKey}`;
}

export async function uploadConversationAvatar(
  conversationId: number,
  payload: File | FormData,
) {
  const formData = payload instanceof FormData ? payload : new FormData();
  if (!(payload instanceof FormData)) {
    formData.append("file", payload);
  }

  return await fileHttp.upload<{ key: string }>(
    `/mm/files/chat/${conversationId}/avatar`,
    formData,
  );
}

export function getConversationAvatarUrl(conversationId: number, fileKey: string): string {
  return buildConversationAvatarUrl(conversationId, fileKey);
}
