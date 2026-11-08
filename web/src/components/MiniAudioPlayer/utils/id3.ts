// id3.ts
// 轻量 ID3v2 标签解析（支持 v2.2 / v2.3 / v2.4）。
// 之所以自己解析 MP3 标签：mediainfo.js（wasm）会把 ID3v2.3 的 UTF-16
// 中文标签解析成乱码，而中文 MP3 几乎都是这种写法。

export interface Id3Cover {
    mime: string;
    data: Uint8Array;
    /** ID3 图片类型，3 = 正面封面 */
    pictureType: number;
}

export interface Id3Tag {
    title?: string;
    artist?: string;
    album?: string;
    albumArtist?: string;
    genre?: string;
    year?: string;
    cover?: Id3Cover;
}

export interface Id3Header {
    major: number;
    revision: number;
    flags: number;
    /** 帧数据长度（不含 10 字节头 / 10 字节尾） */
    size: number;
    /** 整个标签占用的字节数（含头与可选尾） */
    totalSize: number;
}

const ID3_HEADER_BYTES = 10;
const ID3_FOOTER_FLAG = 0x10;
const ID3_EXTENDED_HEADER_FLAG = 0x40;
const ID3_UNSYNCHRONISATION_FLAG = 0x80;

type Id3TextField = Exclude<keyof Id3Tag, "cover">;

const TEXT_FRAME_IDS: Record<string, Id3TextField> = {
    // v2.3 / v2.4
    TIT2: "title",
    TPE1: "artist",
    TALB: "album",
    TPE2: "albumArtist",
    TCON: "genre",
    TYER: "year",
    TDRC: "year",
    // v2.2
    TT2: "title",
    TP1: "artist",
    TAL: "album",
    TP2: "albumArtist",
    TCO: "genre",
    TYE: "year",
};

const syncSafeToNumber = (bytes: Uint8Array, offset: number) =>
    ((bytes[offset]! & 0x7f) << 21) |
    ((bytes[offset + 1]! & 0x7f) << 14) |
    ((bytes[offset + 2]! & 0x7f) << 7) |
    (bytes[offset + 3]! & 0x7f);

const bigEndianToNumber = (bytes: Uint8Array, offset: number, length: number) => {
    let value = 0;
    for (let i = 0; i < length; i += 1) {
        value = value * 256 + bytes[offset + i]!;
    }
    return value;
};

/** 读取开头的 ID3v2 头；不是 ID3v2 标签时返回 null */
export const readId3Header = (bytes: Uint8Array): Id3Header | null => {
    if (bytes.length < ID3_HEADER_BYTES) return null;
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
    const major = bytes[3]!;
    const revision = bytes[4]!;
    const flags = bytes[5]!;
    if (major < 2 || major > 4) return null;
    const size = syncSafeToNumber(bytes, 6);
    const footer = major === 4 && (flags & ID3_FOOTER_FLAG) !== 0 ? ID3_HEADER_BYTES : 0;
    return {
        major,
        revision,
        flags,
        size,
        totalSize: ID3_HEADER_BYTES + size + footer,
    };
};

const decodeText = (bytes: Uint8Array, encoding: number): string => {
    try {
        switch (encoding) {
            case 0:
                return new TextDecoder("iso-8859-1").decode(bytes);
            case 1:
                if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
                    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
                }
                if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
                    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
                }
                // 没有 BOM 时按小端处理（最常见）
                return new TextDecoder("utf-16le").decode(bytes);
            case 2:
                return new TextDecoder("utf-16be").decode(bytes);
            case 3:
                return new TextDecoder("utf-8").decode(bytes);
            default:
                return new TextDecoder("utf-8").decode(bytes);
        }
    } catch {
        return "";
    }
};

/** 去掉结尾的 \0，并把多值（v2.4 用 \0 分隔）拼起来 */
const normalizeText = (value: string): string =>
    value
        .split("\u0000")
        .map((part) => part.replace(/^\uFEFF/, "").trim())
        .filter(Boolean)
        .join(" / ");

/** 处理 v2.2 / v2.3 的整段去同步化 */
const removeUnsynchronisation = (bytes: Uint8Array): Uint8Array => {
    const output = new Uint8Array(bytes.length);
    let length = 0;
    for (let i = 0; i < bytes.length; i += 1) {
        const byte = bytes[i]!;
        output[length++] = byte;
        if (byte === 0xff && bytes[i + 1] === 0x00) {
            i += 1;
        }
    }
    return output.subarray(0, length);
};

const findTerminator = (
    bytes: Uint8Array,
    start: number,
    encoding: number
): number => {
    if (encoding === 0 || encoding === 3) {
        for (let i = start; i < bytes.length; i += 1) {
            if (bytes[i] === 0) return i;
        }
        return bytes.length;
    }
    for (let i = start; i + 1 < bytes.length; i += 2) {
        if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    }
    return bytes.length;
};

const decodePicture = (
    bytes: Uint8Array,
    major: number
): Id3Cover | undefined => {
    if (bytes.length < 2) return undefined;
    const encoding = bytes[0]!;
    let mime = "";
    let cursor = 1;

    if (major === 2) {
        // v2.2：3 字节图片格式（"JPG" / "PNG"）
        const format = decodeText(bytes.subarray(1, 4), 0).toUpperCase();
        mime = format === "PNG" ? "image/png" : format === "JPG" ? "image/jpeg" : `image/${format.toLowerCase()}`;
        cursor = 4;
    } else {
        const mimeEnd = findTerminator(bytes, 1, 0);
        mime = decodeText(bytes.subarray(1, mimeEnd), 0);
        cursor = mimeEnd + 1;
    }

    if (cursor >= bytes.length) return undefined;
    const pictureType = bytes[cursor]!;
    cursor += 1;
    if (cursor > bytes.length) return undefined;

    const descriptionEnd = findTerminator(bytes, cursor, encoding);
    // 描述文本按编码可能是 1 字节或 2 字节终止符
    cursor = descriptionEnd + (encoding === 0 || encoding === 3 ? 1 : 2);
    if (cursor >= bytes.length) return undefined;
    if (!mime) mime = "image/jpeg";
    return { mime, data: bytes.slice(cursor), pictureType };
};

const parseFrames = (
    frames: Uint8Array,
    header: Id3Header
): Id3Tag => {
    const tag: Id3Tag = {};

    const readFrame = (offset: number): { id: string; size: number; flags: number; contentStart: number } | null => {
        const isV22 = header.major === 2;
        const frameHeaderSize = isV22 ? 6 : 10;
        if (offset + frameHeaderSize > frames.length) return null;
        if (frames[offset] === 0) return null; // 填充区
        const id = isV22
            ? decodeText(frames.subarray(offset, offset + 3), 0)
            : decodeText(frames.subarray(offset, offset + 4), 0);
        const size = isV22
            ? bigEndianToNumber(frames, offset + 3, 3)
            : header.major === 4
                ? syncSafeToNumber(frames, offset + 4)
                : bigEndianToNumber(frames, offset + 4, 4);
        const flags = isV22 ? 0 : bigEndianToNumber(frames, offset + 8, 2);
        if (!/^[A-Z0-9]{3,4}$/.test(id)) return null;
        const contentStart = offset + frameHeaderSize;
        if (size <= 0 || contentStart + size > frames.length) return null;
        return { id, size, flags, contentStart };
    };

    const formatFlags = (flags: number) => flags & 0xff;

    let offset = 0;
    // 跳过扩展头
    if (header.major === 3 && (header.flags & ID3_EXTENDED_HEADER_FLAG)) {
        if (frames.length >= 4) {
            offset = 4 + bigEndianToNumber(frames, 0, 4);
        }
    } else if (header.major === 4 && (header.flags & ID3_EXTENDED_HEADER_FLAG)) {
        if (frames.length >= 4) {
            offset = syncSafeToNumber(frames, 0);
        }
    } else if (header.major === 2 && (header.flags & 0x40)) {
        // v2.2 整段压缩标签无法直接读取
        return tag;
    }

    while (offset < frames.length) {
        const frame = readFrame(offset);
        if (!frame) break;

        offset = frame.contentStart + frame.size;
        const format = formatFlags(frame.flags);
        // 压缩 / 加密的帧无法直接读取，跳过
        const compressed = header.major === 4 ? (format & 0x08) !== 0 : (format & 0x80) !== 0;
        const encrypted = header.major === 4 ? (format & 0x04) !== 0 : (format & 0x40) !== 0;
        if (compressed || encrypted) continue;
        // 跳过分组标识 / 数据长度指示
        let contentStart = frame.contentStart;
        if (header.major === 4) {
            if (format & 0x40) contentStart += 1;
            if (format & 0x01) contentStart += 4;
        } else if (header.major === 3) {
            if (format & 0x20) contentStart += 1;
        }
        if (contentStart >= frame.contentStart + frame.size) continue;
        let content = frames.subarray(contentStart, frame.contentStart + frame.size);
        // v2.4 帧级去同步化
        if (header.major === 4 && (format & 0x02) !== 0) {
            content = removeUnsynchronisation(content);
        }

        if (frame.id === "APIC" || frame.id === "PIC") {
            const cover = decodePicture(content, header.major);
            if (cover) {
                // 优先使用正面封面（类型 3），否则使用第一个图片
                const isFront = cover.pictureType === 3;
                const currentIsFront = tag.cover?.pictureType === 3;
                if (!tag.cover || (isFront && !currentIsFront)) {
                    tag.cover = cover;
                }
            }
            continue;
        }

        const field = TEXT_FRAME_IDS[frame.id];
        if (!field) continue;
        if (tag[field]) continue;

        const encoding = content[0] ?? 0;
        const value = normalizeText(decodeText(content.subarray(1), encoding));
        if (value) {
            tag[field] = value;
        }
    }

    return tag;
};

/** 解析完整的 ID3v2 标签（含 10 字节头） */
export const parseId3Tag = (bytes: Uint8Array, header: Id3Header): Id3Tag => {
    const tagBytes = bytes.subarray(0, Math.min(bytes.length, header.totalSize));
    let frames = tagBytes.subarray(
        ID3_HEADER_BYTES,
        Math.min(tagBytes.length, ID3_HEADER_BYTES + header.size)
    );
    if (header.major <= 3 && (header.flags & ID3_UNSYNCHRONISATION_FLAG)) {
        frames = removeUnsynchronisation(frames);
    }
    return parseFrames(frames, header);
};
