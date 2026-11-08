// useAudioMetadata.ts
// 播放器用的音频标签状态：按 URL 读取音频内嵌标签，卸载时释放封面 blob。
// 读取失败时 metadata 为空，由调用方回退到默认值。
import { onBeforeUnmount, ref } from "vue";
import { extractAudioMetadata, type AudioMetadata } from "../utils/audioTags";

export type { AudioMetadata };

export const useAudioMetadata = () => {
    const metadata = ref<AudioMetadata | null>(null);
    const isLoading = ref(false);

    let requestId = 0;
    let coverObjectUrl: string | null = null;

    const releaseCover = () => {
        if (coverObjectUrl) {
            URL.revokeObjectURL(coverObjectUrl);
            coverObjectUrl = null;
        }
    };

    const reset = () => {
        requestId += 1;
        releaseCover();
        metadata.value = null;
        isLoading.value = false;
    };

    const load = async (url?: string) => {
        const current = ++requestId;
        releaseCover();
        metadata.value = null;

        if (!url) {
            isLoading.value = false;
            return;
        }

        isLoading.value = true;
        try {
            const result = await extractAudioMetadata(url);
            if (current !== requestId) {
                // 已经切歌，丢弃这次结果
                if (result.coverUrl) {
                    URL.revokeObjectURL(result.coverUrl);
                }
                return;
            }
            coverObjectUrl = result.coverUrl ?? null;
            metadata.value = result;
        } catch (error) {
            if (current === requestId) {
                metadata.value = null;
                console.warn(
                    "[MiniAudioPlayer] 未能从音频中读取标签，使用默认信息：",
                    error
                );
            }
        } finally {
            if (current === requestId) {
                isLoading.value = false;
            }
        }
    };

    onBeforeUnmount(() => {
        requestId += 1;
        releaseCover();
    });

    return { metadata, isLoading, load, reset };
};
