import type { AxiosProgressEvent } from "axios";
import { convertToWebP, extractVideoFrameToWebP } from "@/utils/convertToWebP";
import { getVideoDuration } from "@/utils/mediaDuration";
import { getChatFileUrl, uploadChatFile } from "../api/files";
import type { FileExtra, MessageType } from "../types";
import {
  formatFileSize,
  getFileCategory,
  getFileCategoryByName,
  type FileCategory,
} from "./fileMeta";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_VIDEO_FILE_SIZE = 25 * 1024 * 1024;

export interface PreparedMessageUploadFiles {
  files: File[];
  invalidFiles: { name: string; error: string }[];
  failedFiles: { name: string; error: string }[];
}

export interface FileUploadProgressOptions {
  onProgress?: (progress: number) => void;
  onThumbnailReady?: (thumbnailUrl: string) => void;
}

function resolveFileCategory(file: Pick<File, "name" | "type">): FileCategory {
  const category = getFileCategory(file.type);
  return category === "unknown" ? getFileCategoryByName(file.name) : category;
}

function getWebPFileName(fileName: string): string {
  const normalizedName = fileName.trim() || "image";
  return /\.[^.]+$/.test(normalizedName)
    ? normalizedName.replace(/\.[^.]+$/, ".webp")
    : `${normalizedName}.webp`;
}

function getImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const dimensions = { width: img.width, height: img.height };
      URL.revokeObjectURL(url);
      resolve(dimensions);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

function getMediaDuration(file: File): Promise<number | null> {
  return getVideoDuration(file);
}

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size === 0) {
    return { valid: false, error: "\u6587\u4ef6\u4e0d\u80fd\u4e3a\u7a7a" };
  }

  const category = resolveFileCategory(file);
  if (category === "unknown") {
    return { valid: false, error: "\u4e0d\u652f\u6301\u7684\u6587\u4ef6\u7c7b\u578b" };
  }

  if (category === "video" && file.size > MAX_VIDEO_FILE_SIZE) {
    return {
      valid: false,
      error: `\u89c6\u9891\u5927\u5c0f\u4e0d\u80fd\u8d85\u8fc7 ${formatFileSize(MAX_VIDEO_FILE_SIZE)}`,
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `\u6587\u4ef6\u5927\u5c0f\u8d85\u8fc7\u9650\u5236\uff08\u6700\u5927 ${formatFileSize(MAX_FILE_SIZE)}\uff09`,
    };
  }

  return { valid: true };
}

export async function prepareFilesForMessageUpload(
  files: File[],
): Promise<PreparedMessageUploadFiles> {
  const preparedFiles: File[] = [];
  const invalidFiles: { name: string; error: string }[] = [];
  const failedFiles: { name: string; error: string }[] = [];

  for (const file of files) {
    const validation = validateFile(file);
    if (!validation.valid) {
      invalidFiles.push({
        name: file.name,
        error: validation.error || "\u6587\u4ef6\u4e0d\u53ef\u4e0a\u4f20",
      });
      continue;
    }

    try {
      if (resolveFileCategory(file) === "image") {
        const webpFile = await convertToWebP(file, {
          quality: 1,
          output: "file",
          fileName: getWebPFileName(file.name),
        }) as File;
        preparedFiles.push(webpFile);
      } else {
        preparedFiles.push(file);
      }
    } catch (error) {
      console.error(`Failed to prepare file ${file.name}:`, error);
      failedFiles.push({
        name: file.name,
        error: error instanceof Error ? error.message : "\u5904\u7406\u5931\u8d25",
      });
    }
  }

  return { files: preparedFiles, invalidFiles, failedFiles };
}

export async function uploadFileForMessage(
  conversationId: number,
  file: File,
  options: FileUploadProgressOptions = {},
): Promise<{ extra: FileExtra; messageType: MessageType }> {
  const validation = validateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const reportProgress = (progress: number) => {
    options.onProgress?.(Math.max(0, Math.min(100, progress)));
  };

  reportProgress(0);

  if (resolveFileCategory(file) === "video") {
    reportProgress(3);
    const coverFile = await extractVideoFrameToWebP(file, {
      quality: 1,
      onProgress: (progress) => {
        reportProgress(Math.round((Math.max(0, Math.min(100, progress)) / 100) * 30));
      },
    });
    reportProgress(30);
    options.onThumbnailReady?.(URL.createObjectURL(coverFile));

    const totalBytes = Math.max(file.size + coverFile.size, 1);
    const uploadedBytes = {
      video: 0,
      cover: 0,
    };

    const updateAggregateProgress = () => {
      const loadedBytes = uploadedBytes.video + uploadedBytes.cover;
      const uploadProgress = Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
      reportProgress(30 + Math.round(uploadProgress * 0.7));
    };

    const createProgressHandler = (key: keyof typeof uploadedBytes, fallbackTotal: number) =>
      (event: AxiosProgressEvent) => {
        const total = event.total ?? fallbackTotal;
        if (!total) return;
        uploadedBytes[key] = Math.min(event.loaded, total);
        updateAggregateProgress();
      };

    const [videoInfo, coverInfo] = await Promise.all([
      uploadChatFile(conversationId, file, {
        onUploadProgress: createProgressHandler("video", file.size),
      }),
      uploadChatFile(conversationId, coverFile, {
        onUploadProgress: createProgressHandler("cover", coverFile.size),
      }),
    ]);

    reportProgress(100);

    const duration = await getMediaDuration(file);
    const mimeType = file.type || videoInfo.data.contentType;
    const extra: FileExtra = {
      fileName: file.name,
      fileSize: file.size,
      fileKey: videoInfo.data.fileKey,
      fileUrl: getChatFileUrl(videoInfo.data.fileKey),
      mimeType,
      thumbnailUrl: coverInfo.data.fileKey,
      duration: duration ?? undefined,
    };

    return { extra, messageType: "video" };
  }

  const response = await uploadChatFile(conversationId, file, {
    onUploadProgress: (event) => {
      const total = event.total ?? file.size;
      if (!total) return;
      reportProgress(Math.round((event.loaded / total) * 100));
    },
  });

  reportProgress(100);

  const fileInfo = response.data;
  const fileUrl = getChatFileUrl(fileInfo.fileKey);
  const category = getFileCategory(fileInfo.contentType);
  let messageType: MessageType;

  switch (category) {
    case "image":
      messageType = "image";
      break;
    case "video":
      messageType = "video";
      break;
    case "audio":
      messageType = "audio";
      break;
    default:
      messageType = "file";
  }

  const fileExtra: FileExtra = {
    fileName: fileInfo.originalFileName,
    fileSize: fileInfo.fileSize,
    fileUrl,
    fileKey: fileInfo.fileKey,
    mimeType: fileInfo.contentType,
  };

  if (messageType === "image") {
    try {
      const dimensions = await getImageDimensions(file);
      if (dimensions) {
        fileExtra.width = dimensions.width;
        fileExtra.height = dimensions.height;
      }
    } catch (error) {
      console.warn("Failed to get image dimensions:", error);
    }
  }

  if (messageType === "video" || messageType === "audio") {
    try {
      const duration = await getMediaDuration(file);
      if (duration) {
        fileExtra.duration = duration;
      }
    } catch (error) {
      console.warn("Failed to get media duration:", error);
    }
  }

  return {
    extra: fileExtra,
    messageType,
  };
}
