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

/**
 * 聊天图片转换上限。
 *
 * 以前这里是 `quality: 1` 且**不给 maxWidth/maxHeight**：手机原图 4000×3000，
 * 等于要开「48MB 位图 + 48MB canvas + 全质量 WebP 编码」。Chrome 移动端的
 * 渲染进程会因此被 OOM 杀掉 —— 用户看到的是「选完文件，页面自己刷新了」，
 * 转码期间整页也会卡住（点击没反应 / 选择器迟迟不弹）。
 *
 * 现在：长边压到 1920、质量 0.9。聊天气泡里图片最大也就 300px，
 * 全屏预览 1920 也够；转码耗时和峰值内存都降到 1/10 量级。
 */
const MAX_IMAGE_LONG_EDGE = 1920;
const IMAGE_WEBP_QUALITY = 0.9;
/** 超过这个体积的图片不本地转码，直接传原图（服务端本来也会转 WebP）。 */
const MAX_IMAGE_CONVERT_BYTES = 20 * 1024 * 1024;
/** 单张图转码的超时：卡住就退回原图，绝不让按钮一直转圈。 */
const IMAGE_CONVERT_TIMEOUT_MS = 8_000;
/** 视频封面是缩略图，没必要按原分辨率抽帧。 */
const VIDEO_COVER_MAX_EDGE = 1280;
const VIDEO_COVER_QUALITY = 0.85;

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

/** 给一个 Promise 加超时；超时用 `fallback` 的结果继续，不会把流程卡死。 */
function withTimeout<T>(task: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback());
    }, ms);

    task.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 让出一次主线程，让浏览器有机会绘制/回收内存。 */
function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 把一张图转成 WebP；**任何失败/超时都退回原图**。
 *
 * 服务端上传时本来也会转 WebP（见 FileService），所以退原图不会产生
 * 额外的格式兼容问题，但能保证「用户选了的文件一定发得出去」，
 * 也不会让 preparing 状态永远挂在按钮上。
 */
async function convertImageSafely(file: File): Promise<File> {
  // 体积过大的图连解码都可能把移动端渲染进程撑爆，直接传原图
  if (file.size > MAX_IMAGE_CONVERT_BYTES) {
    console.warn(`Skip webp conversion for large image: ${file.name} (${file.size} bytes)`);
    return file;
  }

  try {
    const converted = await withTimeout(
      convertToWebP(file, {
        quality: IMAGE_WEBP_QUALITY,
        maxWidth: MAX_IMAGE_LONG_EDGE,
        maxHeight: MAX_IMAGE_LONG_EDGE,
        output: "file",
        fileName: getWebPFileName(file.name),
      }),
      IMAGE_CONVERT_TIMEOUT_MS,
      () => null,
    );

    return converted instanceof File ? converted : file;
  } catch (error) {
    console.warn(`WebP conversion failed, fallback to original file: ${file.name}`, error);
    return file;
  }
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
        preparedFiles.push(await convertImageSafely(file));
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

    // 多选时每张图之间让出主线程：连续解码/编码会让手机端长时间失去响应
    await yieldToMainThread();
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
      quality: VIDEO_COVER_QUALITY,
      maxWidth: VIDEO_COVER_MAX_EDGE,
      maxHeight: VIDEO_COVER_MAX_EDGE,
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
