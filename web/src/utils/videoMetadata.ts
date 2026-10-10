export interface VideoFileMetadata {
  fileName: string;
  mimeType: string;
  size: number;
  extension: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  averageBitrate: number | null;
}

function getFileExtension(fileName: string): string {
  const extension = fileName.split(".").pop()?.trim().toLowerCase();
  return extension || "--";
}

function resolveAverageBitrate(size: number, duration: number | null): number | null {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.round((size * 8) / duration);
}

export function getVideoFileMetadata(file: File): Promise<VideoFileMetadata> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.ontimeupdate = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      const safeDuration = duration && Number.isFinite(duration) && duration > 0 ? duration : null;
      resolve({
        fileName: file.name,
        mimeType: file.type || "video/*",
        size: file.size,
        extension: getFileExtension(file.name),
        duration: safeDuration,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        averageBitrate: resolveAverageBitrate(file.size, safeDuration),
      });
      cleanup();
    };

    const resolveFiniteDuration = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        finish(video.duration);
        return;
      }

      if (video.duration === Number.POSITIVE_INFINITY) {
        const fallbackTimer = window.setTimeout(() => finish(video.currentTime || null), 1500);
        video.ontimeupdate = () => {
          window.clearTimeout(fallbackTimer);
          const duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
          finish(duration || null);
        };

        try {
          video.currentTime = 1e101;
        } catch {
          window.clearTimeout(fallbackTimer);
          finish(null);
        }
        return;
      }

      finish(null);
    };

    video.onloadedmetadata = resolveFiniteDuration;
    video.onerror = () => finish(null);
    video.preload = "metadata";
    video.src = url;
  });
}
