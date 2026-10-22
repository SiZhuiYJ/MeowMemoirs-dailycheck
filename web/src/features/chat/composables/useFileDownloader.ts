import { reactive } from "vue";
import http from "@/libs/http/file";
import { useAuthStore } from "@/features/auth/stores";
import type { AxiosProgressEvent } from "axios";

interface QueueItem {
    fileKey: string;
    category: string;
    thumbnailUrl?: string;
    priorityId?: number;
    onProgress?: (progress: number) => void;
    onComplete: (blobUrl: string) => void;
    onThumbnailComplete?: (blobUrl: string) => void;
    onError: (error: Error) => void;
}

/**
 * 同一个 fileKey 的**一次**下载 = 一个组，组里可以挂多个调用方。
 *
 * ⚠️ 历史教训，别改回「已存在就 return」：
 * 旧实现用 `queue.some(task => task.item.fileKey === fileKey)` 去重，命中就直接返回，
 * 于是**第二个调用方的 onComplete / onError 永远不会被调用**。聊天页里同一条图片消息
 * 经常有两个组件同时要它（刚落地的确认消息 + 上传结束后的首帧渲染），谁先谁后不确定，
 * 被判重丢掉的那个就一直等在那里 —— 界面上就是「图片卡在准备中」。
 *
 * 现在：重复请求挂进同一组，下载结束（或失败）时组里**每个**调用方都收到回调。
 */
interface DownloadGroup {
    fileKey: string;
    /** 第一个调用方，缩略图 / 进度回调按它的参数来（其余调用方只是搭车）。 */
    items: QueueItem[];
    priorityScore: number;
    sequence: number;
}

interface BlobUrlRequest {
    onComplete: (blobUrl: string) => void;
    onError: (error: Error) => void;
    isNew?: boolean;
    priorityId?: number;
}

const downloadedBlobs = reactive<Record<string, string>>({});
const queue = reactive<DownloadGroup[]>([]);
/** 正在下载的组（按 fileKey）：后来的重复请求挂到这里，而不是排队再下一次。 */
const runningGroups = new Map<string, DownloadGroup>();
let activeDownloads = 0;
let queueSequence = 0;

// 带宽受限（1MB/s）时，串行下载可降低抢占与抖动
const maxConcurrentDownloads = 1;
const maxRetries = 2;
const retryDelayMs = 800;

async function downloadWithRetry(
    url: string,
    onProgress?: (progress: number) => void,
    retries = maxRetries,
): Promise<Blob> {
    try {
        return await downloadFile(url, onProgress);
    } catch (error) {
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            return downloadWithRetry(url, onProgress, retries - 1);
        }
        throw error;
    }
}

export function getAuthHeaders(): Record<string, string> {
    const token = useAuthStore().accessToken;
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function downloadFile(
    url: string,
    onProgress?: (progress: number) => void,
): Promise<Blob> {
    const response = await http.get(url, {
        responseType: "blob",
        headers: getAuthHeaders(),
        onDownloadProgress: (event: AxiosProgressEvent) => {
            if (!onProgress || !event.total) return;
            const percentage = Math.min(
                100,
                Math.round((event.loaded / event.total) * 100),
            );
            onProgress(percentage);
        },
    });
    if (response.status !== 200) {
        throw new Error(
            `Failed to download file: ${response.status} ${response.statusText}`,
        );
    }
    return response.data as Blob;
}

/** 把结果发给组里的每个调用方：一个回调抛错不能连累其它调用方。 */
function settleGroup(group: DownloadGroup, blobUrl: string | null, error: Error | null) {
    for (const item of group.items) {
        try {
            if (error) {
                item.onError(error);
            } else if (blobUrl) {
                item.onProgress?.(100);
                item.onComplete(blobUrl);
            }
        } catch (callbackError) {
            console.error(`Download callback failed for ${item.fileKey}:`, callbackError);
        }
    }
}

async function processQueue() {
    if (activeDownloads >= maxConcurrentDownloads || queue.length === 0) {
        return;
    }

    activeDownloads++;

    let selectedIndex = 0;
    for (let i = 1; i < queue.length; i++) {
        const current = queue[i]!;
        const selected = queue[selectedIndex]!;
        if (
            current.priorityScore > selected.priorityScore ||
            (current.priorityScore === selected.priorityScore &&
                current.sequence < selected.sequence)
        ) {
            selectedIndex = i;
        }
    }
    const group = queue.splice(selectedIndex, 1)[0];

    if (!group) {
        activeDownloads--;
        return;
    }

    runningGroups.set(group.fileKey, group);

    // 缩略图 / 进度回调只认第一个调用方的参数，后来的调用方是搭车
    const leader = group.items[0];
    const category = leader?.category;
    const thumbnailUrl = leader?.thumbnailUrl;
    const onProgress = leader?.onProgress;

    const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
    const normalizedBaseUrl = baseUrl.endsWith("/")
        ? baseUrl.slice(0, -1)
        : baseUrl;

    try {
        // --- Thumbnail Handling ---
        const needsThumbnail = Boolean(
            leader?.onThumbnailComplete && category === "video" && thumbnailUrl,
        );

        if (needsThumbnail && thumbnailUrl) {
            const thumbUrl = `${normalizedBaseUrl}/mm/files/chat/${thumbnailUrl}`;
            let thumbBlobUrl = downloadedBlobs[thumbnailUrl];

            if (!thumbBlobUrl) {
                const thumbBlob = await downloadWithRetry(thumbUrl);
                thumbBlobUrl = URL.createObjectURL(thumbBlob);
                downloadedBlobs[thumbnailUrl] = thumbBlobUrl;
            }

            for (const item of group.items) {
                try {
                    item.onThumbnailComplete?.(thumbBlobUrl);
                } catch (callbackError) {
                    console.error(`Thumbnail callback failed for ${item.fileKey}:`, callbackError);
                }
            }
        }

        // --- Main File Handling ---
        let blobUrl = downloadedBlobs[group.fileKey];

        if (!blobUrl) {
            const fileUrl = `${normalizedBaseUrl}/mm/files/chat/${group.fileKey}`;
            onProgress?.(0);
            const blob = await downloadWithRetry(fileUrl, onProgress);
            blobUrl = URL.createObjectURL(blob);
            downloadedBlobs[group.fileKey] = blobUrl;
        }

        settleGroup(group, blobUrl, null);
    } catch (error) {
        console.error(`Failed to download file ${group.fileKey}:`, error);
        settleGroup(group, null, error as Error);
    } finally {
        runningGroups.delete(group.fileKey);
        activeDownloads--;
        processQueue();
    }
}

/**
 * 排一个下载任务。
 *
 * 三种情况：
 *   1. 已经有缓存：立刻回调（同一个 fileKey 永远只下载一次）；
 *   2. 正在下 / 正在排队：挂进那一组，**回调一定会来**（见 DownloadGroup 的注释）；
 *   3. 全新：入队。
 */
function requestDownload(item: QueueItem, isNew: boolean) {
    const { fileKey, thumbnailUrl, category, priorityId } = item;

    const mainAssetReady = downloadedBlobs[fileKey];
    const thumbAssetReady = category !== "video" || !thumbnailUrl
        ? true
        : Boolean(downloadedBlobs[thumbnailUrl]);

    if (mainAssetReady && thumbAssetReady) {
        item.onComplete(mainAssetReady);
        const thumbKey = category === "video" ? thumbnailUrl : undefined;
        const cachedThumb = thumbKey ? downloadedBlobs[thumbKey] : undefined;
        if (cachedThumb) {
            item.onThumbnailComplete?.(cachedThumb);
        }
        return;
    }

    const runningGroup = runningGroups.get(fileKey);
    if (runningGroup) {
        runningGroup.items.push(item);
        return;
    }

    const queuedGroup = queue.find((group) => group.fileKey === fileKey);
    if (queuedGroup) {
        queuedGroup.items.push(item);
        return;
    }

    const priorityScore = priorityId ?? (isNew ? Number.MAX_SAFE_INTEGER : 0);
    const group: DownloadGroup = {
        fileKey,
        items: [item],
        priorityScore,
        sequence: queueSequence++,
    };
    queue.push(group);

    if (activeDownloads < maxConcurrentDownloads) {
        processQueue();
    }
}

/**
 * 把「本地已经有的 blob」记进缓存。
 *
 * 上传刚结束时用得上：本地那份 file 就是刚发出去的东西，直接拿来显示，
 * 不必再回头把同一个文件从服务器下一次（省一次往返，也不会先闪一下占位图）。
 *
 * @returns 是否真的写进了缓存（已有缓存时不覆盖，返回 false）
 */
export function rememberBlobUrl(fileKey: string, blobUrl: string): boolean {
    if (!fileKey || !blobUrl) return false;
    if (downloadedBlobs[fileKey]) return false;
    downloadedBlobs[fileKey] = blobUrl;
    return true;
}

function requestBlobUrl(fileKey: string, options: BlobUrlRequest) {
    requestDownload({
        fileKey,
        category: "asset",
        priorityId: options.priorityId,
        onComplete: options.onComplete,
        onError: options.onError,
    }, options.isNew ?? false);
}

async function downloadAndSaveFile(fileKey: string, fileName: string) {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
    const normalizedBaseUrl = baseUrl.endsWith("/")
        ? baseUrl.slice(0, -1)
        : baseUrl;
    const url = `${normalizedBaseUrl}/mm/files/chat/${fileKey}`;

    try {
        let blob: Blob;
        if (downloadedBlobs[fileKey]) {
            const blobUrl = downloadedBlobs[fileKey];
            const response = await fetch(blobUrl);
            blob = await response.blob();
        } else {
            ElMessage.info("开始下载...");
            blob = await downloadWithRetry(url);
        }

        const navigatorWithSave = window.navigator as Navigator & {
            msSaveOrOpenBlob?: (blob: Blob, fileName: string) => void;
        };

        if (navigatorWithSave.msSaveOrOpenBlob) {
            navigatorWithSave.msSaveOrOpenBlob(blob, fileName);
        } else {
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        }
        ElMessage.success("下载成功");
    } catch (error) {
        console.error("Download error:", error);
        ElMessage.error(`下载失败: ${(error as Error).message}`);
    }
}

export function useFileDownloader() {
    return {
        requestBlobUrl,
        requestDownload,
        downloadAndSaveFile,
        rememberBlobUrl,
    };
}
