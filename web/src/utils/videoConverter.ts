import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { getVideoFileMetadata, type VideoFileMetadata } from "./videoMetadata";

export interface ConvertVideoToWebMOptions {
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  maxOutputSizeBytes?: number;
  mimeType?: string;
  maxDurationSeconds?: number;
  maxDimension?: number;
  onProgress?: (progress: number) => void;
}

const DEFAULT_MAX_DURATION_SECONDS = 5 * 60;
const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_AUDIO_BITS_PER_SECOND = 96_000;
const DEFAULT_VIDEO_BITS_PER_SECOND = 2_000_000;
const MIN_VIDEO_BITS_PER_SECOND = 500_000;
const MAX_VIDEO_BITS_PER_SECOND = 12_000_000;
const SINGLE_THREAD_MAX_VIDEO_BITS_PER_SECOND = 2_500_000;
const MULTI_THREAD_MODE = "mt";
const SINGLE_THREAD_MODE = "st";

type CoreMode = "mt" | "st";

type CaptureVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;
let ffmpegMode: CoreMode | null = null;
let runtimeModeDescriptionOverride: string | null = null;

function normalizeWebMName(fileName: string): string {
  const safeName = fileName.trim() || "video";
  return /\.[^.]+$/.test(safeName)
    ? safeName.replace(/\.[^.]+$/, ".webm")
    : `${safeName}.webm`;
}

function getFileExtension(fileName: string): string {
  const extension = fileName.split(".").pop()?.trim().toLowerCase();
  return extension || "mp4";
}

function getAssetUrl(directory: string, fileName: string): string {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(`${directory}/${fileName}`, base).toString();
}

function getMultiThreadAssetUrl(fileName: string): string {
  return getAssetUrl("ffmpeg", fileName);
}

function getSingleThreadAssetUrl(fileName: string): string {
  return getAssetUrl("ffmpeg-single", fileName);
}

function createTempFileName(prefix: string, fileName: string): string {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomId}.${getFileExtension(fileName)}`;
}

function toKiloBitsPerSecond(value: number): string {
  return `${Math.max(1, Math.round(value / 1000))}k`;
}

function canUseMultiThreadCore(): boolean {
  if (typeof window === "undefined") return false;
  return window.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
}

function shouldPreferSingleThreadCore(): boolean {
  if (typeof window === "undefined") return true;
  if (import.meta.env.DEV) return true;

  const { hostname, protocol } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (protocol !== "https:" && hostname !== "localhost" && hostname !== "127.0.0.1") return true;

  return false;
}

function getPreferredCoreMode(): CoreMode {
  if (shouldPreferSingleThreadCore()) {
    return SINGLE_THREAD_MODE;
  }
  return canUseMultiThreadCore() ? MULTI_THREAD_MODE : SINGLE_THREAD_MODE;
}

function getCoreLoadConfig(mode: CoreMode) {
  if (mode === MULTI_THREAD_MODE) {
    return {
      coreURL: getMultiThreadAssetUrl("ffmpeg-core.js"),
      wasmURL: getMultiThreadAssetUrl("ffmpeg-core.wasm"),
      workerURL: getMultiThreadAssetUrl("ffmpeg-core.worker.js"),
    };
  }

  return {
    coreURL: getSingleThreadAssetUrl("ffmpeg-core.js"),
    wasmURL: getSingleThreadAssetUrl("ffmpeg-core.wasm"),
  };
}

function getCoreModeLabel(mode: CoreMode): string {
  return mode === MULTI_THREAD_MODE ? "多线程" : "单线程兼容";
}

function setRuntimeModeDescription(description: string | null) {
  runtimeModeDescriptionOverride = description;
}

function syncRuntimeModeDescriptionFromFFmpeg() {
  if (ffmpegMode === MULTI_THREAD_MODE) {
    setRuntimeModeDescription("当前使用 ffmpeg.wasm 多线程模式");
    return;
  }
  if (ffmpegMode === SINGLE_THREAD_MODE) {
    setRuntimeModeDescription("当前使用 ffmpeg.wasm 单线程兼容模式");
    return;
  }
  setRuntimeModeDescription(null);
}

function formatLoadError(error: unknown, mode: CoreMode): Error {
  const message = describeUnknownError(error);
  return new Error(`FFmpeg ${getCoreModeLabel(mode)}核心加载失败: ${message}`);
}

function estimateSourceBitrate(
  sourceFile: File,
  durationSeconds: number,
  maxOutputSizeBytes?: number,
): { videoBitsPerSecond?: number; audioBitsPerSecond?: number } {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {};
  }

  const sourceTotalBitsPerSecond = Math.floor((sourceFile.size * 8) / durationSeconds);
  const maxOutputBitsPerSecond = maxOutputSizeBytes
    ? Math.floor((maxOutputSizeBytes * 8) / durationSeconds)
    : undefined;
  const totalBitsPerSecond = typeof maxOutputBitsPerSecond === "number"
    ? Math.min(sourceTotalBitsPerSecond, maxOutputBitsPerSecond)
    : sourceTotalBitsPerSecond;

  if (!Number.isFinite(totalBitsPerSecond) || totalBitsPerSecond <= 0) {
    return {};
  }

  const audioBitsPerSecond = Math.min(160_000, Math.max(64_000, Math.floor(totalBitsPerSecond * 0.08)));
  const videoBitsPerSecond = Math.min(
    MAX_VIDEO_BITS_PER_SECOND,
    Math.max(MIN_VIDEO_BITS_PER_SECOND, Math.floor(totalBitsPerSecond - audioBitsPerSecond)),
  );

  return {
    videoBitsPerSecond,
    audioBitsPerSecond,
  };
}

function buildScaleArgs(
  width: number | null,
  height: number | null,
  maxDimension: number,
): string[] {
  if (!width || !height || maxDimension <= 0) return [];
  if (Math.max(width, height) <= maxDimension) return [];

  const scaleExpression =
    `scale='if(gte(iw,ih),min(${maxDimension},iw),-2)':'if(gte(iw,ih),-2,min(${maxDimension},ih))':flags=lanczos`;

  return ["-vf", scaleExpression];
}

function parseEncodedTimeSeconds(message: string): number | null {
  const match = message.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

async function loadFFmpegForMode(mode: CoreMode): Promise<FFmpeg> {
  const ffmpeg = new FFmpeg();
  await ffmpeg.load(getCoreLoadConfig(mode));
  ffmpegMode = mode;
  ffmpegInstance = ffmpeg;
  syncRuntimeModeDescriptionFromFFmpeg();
  return ffmpeg;
}

function getCurrentVideoCodec(): "libvpx-vp9" | "libvpx" {
  return ffmpegMode === MULTI_THREAD_MODE ? "libvpx-vp9" : "libvpx";
}

export function getVideoConverterModeDescription(): string {
  if (runtimeModeDescriptionOverride) {
    return runtimeModeDescriptionOverride;
  }

  return getPreferredCoreMode() === MULTI_THREAD_MODE
    ? "当前将使用 ffmpeg.wasm 多线程模式"
    : "当前将使用 ffmpeg.wasm 单线程兼容模式";
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const preferredMode = getPreferredCoreMode();

    try {
      return await loadFFmpegForMode(preferredMode);
    } catch (preferredError) {
      if (preferredMode === MULTI_THREAD_MODE) {
        try {
          return await loadFFmpegForMode(SINGLE_THREAD_MODE);
        } catch (fallbackError) {
          throw formatLoadError(fallbackError, SINGLE_THREAD_MODE);
        }
      }
      throw formatLoadError(preferredError, preferredMode);
    }
  })();

  try {
    return await ffmpegLoadPromise;
  } catch (error) {
    ffmpegLoadPromise = null;
    ffmpegInstance = null;
    ffmpegMode = null;
    syncRuntimeModeDescriptionFromFFmpeg();
    throw error;
  }
}

async function safeDeleteFile(ffmpeg: FFmpeg, fileName: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(fileName);
  } catch {
    // Ignore temporary cleanup failures.
  }
}

function resolveOutputBuffer(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }

    const name = Reflect.get(error, "name");
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return typeof name === "string" && name
          ? `${name}: ${serialized}`
          : serialized;
      }
    } catch {
      // Ignore JSON serialization failures.
    }

    if (typeof name === "string" && name.trim()) {
      return name;
    }
  }
  return "视频转换失败";
}

function shouldFallbackToNativeRecorder(error: unknown): boolean {
  const message = describeUnknownError(error).toLowerCase();
  return (
    message.includes("memory access out of bounds")
    || message.includes("bad memory")
    || message.includes("out of memory")
    || message.includes("runtimeerror")
    || message.includes("abort(")
  );
}

function canUseNativeRecorderFallback(): boolean {
  if (typeof window === "undefined") return false;
  return typeof MediaRecorder !== "undefined" && typeof document !== "undefined";
}

function pickSupportedRecorderMimeType(preferredMimeType?: string): string | null {
  const candidates = [
    preferredMimeType,
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm",
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null;
}

function getCaptureStream(video: CaptureVideoElement): MediaStream | null {
  if (typeof video.captureStream === "function") {
    return video.captureStream();
  }
  if (typeof video.mozCaptureStream === "function") {
    return video.mozCaptureStream();
  }
  return null;
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
    };

    video.onloadedmetadata = () => {
      cleanup();
      resolve();
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("浏览器无法读取该视频的元数据。"));
    };
  });
}

function stopMediaStream(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

async function convertVideoToWebMWithMediaRecorder(
  sourceFile: File,
  sourceMetadata: VideoFileMetadata,
  options: ConvertVideoToWebMOptions,
): Promise<File> {
  if (!canUseNativeRecorderFallback()) {
    throw new Error("当前浏览器不支持浏览器原生 WebM 回退转码。");
  }

  const mimeType = pickSupportedRecorderMimeType(options.mimeType);
  if (!mimeType) {
    throw new Error("当前浏览器不支持可用的 MediaRecorder WebM 输出格式。");
  }

  const guessedBitrate = estimateSourceBitrate(sourceFile, sourceMetadata.duration ?? 0, options.maxOutputSizeBytes);
  const videoBitsPerSecond = Math.min(
    SINGLE_THREAD_MAX_VIDEO_BITS_PER_SECOND,
    options.videoBitsPerSecond ?? guessedBitrate.videoBitsPerSecond ?? DEFAULT_VIDEO_BITS_PER_SECOND,
  );
  const audioBitsPerSecond = Math.min(
    DEFAULT_AUDIO_BITS_PER_SECOND,
    options.audioBitsPerSecond ?? guessedBitrate.audioBitsPerSecond ?? DEFAULT_AUDIO_BITS_PER_SECOND,
  );

  const videoUrl = URL.createObjectURL(sourceFile);
  const video = document.createElement("video") as CaptureVideoElement;
  video.preload = "auto";
  video.playsInline = true;
  video.controls = false;
  video.src = videoUrl;

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let progressTimer = 0;

  try {
    options.onProgress?.(12);
    await waitForVideoMetadata(video);

    stream = getCaptureStream(video);
    if (!stream) {
      throw new Error("当前浏览器不支持从视频元素捕获媒体流。");
    }

    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond,
      audioBitsPerSecond,
    });

    const chunks: BlobPart[] = [];
    const stopPromise = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder!.onerror = (event) => {
        const recorderError = event.error ?? new Error("浏览器原生 WebM 转码失败。");
        reject(recorderError);
      };
      recorder!.onstop = () => {
        resolve(new Blob(chunks, { type: "video/webm" }));
      };
    });

    const duration = sourceMetadata.duration ?? video.duration ?? 0;
    progressTimer = window.setInterval(() => {
      if (!duration || !Number.isFinite(duration) || duration <= 0) return;
      const percent = Math.max(12, Math.min(98, Math.round((video.currentTime / duration) * 100)));
      options.onProgress?.(percent);
    }, 120);

    video.currentTime = 0;
    recorder.start(250);

    const handleEnded = () => {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    };
    video.addEventListener("ended", handleEnded, { once: true });

    try {
      await video.play();
    } catch {
      video.muted = true;
      await video.play();
    }

    const outputBlob = await stopPromise;
    window.clearInterval(progressTimer);
    progressTimer = 0;

    if (outputBlob.size === 0) {
      throw new Error("浏览器原生回退转码未生成有效的 WebM 数据。");
    }

    if (options.maxOutputSizeBytes && outputBlob.size > options.maxOutputSizeBytes) {
      throw new Error(
        `浏览器原生回退转码后的文件超过 ${Math.round(options.maxOutputSizeBytes / 1024 / 1024)} MB，请缩短视频时长后重试。`,
      );
    }

    options.onProgress?.(100);
    setRuntimeModeDescription("当前使用浏览器原生 MediaRecorder 回退模式");

    return new File([outputBlob], normalizeWebMName(sourceFile.name), {
      type: "video/webm",
      lastModified: Date.now(),
    });
  } finally {
    if (progressTimer) {
      window.clearInterval(progressTimer);
    }
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (stream) {
      stopMediaStream(stream);
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(videoUrl);
  }
}

export function canConvertVideoToWebM(): boolean {
  if (typeof window === "undefined") return false;
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

export async function convertVideoToWebM(
  sourceFile: File,
  options: ConvertVideoToWebMOptions = {},
): Promise<File> {
  if (sourceFile.type === "video/webm" && sourceFile.name.toLowerCase().endsWith(".webm")) {
    return sourceFile;
  }

  if (!canConvertVideoToWebM()) {
    throw new Error("当前浏览器环境不支持 ffmpeg.wasm 转码，请使用较新的 Chromium 或 Edge。");
  }

  const sourceMetadata = await getVideoFileMetadata(sourceFile);
  const duration = sourceMetadata.duration;
  if (!duration) {
    throw new Error("无法读取原视频时长，不能转换为 WebM。");
  }

  const maxDuration = options.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS;
  if (duration > maxDuration) {
    throw new Error(`视频时长超过 ${maxDuration} 秒，建议先裁剪后再转换。`);
  }

  options.onProgress?.(1);

  const ffmpeg = await getFFmpeg();
  options.onProgress?.(4);

  const guessedBitrate = estimateSourceBitrate(sourceFile, duration, options.maxOutputSizeBytes);
  const requestedVideoBitsPerSecond = options.videoBitsPerSecond ?? guessedBitrate.videoBitsPerSecond ?? DEFAULT_VIDEO_BITS_PER_SECOND;
  const videoBitsPerSecond = Math.min(
    ffmpegMode === SINGLE_THREAD_MODE ? SINGLE_THREAD_MAX_VIDEO_BITS_PER_SECOND : MAX_VIDEO_BITS_PER_SECOND,
    requestedVideoBitsPerSecond,
  );
  const audioBitsPerSecond = options.audioBitsPerSecond
    ?? guessedBitrate.audioBitsPerSecond
    ?? DEFAULT_AUDIO_BITS_PER_SECOND;
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const scaleArgs = buildScaleArgs(sourceMetadata.width, sourceMetadata.height, maxDimension);
  const inputName = createTempFileName("source", sourceFile.name);
  const outputName = normalizeWebMName(createTempFileName("output", sourceFile.name));

  let progressHandler: ((event: { progress: number }) => void) | null = null;
  let logHandler: ((event: { message: string }) => void) | null = null;
  const recentLogs: string[] = [];

  try {
    progressHandler = ({ progress }) => {
      options.onProgress?.(Math.max(8, Math.min(99, Math.round(progress * 100))));
    };

    logHandler = ({ message }) => {
      if (!message) return;
      recentLogs.push(message);
      if (recentLogs.length > 30) {
        recentLogs.shift();
      }

      const encodedSeconds = parseEncodedTimeSeconds(message);
      if (encodedSeconds && duration > 0) {
        const percent = Math.max(8, Math.min(99, Math.round((encodedSeconds / duration) * 100)));
        options.onProgress?.(percent);
      }
    };

    ffmpeg.on("progress", progressHandler);
    ffmpeg.on("log", logHandler);

    await ffmpeg.writeFile(inputName, await fetchFile(sourceFile));
    options.onProgress?.(8);

    const videoCodec = getCurrentVideoCodec();
    const exitCode = await ffmpeg.exec([
      "-i",
      inputName,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      ...scaleArgs,
      "-c:v",
      videoCodec,
      "-pix_fmt",
      "yuv420p",
      "-deadline",
      videoCodec === "libvpx-vp9" ? "good" : "realtime",
      "-cpu-used",
      videoCodec === "libvpx-vp9" ? "2" : "8",
      ...(videoCodec === "libvpx-vp9" ? ["-row-mt", "1"] : []),
      ...(videoCodec === "libvpx" ? ["-quality", "good", "-speed", "8", "-threads", "1"] : []),
      "-b:v",
      toKiloBitsPerSecond(videoBitsPerSecond),
      "-c:a",
      "libopus",
      "-b:a",
      toKiloBitsPerSecond(audioBitsPerSecond),
      "-vsync",
      "0",
      outputName,
    ]);

    if (exitCode !== 0) {
      const logTail = recentLogs.slice(-8).join("\n");
      throw new Error(logTail ? `FFmpeg 编码失败:\n${logTail}` : `FFmpeg 编码失败，退出码 ${exitCode}`);
    }

    const outputData = resolveOutputBuffer(await ffmpeg.readFile(outputName));
    const outputCopy = new Uint8Array(outputData.byteLength);
    outputCopy.set(outputData);
    const outputBlob = new Blob([outputCopy], { type: "video/webm" });
    if (outputBlob.size === 0) {
      throw new Error("未生成有效的 WebM 数据。");
    }

    if (options.maxOutputSizeBytes && outputBlob.size > options.maxOutputSizeBytes) {
      throw new Error(
        `转换后文件超过 ${Math.round(options.maxOutputSizeBytes / 1024 / 1024)} MB，请缩短视频时长或降低码率后重试。`,
      );
    }

    options.onProgress?.(100);
    syncRuntimeModeDescriptionFromFFmpeg();

    return new File([outputBlob], normalizeWebMName(sourceFile.name), {
      type: "video/webm",
      lastModified: Date.now(),
    });
  } catch (error) {
    if (shouldFallbackToNativeRecorder(error) && canUseNativeRecorderFallback()) {
      try {
        return await convertVideoToWebMWithMediaRecorder(sourceFile, sourceMetadata, options);
      } catch (fallbackError) {
        const primaryMessage = describeUnknownError(error);
        const fallbackMessage = describeUnknownError(fallbackError);
        throw new Error(
          `FFmpeg.wasm 转码失败，浏览器原生回退也失败。\n主错误: ${primaryMessage}\n回退错误: ${fallbackMessage}`,
        );
      }
    }

    const message = describeUnknownError(error);
    const logTail = recentLogs.slice(-12).join("\n").trim();
    if (logTail && !message.includes(logTail)) {
      throw new Error(`${message}\n\nFFmpeg 日志:\n${logTail}`);
    }
    throw new Error(message);
  } finally {
    if (progressHandler) {
      ffmpeg.off("progress", progressHandler);
    }
    if (logHandler) {
      ffmpeg.off("log", logHandler);
    }
    await Promise.allSettled([
      safeDeleteFile(ffmpeg, inputName),
      safeDeleteFile(ffmpeg, outputName),
    ]);
  }
}
