import MediaInfoFactory, { type MediaInfo, type Track } from 'mediainfo.js';

export interface VideoMetadata {
    duration: number;
    width: number;
    height: number;
    frameRate: number;
    fileSize: number;
    codec: string;
    bitRate: number;
    audioCodec: string;
    audioSampleRate: number;
    audioChannels: number;
    pixelFormat: string;
    container: string;
}

function isVideoTrack(track: Track): track is Track & { '@type': 'Video' } {
    return track['@type'] === 'Video';
}

function isAudioTrack(track: Track): track is Track & { '@type': 'Audio' } {
    return track['@type'] === 'Audio';
}

function isGeneralTrack(track: Track): track is Track & { '@type': 'General' } {
    return track['@type'] === 'General';
}

function getPublicAssetUrl(path: string): string {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    return new URL(path.replace(/^\/+/, ''), base).toString();
}

function getContainerFromFile(file: File): string {
    const mimeType = file.type.toLowerCase();
    if (mimeType.includes('webm')) return 'WebM';
    if (mimeType.includes('mp4')) return 'MPEG-4';
    return 'Unknown';
}

function getStringValue(value: unknown, fallback = 'Unknown'): string {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }

    return fallback;
}

function getNumericValue(...values: Array<number | null | undefined>): number {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            return value;
        }
    }

    return 0;
}

function resolveAverageBitrate(fileSize: number, duration: number | undefined): number {
    if (!duration || !Number.isFinite(duration) || duration <= 0) {
        return 0;
    }

    return Math.round((fileSize * 8) / duration);
}

function getTrackField(track: Track | undefined, field: string): unknown {
    if (!track) return undefined;
    return Reflect.get(track as object, field);
}

export async function extractMetadataWithMediaInfo(file: File): Promise<VideoMetadata> {
    let mediaInfo: MediaInfo | null = null;

    try {
        mediaInfo = await MediaInfoFactory({
            format: 'object',
            locateFile: () => getPublicAssetUrl('mediainfo/MediaInfoModule.wasm'),
        });

        const getSize = () => file.size;
        const readChunk = (size: number, offset: number): Promise<Uint8Array> =>
            new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(new Uint8Array(event.target?.result as ArrayBuffer));
                reader.onerror = reject;
                reader.readAsArrayBuffer(file.slice(offset, offset + size));
            });

        const result = await mediaInfo.analyzeData(getSize, readChunk);
        const tracks = result.media?.track ?? [];

        const videoTrack = tracks.find(isVideoTrack);
        const audioTrack = tracks.find(isAudioTrack);
        const generalTrack = tracks.find(isGeneralTrack);

        return {
            duration: parseFloat(generalTrack?.Duration?.toString() ?? generalTrack?.Duration_String4?.toString() ?? '0') || 0,
            width: parseInt(videoTrack?.Width?.toString() ?? '0', 10) || 0,
            height: parseInt(videoTrack?.Height?.toString() ?? '0', 10) || 0,
            frameRate: parseFloat(videoTrack?.FrameRate?.toString() ?? videoTrack?.FrameRate_String?.toString() ?? '0') || 0,
            fileSize: file.size,
            codec: getStringValue(videoTrack?.Format ?? videoTrack?.CodecID ?? videoTrack?.CodecID_String),
            bitRate: parseInt(videoTrack?.BitRate?.toString() ?? videoTrack?.BitRate_String?.toString() ?? '0', 10) || 0,
            audioCodec: getStringValue(audioTrack?.Format ?? audioTrack?.CodecID),
            audioSampleRate: parseInt(audioTrack?.SamplingRate?.toString() ?? audioTrack?.SamplingRate_String?.toString() ?? '0', 10) || 0,
            audioChannels: parseInt(audioTrack?.Channels?.toString() ?? audioTrack?.Channels_String ?? '0', 10) || 0,
            pixelFormat: getStringValue(
                getTrackField(videoTrack, 'PixelFormat')
                ?? getTrackField(videoTrack, 'ChromaSubsampling')
                ?? getTrackField(videoTrack, 'ColorSpace'),
            ),
            container: getStringValue(generalTrack?.Format ?? generalTrack?.Format_String, getContainerFromFile(file)),
        };
    } finally {
        mediaInfo?.close?.();
    }
}

export async function extractMetadataBasic(file: File): Promise<Partial<VideoMetadata>> {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        const url = URL.createObjectURL(file);
        let settled = false;

        const cleanup = () => {
            video.onloadedmetadata = null;
            video.onerror = null;
            video.ontimeupdate = null;
            video.removeAttribute('src');
            video.load();
            URL.revokeObjectURL(url);
        };

        const finish = (duration: number | null) => {
            if (settled) return;
            settled = true;

            const safeDuration = duration && Number.isFinite(duration) && duration > 0 ? duration : 0;
            resolve({
                duration: safeDuration,
                width: video.videoWidth || 0,
                height: video.videoHeight || 0,
                fileSize: file.size,
                frameRate: 0,
                codec: '',
                bitRate: resolveAverageBitrate(file.size, safeDuration),
                audioCodec: '',
                audioSampleRate: 0,
                audioChannels: 0,
                pixelFormat: '',
                container: getContainerFromFile(file),
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
        video.preload = 'metadata';
        video.src = url;
    });
}

export async function extractMetadata(file: File): Promise<VideoMetadata> {
    let mediaInfoMetadata: VideoMetadata | null = null;

    try {
        mediaInfoMetadata = await extractMetadataWithMediaInfo(file);
    } catch (error) {
        console.warn('mediainfo.js failed, merging with native metadata fallback:', error);
    }

    const basicMetadata = await extractMetadataBasic(file);
    const duration = getNumericValue(mediaInfoMetadata?.duration, basicMetadata.duration);
    const fileSize = getNumericValue(mediaInfoMetadata?.fileSize, basicMetadata.fileSize, file.size);

    return {
        duration,
        width: getNumericValue(mediaInfoMetadata?.width, basicMetadata.width),
        height: getNumericValue(mediaInfoMetadata?.height, basicMetadata.height),
        frameRate: getNumericValue(mediaInfoMetadata?.frameRate, basicMetadata.frameRate),
        fileSize,
        codec: getStringValue(mediaInfoMetadata?.codec, getStringValue(basicMetadata.codec)),
        bitRate: getNumericValue(
            mediaInfoMetadata?.bitRate,
            basicMetadata.bitRate,
            resolveAverageBitrate(fileSize, duration),
        ),
        audioCodec: getStringValue(mediaInfoMetadata?.audioCodec, getStringValue(basicMetadata.audioCodec)),
        audioSampleRate: getNumericValue(mediaInfoMetadata?.audioSampleRate, basicMetadata.audioSampleRate),
        audioChannels: getNumericValue(mediaInfoMetadata?.audioChannels, basicMetadata.audioChannels),
        pixelFormat: getStringValue(mediaInfoMetadata?.pixelFormat, getStringValue(basicMetadata.pixelFormat)),
        container: getStringValue(
            mediaInfoMetadata?.container,
            getStringValue(basicMetadata.container, getContainerFromFile(file)),
        ),
    };
}
