/**
 * 图片转换工具：将各种图片格式转换为 WebP
 *
 * 特性：
 * - 接受 `File | Blob | string(URL)` 作为输入
 * - 支持设置 `quality`（0-1）和 `maxWidth` / `maxHeight`，保留宽高比
 * - 支持返回 `Blob`、`DataURL` 或 `File`
 *
 * 限制：
 * - 浏览器端实现依赖 canvas，不能保留 GIF 的动画帧（会只取第一帧）
 * - 跨域图片需要服务器设置 `Access-Control-Allow-Origin`，否则可能无法绘制到 canvas
 */
export type ConvertOptions = {
    quality?: number; // 0 - 1
    maxWidth?: number;
    maxHeight?: number;
    output?: 'blob' | 'dataURL' | 'file';
    fileName?: string; // used when output==='file'
};

export type ExtractVideoFrameOptions = ConvertOptions & {
    onProgress?: (progress: number) => void;
};
/**
 * 获取 Blob 对象，如果 input 是 URL，则从 URL 获取 Blob
 * @param input - File | Blob | string (URL)
 * @returns Promise<Blob> - 获取到的 Blob 对象
 */
async function fetchToBlobIfNeeded(input: File | Blob | string): Promise<Blob> {
    if (typeof input === 'string') {
        const res = await fetch(input);
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
        return await res.blob();
    }
    return input as Blob;
}

/**
 * 创建 ImageBitmap 或 HTMLImageElement
 * @param blob - Blob 对象
 * @returns Promise<ImageBitmap | HTMLImageElement> - 创建的 ImageBitmap 或 HTMLImageElement
 */
async function createImageBitmapOrElement(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
    // Prefer createImageBitmap when available (faster, handles orientation better in some browsers)
    if (typeof createImageBitmap === 'function') {
        try {
            return await createImageBitmap(blob);
        } catch (e) {
            // fallback to Image element
        }
    }

    return await new Promise<HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image element'));
        };
        img.src = url;
    });
}

/**
 * 计算调整后的宽高，保持宽高比
 * @param srcWidth - 原始宽度
 * @param srcHeight - 原始高度
 * @param maxWidth - 最大宽度
 * @param maxHeight - 最大高度
 * @returns { w: number, h: number } - 调整后的宽高
 */
function calcSize(srcWidth: number, srcHeight: number, maxWidth?: number, maxHeight?: number) {
    let w = srcWidth;
    let h = srcHeight;
    if (maxWidth && w > maxWidth) {
        const ratio = maxWidth / w;
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
    }
    if (maxHeight && h > maxHeight) {
        const ratio = maxHeight / h;
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
    }
    return { w, h };
}

/**
 * 将图片转换为 WebP（返回 Blob）
 * @param input - File | Blob | string (URL)
 * @param options - 转换选项
 * @returns Promise<Blob> - 转换后的 WebP Blob
 */
export async function convertToWebPBlob(input: File | Blob | string, options: ConvertOptions = {}): Promise<Blob> {
    const { quality = 0.8, maxWidth, maxHeight } = options;
    const blob = await fetchToBlobIfNeeded(input);

    // For GIFs: canvas will draw only the first frame (animated GIFs will be flattened)
    const imageOrBitmap = await createImageBitmapOrElement(blob);

    let srcWidth: number, srcHeight: number;
    if ('width' in imageOrBitmap && 'height' in imageOrBitmap) {
        srcWidth = (imageOrBitmap as any).width;
        srcHeight = (imageOrBitmap as any).height;
    } else {
        // Fallback: use blob URL to measure
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Failed to measure image'));
            img.src = url;
        });
        srcWidth = img.width;
        srcHeight = img.height;
        URL.revokeObjectURL(url);
    }

    const { w, h } = calcSize(srcWidth, srcHeight, maxWidth, maxHeight);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');

    // draw using ImageBitmap or HTMLImageElement
    if ((imageOrBitmap as ImageBitmap).close) {
        // ImageBitmap
        ctx.drawImage(imageOrBitmap as ImageBitmap, 0, 0, w, h);
        try {
            // close imageBitmap to free memory
            (imageOrBitmap as ImageBitmap).close();
        } catch (e) { }
    } else {
        ctx.drawImage(imageOrBitmap as HTMLImageElement, 0, 0, w, h);
    }

    return await new Promise<Blob>((resolve, reject) => {
        // toBlob supports 'image/webp' in modern browsers
        canvas.toBlob(
            (b) => {
                if (!b) reject(new Error('Conversion to WebP failed'));
                else resolve(b);
            },
            'image/webp',
            Math.max(0, Math.min(1, quality))
        );
    });
}

/**
 * 主函数：根据 options.output 返回不同类型
 * @param input - File | Blob | string (URL)
 * @param options - 转换选项，包含 output 类型和 fileName（当 output==='file' 时使用）
 * @returns Promise<Blob | string | File> - 根据 output 返回 Blob、DataURL 或 File
 */
export async function convertToWebP(input: File | Blob | string, options: ConvertOptions = {}): Promise<Blob | string | File> {
    const { output = 'blob', fileName = 'image.webp' } = options;
    const blob = await convertToWebPBlob(input, options);
    if (output === 'blob') return blob;
    if (output === 'dataURL') {
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read blob as DataURL'));
            reader.readAsDataURL(blob);
        });
    }
    // file
    return new File([blob], fileName, { type: 'image/webp' });
}

/**
 * 从视频中抽取随机帧并转换为 WebP
 * @param videoFile - 视频文件
 * @param options - 转换选项
 * @returns Promise<File> - 转换后的 WebP 封面文件
 */
export async function extractVideoFrameToWebP(
    videoFile: File,
    options: ExtractVideoFrameOptions = {}
): Promise<File> {
    const { quality = 0.8, maxWidth, maxHeight, fileName = 'video-cover.webp', onProgress } = options;

    return new Promise<File>((resolve, reject) => {
        const videoUrl = URL.createObjectURL(videoFile);
        const video = document.createElement('video');
        let settled = false;
        const reportProgress = (progress: number) => {
            onProgress?.(Math.max(0, Math.min(100, progress)));
        };

        const cleanup = () => {
            URL.revokeObjectURL(videoUrl);
        };

        const rejectOnce = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };

        const resolveFromCurrentFrame = () => {
            if (settled) return;
            // 等待浏览器真正渲染到当前帧，避免拿到透明画面
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (settled) return;
                    try {
                // 创建 canvas 并绘制当前帧
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');

                        if (!ctx) {
                            rejectOnce(new Error('Canvas 2D context not available'));
                            return;
                        }

                        // 计算尺寸
                        const srcWidth = video.videoWidth;
                        const srcHeight = video.videoHeight;
                        if (!srcWidth || !srcHeight) {
                            rejectOnce(new Error('视频尺寸无效，无法提取封面'));
                            return;
                        }
                        const { w, h } = calcSize(srcWidth, srcHeight, maxWidth, maxHeight);

                        canvas.width = w;
                        canvas.height = h;

                        // 先填充背景，避免个别浏览器拿到透明封面
                        ctx.fillStyle = '#000';
                        ctx.fillRect(0, 0, w, h);

                        // 绘制视频帧
                        ctx.drawImage(video, 0, 0, w, h);
                        reportProgress(90);

                // 转换为 WebP
                        canvas.toBlob(
                            (blob) => {
                                if (settled) return;
                                if (!blob) {
                                    rejectOnce(new Error('转换视频帧为 WebP 失败'));
                                    return;
                                }

                                // 创建 File 对象
                                const webpFile = new File([blob], fileName, {
                                    type: 'image/webp',
                                    lastModified: Date.now(),
                                });

                                settled = true;
                                reportProgress(100);
                                cleanup();
                                resolve(webpFile);
                            },
                            'image/webp',
                            Math.max(0, Math.min(1, quality))
                        );
                    } catch (error) {
                        rejectOnce(error instanceof Error ? error : new Error('提取视频帧失败'));
                    }
                });
            });
        };

        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        reportProgress(5);

        // 视频元数据加载完成
        video.addEventListener('loadedmetadata', () => {
            reportProgress(35);
            // 生成随机时间戳（避开开头和结尾）
            const duration = video.duration;
            if (!duration || !isFinite(duration)) {
                // 某些 webm 文件在 loadedmetadata 时拿不到时长，退化为首帧封面
                if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                    resolveFromCurrentFrame();
                    return;
                }
                video.currentTime = 0;
                return;
            }

            // 随机选择时间点（避开前0.5秒和后0.5秒）
            const minTime = Math.min(0.5, duration * 0.1);
            const maxTime = Math.max(duration - 0.5, duration * 0.9);
            const randomTime = minTime + Math.random() * (maxTime - minTime);

            reportProgress(55);
            video.currentTime = randomTime;
        });

        // 视频跳转到指定时间点
        video.addEventListener('seeked', resolveFromCurrentFrame);
        // 兼容无法 seek 的流式/特殊 webm，回退到当前可用帧
        video.addEventListener('loadeddata', resolveFromCurrentFrame);

        // 错误处理
        video.addEventListener('error', () => {
            rejectOnce(new Error('加载视频失败'));
        });

        // 设置视频源
        video.src = videoUrl;
    });
}

/**
 * Usage example:
 *
 * const fileInput = document.querySelector('input[type=file]');
 * fileInput.onchange = async () => {
 *   const file = fileInput.files[0];
 *   const webpBlob = await convertToWebP(file, { quality: 0.9, maxWidth: 1200 });
 *   // upload webpBlob or create URL: URL.createObjectURL(webpBlob)
 * }
 */

export default convertToWebP;
