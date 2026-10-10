<template>
    <div class="marquee-container" :style="{ width: realContainerWidth + 'px' }" ref="containerRef">
        <div class="marquee-content" :class="animationClass" :style="contentStyle" ref="contentRef">
            <span ref="textRef">{{ text }}</span>

            <!-- scroll模式需要复制一份 -->
            <span v-if="mode === 'scroll' && needScroll">{{ text }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from "vue";

interface Props {
    text: string;
    width?: number; // 容器宽度
    speed?: number; // px/s
    mode?: "bounce" | "scroll";
    shrinkWhenShort?: boolean; // 文本短是否缩容
    gap?: number; // scroll间距
}

const props = withDefaults(defineProps<Props>(), {
    width: 200,
    speed: 50,
    mode: "bounce",
    shrinkWhenShort: true,
    gap: 40,
});

// const containerRef = ref<HTMLElement>();
// const contentRef = ref<HTMLElement>();
const textRef = ref<HTMLElement>();

const textWidth = ref(0);
const needScroll = ref(false);

const realContainerWidth = computed(() => {
    if (!props.shrinkWhenShort) return props.width;
    return needScroll.value ? props.width : textWidth.value;
});

const animationClass = computed(() => {
    if (!needScroll.value) return "";
    return props.mode === "bounce" ? "bounce" : "scroll";
});

const contentStyle = computed(() => {
    if (!needScroll.value) return {};

    const distance =
        props.mode === "bounce"
            ? textWidth.value - props.width
            : textWidth.value + props.gap;

    const duration = distance / props.speed;

    return {
        "--distance": `${distance}px`,
        "--duration": `${duration}s`,
        "--gap": `${props.gap}px`,
    };
});

onMounted(async () => {
    await nextTick();

    textWidth.value = textRef.value!.offsetWidth;
    needScroll.value = textWidth.value > props.width;
});
</script>

<style scoped>
.marquee-container {
    overflow: hidden;
    white-space: nowrap;
    position: relative;
}

.marquee-content {
    display: inline-flex;
    align-items: center;
}

/* 来回滚动 */
.bounce {
    animation: bounce var(--duration) linear infinite alternate;
}

@keyframes bounce {
    from {
        transform: translateX(0);
    }

    to {
        transform: translateX(calc(-1 * var(--distance)));
    }
}

/* 单向滚动 */
.scroll {
    animation: scroll var(--duration) linear infinite;
}

.scroll span {
    margin-right: var(--gap);
}

@keyframes scroll {
    from {
        transform: translateX(0);
    }

    to {
        transform: translateX(calc(-1 * var(--distance)));
    }
}
</style>