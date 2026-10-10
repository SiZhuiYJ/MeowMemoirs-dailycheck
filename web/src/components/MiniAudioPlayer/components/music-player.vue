<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMusicPlayer } from "../composables/useMusicPlayer";
import SvgIcon from "@/components/SvgIcon/index.vue";

const props = defineProps<{
    title?: string;
    url: string;
    coverUrl?: string;
}>();

const emit = defineEmits<{
    loaded: []
}>();

const audioRef = ref<HTMLAudioElement | null>(null);

const toNumber = (value: string | number) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

const player = useMusicPlayer(audioRef, {
    url: props.url,
}, () => {
    emit('loaded');
});

const {
    isPlaying,
    progress,
    volume,
    muted,
    dominantColor,
    formattedCurrentTime,
    formattedDuration,
    togglePlay,
    seek,
    changeVolume,
    toggleMute,
    loadTrack,
    extractPalette,
} = player;

// 监听 URL 变化，切换音频源
watch(() => props.url, (newUrl) => {
    if (newUrl) {
        // 停止当前播放
        isPlaying.value = false;
        // 加载新的音频
        loadTrack({ url: newUrl }, false);
    }
}, { immediate: false });

const timelineStyle = computed(() => ({
    "--slider-progress": `${progress.value}%`,
}));

const volumeStyle = computed(() => {
    const volumeProgress = muted.value ? 0 : Math.max(0, Math.min(volume.value, 1));
    return {
        "--slider-progress": `${volumeProgress * 100}%`,
    };
});

const onTimelineInput = (event: Event) => {
    const next = toNumber((event.target as HTMLInputElement).value);
    seek(next);
};

const onVolumeInput = (event: Event) => {
    const next = toNumber((event.target as HTMLInputElement).value);
    changeVolume(next);
};


watch(() => props.coverUrl, (coverUrl) => {
    if (!coverUrl) return;
    void extractPalette(coverUrl);
}, { immediate: true });

const heroStyle = computed((): { [key: string]: string } | undefined => {
    const palette = dominantColor.value;
    if (!palette) return undefined;
    return {
        "--hero-start": palette.primary,
        "--hero-end": palette.secondary,
        "--hero-text": palette.text,
        "--accent-a": palette.secondary,
        "--accent-b": palette.primary
    };
});
</script>

<template>
    <div class="player-page" :style="heroStyle">
        <section class="player-hero">
            <div class="glow"></div>
            <div class="hero-main">
                <div class="vinyl-wrap">
                    <div class="vinyl" :class="{ spinning: isPlaying }" :style="`--cover-url: url(${props.coverUrl})`"
                        @click="togglePlay">
                    </div>
                </div>
                <div class="hero-text">
                    <h1 class="title">
                        {{ props.title || "--" }}
                    </h1>
                    <div class="chips">
                        <span class="chip muted" v-if="muted">静音</span>
                        <span class="chip" v-if="formattedDuration">
                            时长 {{ formattedDuration }}
                        </span>
                    </div>
                </div>

                <div class="controls-card">
                    <div class="glass">
                        <div class="timeline">
                            <span class="time">{{ formattedCurrentTime }}</span>
                            <input class="slider" type="range" min="0" max="100" step="0.1" :value="progress"
                                :style="timelineStyle" @input="onTimelineInput" />
                            <span class="time">{{ formattedDuration }}</span>
                        </div>
                        <div class="controls">
                            <div class="controls-pyler">
                                <button class="primary" title="播放/暂停" @click="togglePlay">
                                    <SvgIcon :icon-class="!isPlaying ? 'general-play' : 'general-pause'" size="24px"
                                        style="color: var(--hero-text)" />
                                </button>
                            </div>
                            <div class="volume">
                                <button class="ghost" title="静音" @click="toggleMute">
                                    <SvgIcon v-if="muted || volume === 0" icon-class="general-mute" size="24px"
                                        style="color: var(--hero-text)" />
                                    <SvgIcon v-else-if="volume < 0.5" icon-class="general-alto" size="24px"
                                        style="color: var(--hero-text)" />
                                    <SvgIcon v-else icon-class="general-great-sound" size="24px"
                                        style="color: var(--hero-text)" />
                                </button>
                                <input class="slider volume-slider" type="range" min="0" max="1" step="0.01"
                                    :value="muted ? 0 : volume" :style="volumeStyle" @input="onVolumeInput" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <audio ref="audioRef" preload="auto" />
    </div>
</template>

<style scoped lang="scss">
/* ===== 以下样式保持不变（仅移除未使用的部分） ===== */
.player-page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    --hero-start: rgba(99, 102, 241, 0.32);
    --hero-end: rgba(14, 165, 233, 0.32);
    --hero-text: #e8ecf1;
    --accent-a: #7c8bff;
    --accent-b: #ff7a9a;
    color: var(--hero-text);
    height: 100%;
    box-sizing: border-box;
    width: 100%;
    position: relative;
    overflow-x: hidden;
}

@property --hero-start {
    syntax: "<color>";
    inherits: false;
    initial-value: #9b9c9b;
}

@property --hero-end {
    syntax: "<color>";
    inherits: false;
    initial-value: #e0e0df;
}

.player-hero {
    position: relative;
    // height: calc(100vh - clamp(1.25rem, 4vw, 2.5rem) * 2);
    // width: calc(100vw - clamp(1.25rem, 4vw, 2.5rem) * 2);
    height: 100%;
    width: 100%;
    overflow: hidden;
    padding: clamp(1.25rem, 4vw, 2.5rem);
    backdrop-filter: blur(8px);
    isolation: isolate;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.3);
    background: linear-gradient(135deg, var(--hero-start), var(--hero-end));
    color: var(--hero-text);
    transition: --hero-start 0.4s ease-in-out, --hero-end 0.4s ease-in-out;

    @media (max-width: 768px) {
        border-radius: 0;
        padding: clamp(1rem, 4vw, 1.5rem);
    }
}

.player-hero .glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(circle at 60% 20%, rgba(255, 255, 255, 0.16), transparent 45%),
        radial-gradient(circle at 10% 80%, rgba(255, 255, 255, 0.12), transparent 40%);
    mix-blend-mode: screen;
    opacity: 0.9;
    z-index: 0;
}

.hero-main {
    display: grid;
    grid-template-columns: 260px 1fr;
    grid-template-rows: auto auto auto;
    gap: clamp(1.25rem, 2vw, 2.5rem);
    align-items: center;
    position: relative;
    z-index: 1;
    height: 100%;

    grid-template-areas:
        "vinyl    info"
        "controls controls";


    .vinyl-wrap {
        grid-area: vinyl;
        display: grid;
        place-items: center;
    }

    .hero-text {
        grid-area: info;
    }

    .controls-card {
        grid-area: controls;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        height: 100%;
    }


    @media (max-height:600px) {
        grid-template-areas:
            "vinyl info"
            "vinyl controls";
    }

    @media (max-width: 768px) {
        grid-template-columns: 1fr;
        grid-template-rows: auto auto auto;
        grid-template-areas:
            "vinyl"
            "info"
            "controls";
        text-align: center;
        gap: 1.5rem;

        .vinyl-wrap {
            display: flex;
            justify-content: center;
        }

        .hero-text {
            text-align: center;
        }

        .chips {
            justify-content: center;
        }
    }
}

.vinyl-wrap {
    display: grid;
    place-items: center;
}

.vinyl {
    width: min(260px, 55vw);
    aspect-ratio: 1 / 1;
    border-radius: 50%;
    background: radial-gradient(circle, #0b0d13 45%, rgba(255, 255, 255, 0.08) 46%, #0b0d13 65%),
        repeating-conic-gradient(from 0deg, rgba(255, 255, 255, 0.08) 0deg 2deg, transparent 2deg 4deg);
    display: grid;
    place-items: center;
    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.45), inset 0 0 35px rgba(0, 0, 0, 0.4);
    transition: transform 0.4s ease, box-shadow 0.4s ease;
    position: relative;
    overflow: hidden;

    &.spinning {
        animation: spin 14s linear infinite;
        box-shadow: 0 25px 70px rgba(0, 0, 0, 0.55), inset 0 0 40px rgba(0, 0, 0, 0.5);
    }

    &:hover {
        transform: translateY(-4px);
    }

    @media (max-width: 768px) {
        width: min(220px, 70vw);
    }
}

.vinyl::after {
    content: "";
    position: absolute;
    inset: 18%;
    border-radius: 50%;
    background: var(--cover-url,
            radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.15), rgba(0, 0, 0, 0.65))) center/cover no-repeat;
    opacity: 0.92;
    mix-blend-mode: screen;
    box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.5);
    transition: opacity 0.4s ease;
    z-index: 0;
}

.hero-text .title {
    font-size: clamp(1.6rem, 4vw, 2.8rem);
    margin: 0;
    line-height: 1.15;

    @media (max-width: 768px) {
        font-size: clamp(1.5rem, 8vw, 2.1rem);
    }
}

.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.6rem;
}

.chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.8rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
    color: var(--hero-text);
    font-weight: 700;
    backdrop-filter: blur(8px);
}

.chip.muted {
    background: rgba(255, 99, 132, 0.9);
}

.glass {
    padding: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.controls-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    justify-content: flex-end;
}

.timeline {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.75rem;
    align-items: center;
}

.time {
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
    min-width: 46px;
}

.slider {
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--hero-text) 22%, transparent);
    outline: none;
    margin: 0;
    display: block;
}

.timeline .slider {
    background: linear-gradient(90deg, var(--hero-end), var(--hero-end)) 0 0 / var(--slider-progress, 0%) 100% no-repeat,
        color-mix(in srgb, var(--hero-text) 22%, transparent);
    transition: background 0.2s ease;
}

.timeline .slider::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--hero-end), var(--hero-end)) 0 0 / var(--slider-progress, 0%) 100% no-repeat,
        color-mix(in srgb, var(--hero-text) 22%, transparent);
}

.timeline .slider::-moz-range-track {
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--hero-end), var(--hero-end)) 0 0 / var(--slider-progress, 0%) 100% no-repeat,
        color-mix(in srgb, var(--hero-text) 22%, transparent);
}

.slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid transparent;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    opacity: 0;
    transform: scale(0.65);
    margin-top: -5px;
    transition: opacity 0.18s ease, transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid transparent;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    opacity: 0;
    transform: scale(0.65);
    margin-top: -5px;
    transition: opacity 0.18s ease, transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.timeline:hover .slider::-webkit-slider-thumb,
.timeline .slider:active::-webkit-slider-thumb,
.timeline:focus-within .slider::-webkit-slider-thumb {
    opacity: 1;
    transform: scale(1);
    border-color: var(--hero-end);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35), 0 0 0 4px color-mix(in srgb, var(--hero-end) 28%, transparent);
}

.timeline:hover .slider::-moz-range-thumb,
.timeline .slider:active::-moz-range-thumb,
.timeline:focus-within .slider::-moz-range-thumb {
    opacity: 1;
    transform: scale(1);
    border-color: var(--hero-end);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35), 0 0 0 4px color-mix(in srgb, var(--hero-end) 28%, transparent);
}

.volume-slider::-webkit-slider-thumb {
    opacity: 0.9;
    transform: scale(0.9);
    border-color: var(--hero-end);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}

.volume-slider::-moz-range-thumb {
    opacity: 0.9;
    transform: scale(0.9);
    border-color: var(--hero-end);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}

.volume:hover .volume-slider::-webkit-slider-thumb,
.volume:focus-within .volume-slider::-webkit-slider-thumb {
    opacity: 1;
    transform: scale(1);
    border-color: var(--hero-end);
}

.volume:hover .volume-slider::-moz-range-thumb,
.volume:focus-within .volume-slider::-moz-range-thumb {
    opacity: 1;
    transform: scale(1);
    border-color: var(--hero-end);
}

.volume-slider {
    background:
        linear-gradient(90deg, var(--hero-end), var(--hero-end)) 0 0 / var(--slider-progress, 0%) 100% no-repeat,
        color-mix(in srgb, var(--hero-end) 22%, transparent);
    transition: background 0.2s ease;

    &::-webkit-slider-runnable-track {
        height: 6px;
        border-radius: 999px;
        background:
            linear-gradient(90deg, var(--hero-end), var(--hero-end)) 0 0 / var(--slider-progress, 0%) 100% no-repeat,
            color-mix(in srgb, var(--hero-end) 22%, transparent);
    }

    &::-moz-range-track {
        height: 6px;
        border-radius: 999px;
        background:
            linear-gradient(90deg, var(--hero-end), var(--hero-end)) 0 0 / var(--slider-progress, 0%) 100% no-repeat,
            color-mix(in srgb, var(--hero-end) 22%, transparent);
    }
}

.controls {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    align-items: center;
    gap: 0.75rem;
    grid-template-areas: "settings player volume";

    .controls-pyler {
        grid-area: player;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .volume {
        grid-area: volume;
        display: grid;
        align-items: center;
        gap: 0.4rem;
        min-width: 180px;
        // justify-content: flex-end;
        grid-template-columns: 48px 1fr 48px
    }

    @media (max-width: 768px) {
        grid-template-columns: 1fr;
        grid-template-areas:
            "player"
            "volume";
        gap: 1rem;

        .controls-pyler {
            justify-content: center;
            order: 1;
        }

        .volume {
            min-width: unset;
            justify-content: center;
            padding: 0 1rem;
            order: 2;
        }
    }

    @media (max-width: 480px) {
        .primary {
            width: 54px;
            height: 54px;
        }

        .ghost {
            width: 38px;
            height: 38px;
        }
    }
}

button {
    border: none;
    cursor: pointer;
    color: #e8ecf1;
    background: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.22s ease;
}

button svg {
    width: 24px;
    height: 24px;
}

.ghost {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    white-space: nowrap;
}

.ghost:hover {
    background: rgba(255, 255, 255, 0.12);
    transform: translateY(-1px);
}

.primary {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent-a), var(--accent-b));
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}

.primary:hover {
    transform: translateY(-2px) scale(1.02);
}

@keyframes spin {
    from {
        transform: rotate(0deg);
    }

    to {
        transform: rotate(360deg);
    }
}
</style>
