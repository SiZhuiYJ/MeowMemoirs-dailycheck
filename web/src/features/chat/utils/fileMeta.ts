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

export function getFileCategoryByName(fileName: string): FileCategory {
  const ext = fileName.split(".").pop()?.toLowerCase();

  const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico"];
  const videoExts = ["mp4", "avi", "mov", "wmv", "flv", "mkv", "webm", "m4v"];
  const audioExts = ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma", "opus"];
  const docExts = [
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
  ];
  const archiveExts = ["zip", "rar", "7z", "tar", "gz", "bz2"];

  if (!ext) return "unknown";
  if (imageExts.includes(ext)) return "image";
  if (videoExts.includes(ext)) return "video";
  if (audioExts.includes(ext)) return "audio";
  if (docExts.includes(ext)) return "document";
  if (archiveExts.includes(ext)) return "archive";
  return "unknown";
}

export function getFilePreviewType(
  file?: Pick<FileExtra, "mimeType" | "fileName"> | null,
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

  const ext = file.fileName.split(".").pop()?.toLowerCase() || "";
  return EXT_PREVIEW_TYPE_MAP[ext] || "unknown";
}

export function getDocumentIconType(
  previewType: FilePreviewType,
  file?: Pick<FileExtra, "mimeType" | "fileName"> | null,
): DocumentIconType {
  if (previewType === "word" || previewType === "doc") return "word";
  if (previewType === "excel" || previewType === "xls") return "excel";
  if (previewType === "pptx" || previewType === "ppt") return "pptx";
  if (previewType === "pdf") return "pdf";

  const ext = file?.fileName.split(".").pop()?.toLowerCase() || "";
  if (previewType === "archive") return ext === "rar" ? "rar" : "zip";
  if (ext === "css") return "css";
  if (ext === "html" || ext === "htm") return "htm";
  if (ext === "js") return "java";
  if (ext === "md") return "note";
  if (previewType === "text") return "text";
  if (previewType === "md") return "md";
  return "unknown";
}

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
