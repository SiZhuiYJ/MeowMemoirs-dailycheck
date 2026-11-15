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
import {
    ref,
    onMounted,
    onBeforeUnmount,
    nextTick,
    computed,
    watch,
} from "vue";

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
const textRef = ref<HTMLElement | null>(null);

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

/**
 * 测量文字实际宽度并更新「是否需要滚动」。
 * 注意：同一轮 flush 中组件可能已被卸载（例如使用方给组件换 :key 强制重挂），
 * 此时 template ref 会被置为 null；即使还能拿到元素，也可能已经脱离文档（isConnected=false）。
 * 因此这里必须空值安全、永不抛错 —— 否则异常会冒到 main.ts 的全局 errorHandler，
 * 在页面正常的情况下错误地弹出「页面渲染异常，请刷新后重试」。
 */
function measureTextWidth(): void {
    const el = textRef.value;
    if (!el || !el.isConnected) return;

    textWidth.value = el.offsetWidth;
    needScroll.value = textWidth.value > props.width;
}

let textResizeObserver: ResizeObserver | null = null;

/**
 * 观察内层文字 span 自身的尺寸变化（字体加载完成、系统字号缩放等）后重新测量。
 * 刻意不观察外层 .marquee-container：容器宽度本来就是由测量结果决定的，
 * 观察它会形成「测量 → 改宽 → 再触发测量」的死循环。
 */
function observeTextElement(): void {
    if (textResizeObserver) return;

    const el = textRef.value;
    if (!el || !el.isConnected) return;

    // 极老的 WebView / 非浏览器环境（SSR、单元测试）没有 ResizeObserver，
    // 直接 new 会抛 ReferenceError；而这个 hook 在 mounted 里执行，
    // 异常同样会冒到全局 errorHandler 弹「渲染异常」toast。
    // 此时降级为只在挂载 / props 变化时测量一次，跑马灯基础功能不受影响。
    if (typeof ResizeObserver !== "function") return;

    textResizeObserver = new ResizeObserver(() => measureTextWidth());
    textResizeObserver.observe(el);
}

// 文本或目标容器宽度变化时由组件自己重新测量（等本次 DOM 更新完成后再量，拿到新文本宽度），
// 使用方不再需要通过换 :key 重挂组件来让跑马灯重新判断是否需要滚动。
watch(
    [() => props.text, () => props.width],
    () => {
        void nextTick(measureTextWidth);
    },
    { flush: "post" },
);

onMounted(() => {
    // 等首次渲染的 DOM 完成布局后再测量；若组件在 nextTick 续体执行前已被卸载，
    // measureTextWidth / observeTextElement 内部会做空值保护，不会抛错。
    void nextTick(() => {
        measureTextWidth();
        observeTextElement();
    });
});

onBeforeUnmount(() => {
    // 卸载时必须断开观察，避免 ResizeObserver 继续持有已销毁组件的回调。
    textResizeObserver?.disconnect();
    textResizeObserver = null;
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