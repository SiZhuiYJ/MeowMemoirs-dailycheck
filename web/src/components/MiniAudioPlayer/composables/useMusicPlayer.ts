// useMusicPlayer.ts
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export interface SimpleTrack {
    url: string;
}

const formatTime = (value: number) => {
    if (!value || Number.isNaN(value)) return "00:00";
    const minutes = Math.floor(value / 60)
        .toString()
        .padStart(2, "0");
    const seconds = Math.floor(value % 60)
        .toString()
        .padStart(2, "0");
    return `${minutes}:${seconds}`;
};

export const useMusicPlayer = (
    audioRef: { value: HTMLAudioElement | null },
    initialTrack: SimpleTrack | (() => SimpleTrack),
    onLoaded?: () => void
) => {
    // 基础状态
    const track = ref<SimpleTrack>(
        typeof initialTrack === "function" ? initialTrack() : initialTrack
    );

    const isPlaying = ref(false);
    const isReady = ref(false);
    const duration = ref(0);
    const currentTime = ref(0);
    const volume = ref(0.7);
    const muted = ref(false);

    // 颜色
    const dominantColor = ref<{
        primary: string;
        secondary: string;
        text: string;
    } | null>(null);

    // 计算属性
    const progress = computed({
        get: () => (duration.value ? (currentTime.value / duration.value) * 100 : 0),
        set: (value: number) => {
            const audio = audioRef.value;
            if (!audio || !duration.value) return;
            const nextTime = (value / 100) * duration.value;
            audio.currentTime = nextTime;
            currentTime.value = nextTime;
        },
    });

    const formattedCurrentTime = computed(() => formatTime(currentTime.value));
    const formattedDuration = computed(() => formatTime(duration.value));

    // 更新音频当前时间
    const setProgressFromAudio = () => {
        const audio = audioRef.value;
        if (!audio) return;
        currentTime.value = audio.currentTime;
        duration.value = audio.duration || duration.value || 0;
    };

    const onLoadedMetadata = () => {
        const audio = audioRef.value;
        if (!audio) return;
        duration.value = audio.duration;
        isReady.value = true;
        onLoaded?.();
    };

    const handlePlay = () => {
        isPlaying.value = true;
    };

    const handlePause = () => {
        isPlaying.value = false;
    };

    const handleEnded = () => {
        isPlaying.value = false;
        // 单曲播放结束，不自动循环/下一首
    };

    const attachAudioEvents = () => {
        const audio = audioRef.value;
        if (!audio) return;
        audio.addEventListener("timeupdate", setProgressFromAudio);
        audio.addEventListener("loadedmetadata", onLoadedMetadata);
        audio.addEventListener("ended", handleEnded);
        audio.addEventListener("play", handlePlay);
        audio.addEventListener("pause", handlePause);
    };

    const detachAudioEvents = () => {
        const audio = audioRef.value;
        if (!audio) return;
        audio.removeEventListener("timeupdate", setProgressFromAudio);
        audio.removeEventListener("loadedmetadata", onLoadedMetadata);
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("play", handlePlay);
        audio.removeEventListener("pause", handlePause);
    };

    // 加载新的音频源（可中途更换）
    const loadTrack = async (newTrack?: SimpleTrack, autoplay = false) => {
        const audio = audioRef.value;
        if (!audio) return;

        if (newTrack) {
            track.value = newTrack;
        }

        if (!track.value.url) return;

        isReady.value = false;
        isPlaying.value = false;
        currentTime.value = 0;
        duration.value = 0;

        audio.src = track.value.url;
        audio.load();

        if (autoplay) {
            try {
                // 等待元数据加载完成后再播放
                await new Promise((resolve, reject) => {
                    const handleLoadedMetadata = () => {
                        cleanup();
                        resolve(true);
                    };

                    const handleError = (error: Event) => {
                        cleanup();
                        reject(error);
                    };

                    const cleanup = () => {
                        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
                        audio.removeEventListener('error', handleError);
                    };

                    audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
                    audio.addEventListener('error', handleError, { once: true });
                });

                await audio.play();
                isPlaying.value = true;
            } catch (error) {
                console.error("自动播放被阻止", error);
                // 如果自动播放失败，可以显示一个提示让用户手动点击播放
                isPlaying.value = false;
            } finally {
                // 移除事件监听器，防止重复监听
                // detachAudioEvents();
                // attachAudioEvents();
            }
        }
    };

    const togglePlay = async () => {
        const audio = audioRef.value;
        if (!audio) return;

        if (isPlaying.value) {
            audio.pause();
        } else {
            try {
                await audio.play();
                // 播放成功后，若 isReady 仍为 false（元数据未加载完），播放器会自动更新状态，无需额外处理
            } catch (error) {
                console.error("播放失败", error);
                // 可选：若播放失败且因 src 无效，可在此尝试加载（但用户手势下 play 本身会触发加载）
            }
        }
    };

    const seek = (value: number) => {
        progress.value = value;
    };

    const changeVolume = (value: number) => {
        const audio = audioRef.value;
        volume.value = value;
        if (!audio) return;
        audio.volume = value;
        if (muted.value && value > 0) {
            audio.muted = false;
            muted.value = false;
        }
    };

    const toggleMute = () => {
        const audio = audioRef.value;
        if (!audio) return;
        audio.muted = !audio.muted;
        muted.value = audio.muted;
    };

    // 重新开始播放当前音频
    const restart = async () => {
        const audio = audioRef.value;
        if (!audio) return;
        audio.currentTime = 0;
        await audio.play();
        isPlaying.value = true;
    };


    const rgbToHex = (r: number, g: number, b: number) => {
        const toHex = (n: number) =>
            Math.max(0, Math.min(255, Math.round(n)))
                .toString(16)
                .padStart(2, "0");
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    };

    const mixChannel = (value: number, target: number, weight: number) =>
        value * weight + target * (1 - weight);

    const extractPalette = async (url: string) => {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = url;
        });
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        const sampleSize = 64;
        const width = (canvas.width = Math.min(
            sampleSize,
            img.naturalWidth || img.width
        ));
        const height = (canvas.height = Math.min(
            sampleSize,
            img.naturalHeight || img.height
        ));
        ctx.drawImage(img, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha! < 10) continue;
            r += data[i]!;
            g += data[i + 1]!;
            b += data[i + 2]!;
            count++;
        }
        if (!count) return null;
        const base = [r / count, g / count, b / count];

        const darkBaseRgb = [18, 36, 62];
        const mixWeight = 0.6;

        const primaryRgb = base.map((channel, i) =>
            mixChannel(
                mixChannel(channel, darkBaseRgb[i]!, mixWeight),
                0,
                0.9
            )
        );

        const secondaryRgb = base.map(channel =>
            mixChannel(channel, 255, 0.4)
        );

        const textHex = "#f8fafc";


        dominantColor.value = {
            primary: rgbToHex(primaryRgb[0]!, primaryRgb[1]!, primaryRgb[2]!),
            secondary: rgbToHex(
                secondaryRgb[0]!,
                secondaryRgb[1]!,
                secondaryRgb[2]!
            ),
            text: textHex
        }
        // return {
        //     primary: rgbToHex(primaryRgb[0]!, primaryRgb[1]!, primaryRgb[2]!),
        //     secondary: rgbToHex(
        //         secondaryRgb[0]!,
        //         secondaryRgb[1]!,
        //         secondaryRgb[2]!
        //     ),
        //     text: textHex
        // };
    };

    onMounted(() => {
        const audio = audioRef.value;
        if (!audio) return;
        audio.volume = volume.value;
        audio.muted = muted.value;
        attachAudioEvents();
        // 初始不自动播放，仅加载元数据
        loadTrack();
    });

    onBeforeUnmount(() => {
        detachAudioEvents();
    });

    return {
        // 当前音频信息
        dominantColor,
        track,

        // 播放状态
        isPlaying,
        isReady,
        currentTime,
        duration,
        progress,
        volume,
        muted,

        // 格式化时间
        formattedCurrentTime,
        formattedDuration,

        // 控制方法
        loadTrack,
        togglePlay,
        seek,
        changeVolume,
        toggleMute,
        restart,
        formatTime,

        // 颜色转换
        extractPalette,
    };
};