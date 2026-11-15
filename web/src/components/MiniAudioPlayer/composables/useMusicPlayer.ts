// useMusicPlayer.ts
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

/** 外部（例如文件预览切换卡片）请求暂停时派发的自定义事件 */
export const AUDIO_PAUSE_EVENT = "mini-audio-pause";

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

    // —— 音量过渡 ——
    // 播放时从 0 淡到目标音量，暂停 / 切换卡片时从当前音量淡到 0：
    // 避免直接切断音频的「咔哒」声，操作反馈也更顺滑。
    const PLAY_FADE_MS = 280;
    const PAUSE_FADE_MS = 220;
    const UNMOUNT_FADE_MS = 200;
    const FADE_INTERVAL_MS = 16;

    const clampVolume = (value: number) =>
        Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

    let fadeTimer: number | null = null;
    let fadeResolve: (() => void) | null = null;
    // 播放 / 暂停的竞态令牌：快速连点时只让最后一次操作生效
    let controlToken = 0;

    const cancelFade = () => {
        if (fadeTimer !== null) {
            window.clearInterval(fadeTimer);
            fadeTimer = null;
        }
        if (fadeResolve) {
            const resolve = fadeResolve;
            fadeResolve = null;
            resolve();
        }
    };

    /** 把音量线性（ease-out）过渡到目标值，取消时立即 resolve */
    const fadeVolumeTo = (target: number, duration: number): Promise<void> => {
        const audio = audioRef.value;
        cancelFade();
        if (!audio) return Promise.resolve();

        const from = clampVolume(audio.volume);
        const to = clampVolume(target);
        if (duration <= 0 || Math.abs(from - to) < 0.005) {
            audio.volume = to;
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            const startedAt = performance.now();
            fadeResolve = resolve;
            fadeTimer = window.setInterval(() => {
                const el = audioRef.value;
                if (!el) {
                    cancelFade();
                    return;
                }
                const progress = Math.min(
                    1,
                    (performance.now() - startedAt) / duration
                );
                // ease-out：开头快、收尾轻
                const eased = 1 - (1 - progress) * (1 - progress);
                el.volume = clampVolume(from + (to - from) * eased);
                if (progress >= 1) {
                    el.volume = to;
                    cancelFade();
                }
            }, FADE_INTERVAL_MS);
        });
    };

    const play = async (): Promise<void> => {
        const audio = audioRef.value;
        if (!audio) return;

        const token = ++controlToken;
        cancelFade();
        // 先切 UI 再等浏览器真正开始播放：移动端缓冲时按钮 / 唱片不会「没反应」
        isPlaying.value = true;
        audio.volume = 0;

        try {
            await audio.play();
            if (token !== controlToken) return;
            await fadeVolumeTo(volume.value, PLAY_FADE_MS);
        } catch (error) {
            if (token !== controlToken) return;
            audio.volume = clampVolume(volume.value);
            isPlaying.value = false;
            const name = (error as DOMException | undefined)?.name;
            if (name !== "AbortError") {
                console.error("播放失败", error);
            }
        }
    };

    const pause = async (): Promise<void> => {
        const audio = audioRef.value;
        if (!audio) return;

        const token = ++controlToken;
        // 先停 UI（唱片 / 图标立刻响应），声音再用 220ms 淡出
        isPlaying.value = false;
        await fadeVolumeTo(0, PAUSE_FADE_MS);
        if (token !== controlToken) return;
        audio.pause();
        // 恢复用户设定的音量，下次播放再从头淡入
        audio.volume = clampVolume(volume.value);
    };

    // 外部直接 pause 会「啪」地切断声音；统一走 fade-out 再暂停
    const handlePauseRequest = (event: Event) => {
        event.preventDefault();
        // 已经不在播放（暂停中的淡出也算）就不用再启动一次淡出
        if (!isPlaying.value) return;
        void pause();
    };

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
        controlToken += 1;
        cancelFade();
        isPlaying.value = false;
        const audio = audioRef.value;
        if (audio) audio.volume = clampVolume(volume.value);
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
        audio.addEventListener(AUDIO_PAUSE_EVENT, handlePauseRequest);
    };

    const detachAudioEvents = () => {
        const audio = audioRef.value;
        if (!audio) return;
        audio.removeEventListener("timeupdate", setProgressFromAudio);
        audio.removeEventListener("loadedmetadata", onLoadedMetadata);
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("play", handlePlay);
        audio.removeEventListener("pause", handlePause);
        audio.removeEventListener(AUDIO_PAUSE_EVENT, handlePauseRequest);
    };

    // 加载新的音频源（可中途更换）
    const loadTrack = async (newTrack?: SimpleTrack, autoplay = false) => {
        const audio = audioRef.value;
        if (!audio) return;

        if (newTrack) {
            track.value = newTrack;
        }

        if (!track.value.url) return;

        // 换源前中断进行中的淡入淡出，避免旧音频的操作落到新音频上
        controlToken += 1;
        cancelFade();
        audio.volume = clampVolume(volume.value);

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

                await play();
            } catch (error) {
                console.error("自动播放被阻止", error);
                // 如果自动播放失败，可以显示一个提示让用户手动点击播放
                isPlaying.value = false;
            }
        }
    };

    const togglePlay = async () => {
        if (isPlaying.value) {
            await pause();
        } else {
            await play();
        }
    };

    const seek = (value: number) => {
        progress.value = value;
    };

    const changeVolume = (value: number) => {
        const audio = audioRef.value;
        const next = clampVolume(value);
        // 手动拖音量时立即生效，并打断正在进行的淡入 / 淡出
        cancelFade();
        volume.value = next;
        if (!audio) return;
        audio.volume = next;
        if (muted.value && next > 0) {
            audio.muted = false;
            muted.value = false;
        }
    };

    const toggleMute = () => {
        const audio = audioRef.value;
        if (!audio) return;
        cancelFade();
        audio.muted = !audio.muted;
        muted.value = audio.muted;
        if (audio.muted) {
            // 静音期间把音量恢复成目标值，避免淡变停在中间值
            audio.volume = clampVolume(volume.value);
        }
    };

    // 重新开始播放当前音频
    const restart = async () => {
        const audio = audioRef.value;
        if (!audio) return;
        audio.currentTime = 0;
        await play();
    };


    /** 直接应用一组颜色（封面取色失败时用页面主题色兜底） */
    const setPalette = (primary: string, secondary: string, text = "#f8fafc") => {
        dominantColor.value = { primary, secondary, text };
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
        controlToken += 1;
        cancelFade();

        const audio = audioRef.value;
        if (!audio) return;
        if (audio.paused) {
            audio.volume = clampVolume(volume.value);
            return;
        }

        // 组件即将销毁（切到别的卡片），但淡出仍要基于这个音频元素完成：
        // 用闭包持有引用，淡到 0 后再 pause，声音不会突然被掐断。
        const from = clampVolume(audio.volume);
        const startedAt = performance.now();
        const timer = window.setInterval(() => {
            const progress = Math.min(
                1,
                (performance.now() - startedAt) / UNMOUNT_FADE_MS
            );
            audio.volume = clampVolume(from * (1 - progress));
            if (progress >= 1) {
                window.clearInterval(timer);
                audio.pause();
                audio.volume = 0;
            }
        }, FADE_INTERVAL_MS);
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

        // 颜色（封面取色见 utils/coverPalette.ts）
        setPalette,
    };
};