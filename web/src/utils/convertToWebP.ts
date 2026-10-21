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
 * 画布像素硬上限（约 4096×4096）。
 *
 * 为什么要这个：手机原图动辄 4000×3000（12MP），全尺寸建画布 = 位图 48MB
 * + canvas 48MB + 编码缓冲，Chrome 移动端渲染进程常直接被 OOM 杀掉，
 * 用户看到的是「选完文件页面自己刷新了」。调用方忘了传 maxWidth 时，
 * 这里必须兜住，宁可降分辨率也不能让页面崩。
 */
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

/** 只取尺寸（不建位图）：<img> 的自然尺寸基本在解析头部时就有了，比整图解码省得多。 */
function measureImage(blob: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(url);
            fn();
        };
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const size = {
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
            };
            finish(() => resolve(size));
        };
        img.onerror = () => finish(() => reject(new Error('Failed to measure image')));
        img.src = url;
    });
}

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

/** 把目标尺寸压到 MAX_CANVAS_PIXELS 以内（等比），防止画布本身把渲染进程撑爆。 */
function clampPixels(w: number, h: number) {
    const pixels = w * h;
    if (pixels <= MAX_CANVAS_PIXELS) return { w, h };
    const scale = Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function closeDrawable(drawable: ImageBitmap | HTMLImageElement) {
    try {
        const bitmap = drawable as ImageBitmap;
        if (typeof bitmap.close === 'function') bitmap.close();
    } catch {
        // ignore
    }
}

type Drawable = {
    drawable: ImageBitmap | HTMLImageElement;
    width: number;
    height: number;
    dispose: () => void;
};

/**
 * 准备一个「适合画进画布」的图源。
 *
 * 关键点：需要缩小时优先用 `createImageBitmap(blob, { resizeWidth/resizeHeight })`，
 * 让浏览器**在解码阶段就缩**。否则会同时持有「原尺寸位图 + 原尺寸画布」两份大内存，
 * 手机端（尤其 12MP 以上原图）渲染进程很容易被 OOM 杀掉 ——
 * 用户看到的现象就是「选完文件，页面自己刷新了」。
 */
async function decodeForDraw(blob: Blob, maxWidth?: number, maxHeight?: number): Promise<Drawable> {
    let sourceSize: { width: number; height: number } | null = null;
    try {
        sourceSize = await measureImage(blob);
    } catch {
        sourceSize = null;
    }

    // 尺寸量不出来（例如没有固有尺寸的 SVG）：退回整图解码，解码后再算目标尺寸
    if (!sourceSize || !sourceSize.width || !sourceSize.height) {
        const decoded = await createImageBitmapOrElement(blob);
        const w = Number((decoded as unknown as { width?: number }).width) || 0;
        const h = Number((decoded as unknown as { height?: number }).height) || 0;
        if (!w || !h) {
            closeDrawable(decoded);
            throw new Error('Image size is invalid');
        }
        const sized = calcSize(w, h, maxWidth, maxHeight);
        const target = clampPixels(sized.w, sized.h);
        return {
            drawable: decoded,
            width: target.w,
            height: target.h,
            dispose: () => closeDrawable(decoded),
        };
    }

    const sized = calcSize(sourceSize.width, sourceSize.height, maxWidth, maxHeight);
    const target = clampPixels(sized.w, sized.h);
    const needDownscale = target.w !== sourceSize.width || target.h !== sourceSize.height;

    if (needDownscale && typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(blob, {
                resizeWidth: target.w,
                resizeHeight: target.h,
                resizeQuality: 'high',
            });
            // 个别内核对「resize + EXIF 方向」的组合有 bug，解出来的尺寸对不上就退回去，
            // 否则会把照片拉变形。
            const sizeOk = Math.abs(bitmap.width - target.w) <= 2 && Math.abs(bitmap.height - target.h) <= 2;
            if (!sizeOk) {
                closeDrawable(bitmap);
            } else {
                return {
                    drawable: bitmap,
                    width: target.w,
                    height: target.h,
                    dispose: () => closeDrawable(bitmap),
                };
            }
        } catch {
            // 有些不支持 resize 选项的内核会抛错，落到下面的整图路径
        }
    }

    const decoded = await createImageBitmapOrElement(blob);
    return {
        drawable: decoded,
        width: target.w,
        height: target.h,
        dispose: () => closeDrawable(decoded),
    };
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
    const source = await decodeForDraw(blob, maxWidth, maxHeight);

    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        source.dispose();
        throw new Error('Canvas 2D context not available');
    }

    try {
        ctx.drawImage(source.drawable as CanvasImageSource, 0, 0, source.width, source.height);

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
    } finally {
        // 尽最大努力立刻归还内存：大画布 + 大位图是移动端崩溃的主要来源
        source.dispose();
        canvas.width = 0;
        canvas.height = 0;
    }
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
