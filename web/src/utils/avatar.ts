import { API_BASE_URL } from "@/config";
import { convertToWebP } from "@/utils/convertToWebP";

const AVATAR_PREVIEW_MAX_PIXELS = 1200;
const AVATAR_THUMBNAIL_MAX_PIXELS = 96;

type Identifier = number | string | null | undefined;

export interface AvatarSources {
  src: string;
  thumbnailSrc: string;
}

function buildAvatarAssetUrl(path: string): string {
  if (!path) return "";

  // In dev we prefer Vite's same-origin proxy so avatar <img> requests do not
  // become cross-origin resources blocked by the current COEP settings.
  if (import.meta.env.DEV) {
    return path;
  }

  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function appendAvatarQuery(url: string, thumbnail: boolean): string {
  if (!url || !thumbnail) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}thumbnail=true`;
}

export function getUserAvatarUrl(
  userId: Identifier,
  avatarKey: string | null | undefined,
  options: { thumbnail?: boolean } = {},
): string {
  if (!userId || !avatarKey) return "";
  const url = buildAvatarAssetUrl(`/mm/Files/users/${userId}/${avatarKey}`);
  return appendAvatarQuery(url, options.thumbnail === true);
}

export function getConversationAvatarUrl(
  conversationId: Identifier,
  avatarKey: string | null | undefined,
  options: { thumbnail?: boolean } = {},
): string {
  if (!conversationId || !avatarKey) return "";
  const url = buildAvatarAssetUrl(
    `/mm/files/chat/${conversationId}/avatars/${avatarKey}`,
  );
  return appendAvatarQuery(url, options.thumbnail === true);
}

export function getUserAvatarSources(
  userId: Identifier,
  avatarKey: string | null | undefined,
): AvatarSources {
  const src = getUserAvatarUrl(userId, avatarKey);
  return {
    src,
    thumbnailSrc: getUserAvatarUrl(userId, avatarKey, { thumbnail: true }),
  };
}

export function getConversationAvatarSources(
  conversationId: Identifier,
  avatarKey: string | null | undefined,
): AvatarSources {
  const src = getConversationAvatarUrl(conversationId, avatarKey);
  return {
    src,
    thumbnailSrc: getConversationAvatarUrl(conversationId, avatarKey, {
      thumbnail: true,
    }),
  };
}

export async function createAvatarUploadFormData(file: File): Promise<FormData> {
  const normalizedName =
    file.name.replace(/\.[^.]+$/, "").trim() || "avatar";

  const avatarFile = (await convertToWebP(file, {
    quality: 1,
    maxWidth: AVATAR_PREVIEW_MAX_PIXELS,
    maxHeight: AVATAR_PREVIEW_MAX_PIXELS,
    output: "file",
    fileName: `${normalizedName}.webp`,
  })) as File;

  const thumbnailFile = (await convertToWebP(file, {
    quality: 0.76,
    maxWidth: AVATAR_THUMBNAIL_MAX_PIXELS,
    maxHeight: AVATAR_THUMBNAIL_MAX_PIXELS,
    output: "file",
    fileName: `${normalizedName}-thumb.webp`,
  })) as File;

  const formData = new FormData();
  formData.append("file", avatarFile);
  formData.append("thumbnail", thumbnailFile);
  return formData;
}
