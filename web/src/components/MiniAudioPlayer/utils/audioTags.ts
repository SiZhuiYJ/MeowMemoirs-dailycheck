// audioTags.ts
// 读取音频文件内嵌的标签信息。
// MP3 的 ID3v2 标签由本地解析器处理（mediainfo.js 对 UTF-16 中文标签支持有问题），
// 其余容器（FLAC / M4A / OGG / WAV...）交给 mediainfo.js（wasm）。
// 远程地址使用 Range 请求按需读取，尽量避免把整首歌下载下来。
import type { AudioTrack, GeneralTrack, MediaInfo, Track } from "mediainfo.js";
import { parseId3Tag, readId3Header } from "./id3";

export interface AudioMetadata {
    title?: string;
    artist?: string;
    album?: string;
    albumArtist?: string;
    genre?: string;
    year?: string;
    /** 内嵌封面的 blob URL（浏览器端临时地址，用完需要 revoke） */
    coverUrl?: string;
}

export interface ByteSource {
    size: number;
    read: (offset: number, length: number) => Promise<Uint8Array>;
}

const WASM_FILE = "mediainfo/MediaInfoModule.wasm";
const CHUNK_SIZE = 512 * 1024;

// 整个页面共用一个 MediaInfo 实例（wasm 只加载一次），
// 并通过队列串行化解析，避免同一实例并发分析报错。
let mediaInfoPromise: Promise<MediaInfo> | null = null;
let analysisQueue: Promise<unknown> = Promise.resolve();

const getAssetUrl = (path: string) => {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    return new URL(path.replace(/^\/+/, ""), base).toString();
};

export const createMediaInfo = () => {
    if (!mediaInfoPromise) {
        mediaInfoPromise = import("mediainfo.js")
            .then(({ default: mediaInfoFactory }) =>
                mediaInfoFactory({
                    format: "object",
                    // 让 MediaInfo 输出内嵌封面（base64）
                    coverData: true,
                    chunkSize: CHUNK_SIZE,
                    locateFile: () => getAssetUrl(WASM_FILE),
                })
            )
            .catch((error) => {
                // 允许下次重试
                mediaInfoPromise = null;
                throw error;
            });
    }
    return mediaInfoPromise;
};

const runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = analysisQueue.then(task, task);
    analysisQueue = run.then(
        () => undefined,
        () => undefined
    );
    return run;
};

const toUint8Array = async (response: Response) =>
    new Uint8Array(await response.arrayBuffer());

const createMemorySource = (buffer: Uint8Array): ByteSource => ({
    size: buffer.length,
    read: async (offset, length) => buffer.slice(offset, offset + length),
});

/**
 * 打开音频数据源：本地 blob/data 直接读入内存；
 * 远程地址优先 HEAD 取大小，再用 Range 请求按需读取。
 */
export const openByteSource = async (url: string): Promise<ByteSource> => {
    if (url.startsWith("blob:") || url.startsWith("data:")) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`读取本地音频失败（HTTP ${response.status}）`);
        }
        return createMemorySource(await toUint8Array(response));
    }

    let size = 0;
    try {
        const head = await fetch(url, { method: "HEAD" });
        if (head.ok) {
            size = Number(head.headers.get("Content-Length")) || 0;
        }
    } catch {
        // HEAD 可能被跨域策略拦截，继续用 Range 探测
    }

    if (!size) {
        const probe = await fetch(url, { headers: { Range: "bytes=0-0" } });
        if (!probe.ok) {
            throw new Error(`读取音频失败（HTTP ${probe.status}）`);
        }
        // 服务端不支持 Range 时会直接返回整个文件
        if (probe.status === 200) {
            return createMemorySource(await toUint8Array(probe));
        }
        const contentRange = probe.headers.get("Content-Range") ?? "";
        size = Number(contentRange.split("/")[1]) || 0;
        // 释放探测响应
        await probe.arrayBuffer().catch(() => undefined);
    }

    if (!size || !Number.isFinite(size) || size <= 0) {
        throw new Error("无法获取音频大小");
    }

    // 服务端忽略 Range 时缓存整个文件，后续读块都从内存切片
    let buffered: Uint8Array | null = null;
    const totalSize = size;

    const read = async (offset: number, length: number): Promise<Uint8Array> => {
        if (buffered) {
            return buffered.slice(offset, offset + length);
        }
        const end = Math.min(totalSize, offset + length);
        const response = await fetch(url, {
            headers: { Range: `bytes=${offset}-${end - 1}` },
        });

        if (response.status === 206) {
            return toUint8Array(response);
        }
        if (response.status === 200) {
            buffered = await toUint8Array(response);
            return buffered.slice(offset, end);
        }
        throw new Error(`读取音频数据失败（HTTP ${response.status}）`);
    };

    return { size: totalSize, read };
};

const firstText = (...values: (string | undefined)[]): string | undefined => {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
};

const coverDataToBlobUrl = (base64: string, mime?: string): string | undefined => {
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return coverBytesToBlobUrl(bytes, mime);
    } catch (error) {
        console.warn("[MiniAudioPlayer] 内嵌封面解析失败", error);
        return undefined;
    }
};

const coverBytesToBlobUrl = (bytes: Uint8Array, mime?: string): string | undefined => {
    if (!bytes.length) return undefined;
    try {
        // 复制到独立的 ArrayBuffer，避免 SharedArrayBuffer 的类型问题
        const copy = new Uint8Array(bytes.length);
        copy.set(bytes);
        return URL.createObjectURL(new Blob([copy], { type: mime || "image/jpeg" }));
    } catch (error) {
        console.warn("[MiniAudioPlayer] 内嵌封面解析失败", error);
        return undefined;
    }
};

const isGeneralTrack = (track: Track): track is GeneralTrack =>
    track["@type"] === "General";
const isAudioTrack = (track: Track): track is AudioTrack =>
    track["@type"] === "Audio";

/** ID3 标签一般不会超过几十 MB，超过则视为异常，不做读取 */
const ID3_MAX_TAG_SIZE = 64 * 1024 * 1024;

/** 读取 MP3 开头的 ID3v2 标签，不是 ID3 或没有可用数据时返回 null */
const readId3FromSource = async (source: ByteSource): Promise<AudioMetadata | null> => {
    if (source.size < 10) return null;
    const head = await source.read(0, 10);
    const header = readId3Header(head);
    if (!header || header.totalSize > ID3_MAX_TAG_SIZE) return null;

    const bytes = header.totalSize <= 10 ? head : await source.read(0, header.totalSize);
    const tag = parseId3Tag(bytes, header);
    if (!tag.title && !tag.artist && !tag.album && !tag.cover) return null;

    return {
        title: tag.title,
        artist: tag.artist,
        album: tag.album,
        albumArtist: tag.albumArtist,
        genre: tag.genre,
        year: tag.year,
        coverUrl: tag.cover
            ? coverBytesToBlobUrl(tag.cover.data, tag.cover.mime)
            : undefined,
    };
};

/** 用 mediainfo.js 解析非 MP3 容器的标签 */
const extractWithMediaInfo = async (source: ByteSource): Promise<AudioMetadata> => {
    const mediaInfo = await createMediaInfo();

    const result = await runExclusive(() =>
        mediaInfo.analyzeData(source.size, (size, offset) => source.read(offset, size))
    );

    const tracks = result.media?.track ?? [];
    const general = tracks.find(isGeneralTrack);
    const audio = tracks.find(isAudioTrack);

    return {
        title: firstText(general?.Title, audio?.Title),
        artist: firstText(general?.Performer),
        album: firstText(general?.Album),
        albumArtist: firstText(general?.Album_Performer),
        genre: firstText(general?.Genre),
        year: firstText(general?.Recorded_Date),
        coverUrl: general?.Cover_Data
            ? coverDataToBlobUrl(general.Cover_Data, general.Cover_Mime)
            : undefined,
    };
};

/**
 * 解析音频文件自带的标签信息。没有任何标签时返回空对象。
 * 需要服务端允许跨域读取（CORS），否则会抛出异常。
 */
export const extractAudioMetadata = async (url: string): Promise<AudioMetadata> => {
    const source = await openByteSource(url);

    // MP3 / 带 ID3v2 标签的文件优先走本地解析
    const id3 = await readId3FromSource(source).catch((error) => {
        console.warn("[MiniAudioPlayer] ID3 标签解析失败，改用 mediainfo", error);
        return null;
    });
    if (id3) return id3;

    return extractWithMediaInfo(source);
};
