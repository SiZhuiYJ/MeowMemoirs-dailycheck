import { canEncode, encode, type EncodeOptions, type VideoFile } from 'webcodecs-encoder';

export interface ConversionOptions {
    quality: 'lossless' | 'high' | 'medium' | 'low';
    onProgress?: (percent: number) => void;
    sourceBitRate?: number;
    sourceDuration?: number;
    sourceHasAudio?: boolean;
}

type WebCodecsWindow = Window & {
    __WEBCODECS_WORKER_URL__?: string;
};

interface BitrateProfile {
    videoBitrate: number;
    audioBitrate: number;
    cpuUsed: number;
    deadline: 'good' | 'realtime';
}

type CaptureVideoElement = HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
};

function getPublicAssetUrl(path: string): string {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    return new URL(path.replace(/^\/+/, ''), base).toString();
}

function configureWebCodecsWorker(): void {
    if (typeof window === 'undefined') return;
    (window as WebCodecsWindow).__WEBCODECS_WORKER_URL__ = getPublicAssetUrl('webcodecs/webcodecs-worker.js');
}

function toVideoFile(file: File): VideoFile {
    return {
        file,
        type: file.type || 'video/mp4',
    };
}

function toBlobPart(data: Uint8Array | string): BlobPart {
    if (typeof data === 'string') {
        return data;
    }

    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
}

function toKiloBitsPerSecond(value: number): string {
    return `${Math.max(1, Math.round(value / 1000))}k`;
}

function estimateSourceBitrate(file: File, options: ConversionOptions): number {
    if (typeof options.sourceBitRate === 'number' && options.sourceBitRate > 0) {
        return options.sourceBitRate;
    }

    if (typeof options.sourceDuration === 'number' && options.sourceDuration > 0) {
        return Math.max(180_000, Math.round((file.size * 8) / options.sourceDuration));
    }

    return 500_000;
}

function getBitrateProfile(file: File, options: ConversionOptions): BitrateProfile {
    const estimatedSourceBitrate = estimateSourceBitrate(file, options);
    const presets: Record<ConversionOptions['quality'], Omit<BitrateProfile, 'videoBitrate'>> = {
        low: {
            audioBitrate: 48_000,
            cpuUsed: 5,
            deadline: 'realtime',
        },
        medium: {
            audioBitrate: 64_000,
            cpuUsed: 4,
            deadline: 'good',
        },
        high: {
            audioBitrate: 96_000,
            cpuUsed: 3,
            deadline: 'good',
        },
        lossless: {
            audioBitrate: 128_000,
            cpuUsed: 2,
            deadline: 'good',
        },
    };

    const bitrateMultipliers: Record<ConversionOptions['quality'], number> = {
        low: 0.65,
        medium: 0.85,
        high: 1,
        lossless: 1.2,
    };

    const bitrateMinimums: Record<ConversionOptions['quality'], number> = {
        low: 180_000,
        medium: 260_000,
        high: 350_000,
        lossless: 500_000,
    };

    const bitrateMaximums: Record<ConversionOptions['quality'], number> = {
        low: 500_000,
        medium: 900_000,
        high: 1_400_000,
        lossless: 2_200_000,
    };

    const videoBitrate = Math.max(
        bitrateMinimums[options.quality],
        Math.min(
            bitrateMaximums[options.quality],
            Math.round(estimatedSourceBitrate * bitrateMultipliers[options.quality]),
        ),
    );

    return {
        videoBitrate,
        ...presets[options.quality],
    };
}

function createWebCodecsOptions(file: File, options: ConversionOptions): EncodeOptions {
    const profile = getBitrateProfile(file, options);

    return {
        container: 'webm',
        video: {
            codec: 'vp9',
            codecString: 'vp09.00.10.08',
            hardwareAcceleration: 'prefer-software',
            bitrate: profile.videoBitrate,
        },
        audio: false,
        onProgress: (info) => {
            options.onProgress?.(Math.max(0, Math.min(100, Math.round(info.percent))));
        },
    };
}

function describeUnknownError(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    if (typeof error === 'string' && error.trim()) {
        return error;
    }

    if (error && typeof error === 'object') {
        const message = Reflect.get(error, 'message');
        if (typeof message === 'string' && message.trim()) {
            return message;
        }
    }

    return 'Video conversion failed';
}

function shouldFallbackToNativeRecorder(error: unknown): boolean {
    const message = describeUnknownError(error).toLowerCase();
    return (
        message.includes('memory access out of bounds')
        || message.includes('bad memory')
        || message.includes('out of memory')
        || message.includes('runtimeerror')
        || message.includes('abort(')
    );
}

function pickSupportedRecorderMimeType(sourceHasAudio?: boolean): string | null {
    const candidates = sourceHasAudio === false
        ? [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
        ]
        : [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp8',
            'video/webm',
        ];

    for (const mimeType of candidates) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }
    }

    return null;
}

function getCaptureStream(video: CaptureVideoElement): MediaStream | null {
    if (typeof video.captureStream === 'function') {
        return video.captureStream();
    }

    if (typeof video.mozCaptureStream === 'function') {
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
            reject(new Error('Failed to load source video metadata'));
        };
    });
}

function stopMediaStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
        track.stop();
    }
}

async function convertWithMediaRecorder(
    file: File,
    options: ConversionOptions = { quality: 'high' }
): Promise<Blob> {
    if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorder fallback is not available in this browser');
    }

    const mimeType = pickSupportedRecorderMimeType(options.sourceHasAudio);
    if (!mimeType) {
        throw new Error('No supported MediaRecorder WebM mime type was found');
    }

    const profile = getBitrateProfile(file, options);
    const sourceUrl = URL.createObjectURL(file);
    const video = document.createElement('video') as CaptureVideoElement;
    video.preload = 'auto';
    video.playsInline = true;
    video.controls = false;
    video.src = sourceUrl;

    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let progressTimer = 0;

    try {
        options.onProgress?.(12);
        await waitForVideoMetadata(video);

        stream = getCaptureStream(video);
        if (!stream) {
            throw new Error('captureStream is not supported for MediaRecorder fallback');
        }

        recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: profile.videoBitrate,
            audioBitsPerSecond: options.sourceHasAudio === false ? undefined : profile.audioBitrate,
        });

        const chunks: BlobPart[] = [];
        const stopPromise = new Promise<Blob>((resolve, reject) => {
            recorder!.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            recorder!.onerror = (event) => {
                reject(event.error ?? new Error('MediaRecorder fallback failed'));
            };

            recorder!.onstop = () => {
                resolve(new Blob(chunks, { type: 'video/webm' }));
            };
        });

        const duration = typeof options.sourceDuration === 'number' && options.sourceDuration > 0
            ? options.sourceDuration
            : video.duration;

        progressTimer = window.setInterval(() => {
            if (!duration || !Number.isFinite(duration) || duration <= 0) return;
            const percent = Math.max(12, Math.min(98, Math.round((video.currentTime / duration) * 100)));
            options.onProgress?.(percent);
        }, 150);

        recorder.start(250);

        video.addEventListener('ended', () => {
            if (recorder && recorder.state !== 'inactive') {
                recorder.stop();
            }
        }, { once: true });

        try {
            await video.play();
        } catch {
            video.muted = true;
            await video.play();
        }

        const outputBlob = await stopPromise;
        options.onProgress?.(100);

        if (outputBlob.size === 0) {
            throw new Error('MediaRecorder fallback produced an empty file');
        }

        return outputBlob;
    } finally {
        if (progressTimer) {
            window.clearInterval(progressTimer);
        }

        if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
        }

        if (stream) {
            stopMediaStream(stream);
        }

        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(sourceUrl);
    }
}

export async function convertWithWebCodecs(
    file: File,
    options: ConversionOptions = { quality: 'high' }
): Promise<Blob> {
    configureWebCodecsWorker();

    const result = await encode(toVideoFile(file), createWebCodecsOptions(file, options));
    return new Blob([toBlobPart(result)], { type: 'video/webm' });
}

function getFFmpegAssetUrl(fileName: string): string {
    return getPublicAssetUrl(`ffmpeg/${fileName}`);
}

function buildFFmpegArgs(file: File, options: ConversionOptions): string[] {
    const profile = getBitrateProfile(file, options);
    const args = [
        '-i', 'input.mp4',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libvpx-vp9',
        '-pix_fmt', 'yuv420p',
        '-b:v', toKiloBitsPerSecond(profile.videoBitrate),
        '-maxrate', toKiloBitsPerSecond(profile.videoBitrate),
        '-bufsize', toKiloBitsPerSecond(profile.videoBitrate * 2),
        '-deadline', 'realtime',
        '-cpu-used', String(Math.max(profile.cpuUsed, 4)),
        '-row-mt', '1',
        '-threads', '1',
    ];

    if (options.sourceHasAudio === false) {
        args.push('-an');
    } else {
        args.push('-c:a', 'libopus', '-b:a', toKiloBitsPerSecond(profile.audioBitrate));
    }

    args.push('output.webm');
    return args;
}

export async function convertWithFFmpeg(
    file: File,
    options: ConversionOptions = { quality: 'high' }
): Promise<Blob> {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { fetchFile, toBlobURL } = await import('@ffmpeg/util');

    const ffmpeg = new FFmpeg();

    await ffmpeg.load({
        coreURL: await toBlobURL(getFFmpegAssetUrl('ffmpeg-core.js'), 'text/javascript'),
        wasmURL: await toBlobURL(getFFmpegAssetUrl('ffmpeg-core.wasm'), 'application/wasm'),
        workerURL: await toBlobURL(getFFmpegAssetUrl('ffmpeg-core.worker.js'), 'text/javascript'),
    });

    ffmpeg.on('progress', ({ progress }) => {
        options.onProgress?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
    });

    ffmpeg.on('log', ({ message }: { message: string }) => console.log('[FFmpeg LOG]', message));

    try {
        await ffmpeg.writeFile('input.mp4', await fetchFile(file));
        await ffmpeg.exec(buildFFmpegArgs(file, options));

        const data = await ffmpeg.readFile('output.webm');
        await ffmpeg.deleteFile('input.mp4');
        await ffmpeg.deleteFile('output.webm');

        return new Blob([toBlobPart(data)], { type: 'video/webm' });
    } catch (error) {
        await ffmpeg.deleteFile('input.mp4').catch(() => { });
        await ffmpeg.deleteFile('output.webm').catch(() => { });
        throw error;
    }
}

async function checkWebCodecsSupport(): Promise<boolean> {
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
        return false;
    }

    try {
        configureWebCodecsWorker();
        return await canEncode({
            container: 'webm',
            video: {
                codec: 'vp9',
                hardwareAcceleration: 'prefer-software',
                bitrate: 350_000,
            },
            audio: false,
        });
    } catch {
        return false;
    }
}

export async function convertVideo(
    file: File,
    options: ConversionOptions = { quality: 'high' }
): Promise<Blob> {
    const supportsWebCodecs = await checkWebCodecsSupport();
    const shouldUseWebCodecs = supportsWebCodecs && options.sourceHasAudio === false;

    console.log(`WebCodecs support: ${supportsWebCodecs}`);
    console.log(`Source has audio: ${options.sourceHasAudio ?? 'unknown'}`);

    if (shouldUseWebCodecs) {
        try {
            console.log('Using WebCodecs conversion');
            return await convertWithWebCodecs(file, options);
        } catch (error) {
            console.warn('WebCodecs conversion failed, falling back to ffmpeg.wasm:', error);
        }
    }

    try {
        console.log('Using ffmpeg.wasm conversion');
        return await convertWithFFmpeg(file, options);
    } catch (error) {
        if (shouldFallbackToNativeRecorder(error)) {
            console.warn('ffmpeg.wasm conversion failed, falling back to MediaRecorder:', error);
            return await convertWithMediaRecorder(file, options);
        }

        throw error;
    }
}
