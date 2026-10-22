import type { FileExtra } from "../types";

export const SUPPORTED_FILE_TYPES = {
  image: [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/svg+xml",
  ],
  video: [
    "video/mp4",
    "video/webm",
    "video/ogg",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-ms-wmv",
  ],
  audio: [
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/mp4",
    "audio/flac",
    "audio/aac",
  ],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/markdown",
    "application/rtf",
    "text/csv",
  ],
  archive: [
    "application/zip",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-bzip2",
  ],
} as const;

export type FileCategory = keyof typeof SUPPORTED_FILE_TYPES | "unknown";
export type FilePreviewType =
  | "image"
  | "video"
  | "audio"
  | "word"
  | "excel"
  | "pptx"
  | "pdf"
  | "text"
  | "md"
  | "doc"
  | "xls"
  | "ppt"
  | "archive"
  | "unknown";

export type DocumentIconType =
  | "word"
  | "excel"
  | "pptx"
  | "pdf"
  | "text"
  | "md"
  | "zip"
  | "rar"
  | "css"
  | "htm"
  | "java"
  | "note"
  | "unknown";

const MIME_PREVIEW_TYPE_MAP: Record<string, FilePreviewType> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/pdf": "pdf",
  "text/markdown": "md",
  "text/plain": "text",
  "text/csv": "text",
  "text/html": "text",
  "application/json": "text",
  "application/xml": "text",
  "text/xml": "text",
  "text/css": "text",
  "application/css": "text",
  "application/javascript": "text",
  "text/javascript": "text",
};

const EXT_PREVIEW_TYPE_MAP: Record<string, FilePreviewType> = {
  docx: "word",
  doc: "doc",
  xlsx: "excel",
  xls: "xls",
  pptx: "pptx",
  ppt: "ppt",
  pdf: "pdf",
  txt: "text",
  md: "md",
  csv: "text",
  html: "text",
  htm: "text",
  json: "text",
  xml: "text",
  css: "text",
  js: "text",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  bz2: "archive",
};

const PREVIEWABLE_FILE_TYPES = new Set<FilePreviewType>([
  "image",
  "video",
  "audio",
  "word",
  "excel",
  "pptx",
  "pdf",
  "text",
  "md",
  "doc",
  "xls",
  "ppt",
]);

export function getFileCategory(mimeType?: string | null): FileCategory {
  if (!mimeType) return "unknown";
  for (const [category, types] of Object.entries(SUPPORTED_FILE_TYPES)) {
    if (types.includes(mimeType as never)) {
      return category as FileCategory;
    }
  }
  return "unknown";
}

/**
 * 前端扩展名白名单 —— **单一来源**。
 *
 * 一个格式要能被发出去，三处必须同时放行：
 *   1. FileUploadButton 的 `<input accept>`：决定「原生选择器里能不能选中」；
 *   2. 本文件的 `getFileCategoryByName`：决定选中后 `validateFile` 会不会拦；
 *   3. 后端 `api/Infrastructure/FileService.cs` 的 `SupportedFileTypes`：决定服务端收不收。
 *
 * ⚠️ 历史教训：以前 1 是手写字符串，跟 2/3 脱节 —— `.md` 后端支持、
 * 前端校验放行，唯独 accept 里没写，桌面端选择器直接把它置灰点不动
 * （表现为「.md 根本选不了」）。现在 accept 由这里拼出来，加格式只改这一处。
 */
export const FILE_EXTENSIONS = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico"],
  video: ["mp4", "avi", "mov", "wmv", "flv", "mkv", "webm", "m4v"],
  audio: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma", "opus"],
  document: [
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "txt",
    "rtf",
    "csv",
    "md",
  ],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2"],
  /** 代码/标记类文本：后端按 SupportedFileTypes 原样保存，这里归到 document。 */
  code: ["json", "xml", "html", "css", "js", "ts"],
} as const;

/** 展平后的全部扩展名（不带点），accept 字符串由此生成。 */
export const SUPPORTED_FILE_EXTENSIONS: readonly string[] = Object.values(
  FILE_EXTENSIONS,
).flat();

function extensionIn(list: readonly string[], ext: string): boolean {
  return list.includes(ext);
}

export function getFileCategoryByName(fileName: string): FileCategory {
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (!ext) return "unknown";
  if (extensionIn(FILE_EXTENSIONS.image, ext)) return "image";
  if (extensionIn(FILE_EXTENSIONS.video, ext)) return "video";
  if (extensionIn(FILE_EXTENSIONS.audio, ext)) return "audio";
  if (extensionIn(FILE_EXTENSIONS.document, ext)) return "document";
  if (extensionIn(FILE_EXTENSIONS.code, ext)) return "document";
  if (extensionIn(FILE_EXTENSIONS.archive, ext)) return "archive";
  return "unknown";
}

export function getFilePreviewType(
  file?: (Pick<FileExtra, "mimeType" | "fileName"> &
    Partial<Pick<FileExtra, "fileUrl" | "fileKey">>) | null,
): FilePreviewType {
  if (!file) return "unknown";

  const mimeType = file.mimeType?.toLowerCase() || "";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  const mappedByMime = MIME_PREVIEW_TYPE_MAP[mimeType];
  if (mappedByMime) return mappedByMime;

  const category = getFileCategory(mimeType);
  if (category === "archive") return "archive";

  // 后端把「用户原始文件名」和「存储文件名」分开存：FileName 常常**没有扩展名**
  // （手机端分享出来的「ENV-从零重建手册」就是这种），真实后缀在 FileUrl / FileKey 里
  // （..._6ad87c06.md）。只认 FileName 会把这类文件判成 unknown —— 表现就是
  // .md / .txt 显示成未知文件、详情面板里的「预览」按钮被禁用、点了没反应。
  const ext =
    getFileExtension(file.fileName) ||
    getFileExtension(file.fileUrl) ||
    getFileExtension(file.fileKey) ||
    "";
  return EXT_PREVIEW_TYPE_MAP[ext] || "unknown";
}

/**
 * 取文件名扩展名（不带点，小写）；没有扩展名时返回空串。
 *
 * 注意不能用 `name.split('.').pop()`：文件名里没有点的时候，它会把**整个文件名**
 * 当成扩展名（"ENV-从零重建手册" → "env-从零重建手册"），所有扩展名判断都不命中，
 * 看起来就像「类型识别坏了」。
 */
export function getFileExtension(name?: string | null): string {
  if (!name) return "";
  // FileUrl 可能是 .../xxx.md?v=1 这种带查询串的形式
  const base = name.split(/[?#]/)[0] ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function getDocumentIconType(
  previewType: FilePreviewType,
  file?: (Pick<FileExtra, "mimeType" | "fileName"> &
    Partial<Pick<FileExtra, "fileUrl" | "fileKey">>) | null,
): DocumentIconType {
  if (previewType === "word" || previewType === "doc") return "word";
  if (previewType === "excel" || previewType === "xls") return "excel";
  if (previewType === "pptx" || previewType === "ppt") return "pptx";
  if (previewType === "pdf") return "pdf";

  const ext =
    getFileExtension(file?.fileName) ||
    getFileExtension(file?.fileUrl) ||
    getFileExtension(file?.fileKey) ||
    "";
  if (previewType === "archive") return ext === "rar" ? "rar" : "zip";
  if (ext === "css") return "css";
  if (ext === "html" || ext === "htm") return "htm";
  if (ext === "js") return "java";
  if (ext === "md") return "note";
  if (previewType === "text") return "text";
  if (previewType === "md") return "md";
  return "unknown";
}

/**
 * 中文类型文案 —— 「给人看」的那一套（英文短标签见 getFileTypeLabel，
 * 它贴在文件卡片上当下标用，尺寸不一致所以两者不合并）。
 *
 * 详情面板、拖拽上传确认弹窗都从这里取，避免两处各抄一份表再各自漂移。
 */
export const FILE_TYPE_LABELS: Record<FilePreviewType, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  word: "Word 文档",
  excel: "Excel 表格",
  pptx: "PPT 演示",
  pdf: "PDF",
  text: "文本",
  md: "Markdown",
  doc: "Word 文档",
  xls: "Excel 表格",
  ppt: "PPT 演示",
  archive: "压缩包",
  unknown: "文件",
};

export function getFileTypeLabel(previewType: FilePreviewType): string {
  const labels: Record<FilePreviewType, string> = {
    image: "image",
    video: "video",
    audio: "audio",
    word: "word",
    excel: "excel",
    pptx: "pptx",
    pdf: "pdf",
    text: "text",
    md: "md",
    doc: "doc",
    xls: "xls",
    ppt: "ppt",
    archive: "archive",
    unknown: "file",
  };
  return labels[previewType];
}

/** 中文类型文案（供详情面板等直接展示）。 */
export function getFileTypeText(previewType: FilePreviewType): string {
  return FILE_TYPE_LABELS[previewType] ?? FILE_TYPE_LABELS.unknown;
}

export function isPreviewableFileType(previewType: FilePreviewType): boolean {
  return PREVIEWABLE_FILE_TYPES.has(previewType);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

export function parseMessageExtra(extra?: string | null): FileExtra | null {
  if (!extra) return null;

  try {
    const raw = JSON.parse(extra) as Record<string, unknown>;

    if (raw.MimeType && !raw.mimeType) {
      raw.mimeType = raw.MimeType;
      delete raw.MimeType;
    }
    if (raw.FileName && !raw.fileName) {
      raw.fileName = raw.FileName;
      delete raw.FileName;
    }
    if (raw.FileSize && !raw.fileSize) {
      raw.fileSize = raw.FileSize;
      delete raw.FileSize;
    }
    if (raw.FileUrl && !raw.fileUrl) {
      raw.fileUrl = raw.FileUrl;
      delete raw.FileUrl;
    }
    if (raw.FileKey && !raw.fileKey) {
      raw.fileKey = raw.FileKey;
      delete raw.FileKey;
    }
    if (raw.ThumbnailUrl && !raw.thumbnailUrl) {
      raw.thumbnailUrl = raw.ThumbnailUrl;
      delete raw.ThumbnailUrl;
    }
    if (raw.Width && !raw.width) {
      raw.width = raw.Width;
      delete raw.Width;
    }
    if (raw.Height && !raw.height) {
      raw.height = raw.Height;
      delete raw.Height;
    }
    if (raw.Duration && !raw.duration) {
      raw.duration = raw.Duration;
      delete raw.Duration;
    }
    if (raw.LocalPreviewUrl && !raw.localPreviewUrl) {
      raw.localPreviewUrl = raw.LocalPreviewUrl;
      delete raw.LocalPreviewUrl;
    }
    if (raw.LocalThumbnailUrl && !raw.localThumbnailUrl) {
      raw.localThumbnailUrl = raw.LocalThumbnailUrl;
      delete raw.LocalThumbnailUrl;
    }

    return raw as unknown as FileExtra;
  } catch {
    return null;
  }
}
