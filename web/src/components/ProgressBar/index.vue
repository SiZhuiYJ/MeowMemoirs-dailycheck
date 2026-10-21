<script setup lang="ts">
import { computed } from 'vue'

interface Props {
    progress: number     // 进度 0.0 - 1.0
    color?: string       // 进度条颜色
    trackColor?: string  // 轨道颜色
    radius?: number      // 半径 (相对于 viewBox 200x200)
    size?: number        // 组件整体大小 (px)
    strokeWidth?: number // 线条宽度 (相对于 viewBox 200x200)
}

const props = withDefaults(defineProps<Props>(), {
    color: '#22c55e', // 默认绿色
    trackColor: '#eee',
    radius: 40,
    size: 100,
    strokeWidth: 6
})

// 周长 = 2 * π * r
const circumference = computed(() => 2 * Math.PI * props.radius)

// 计算 stroke-dashoffset
const dashOffset = computed(() => {
    // 限制 progress 在 0-1 之间
    const p = Math.max(0, Math.min(1, props.progress))
    return circumference.value * (1 - p)
})

const percentage = computed(() => Math.round(props.progress * 100))
</script>

<template>
    <view class="progress-container" :style="{ width: props.size + 'px', height: props.size + 'px' }">
        <svg class="progress-ring" :width="props.size" :height="props.size" viewBox="0 0 200 200">
            <!-- 背景圆 -->
            <circle cx="100" cy="100" :r="props.radius" class="progress-background" fill="none"
                :stroke="props.trackColor" :stroke-width="props.strokeWidth" />
            <!-- 进度圆 -->
            <circle cx="100" cy="100" :r="props.radius" class="progress-foreground" fill="none" :stroke="props.color"
                :stroke-width="props.strokeWidth" :stroke-dasharray="circumference" :stroke-dashoffset="dashOffset" />
        </svg>

        <!-- 内容插槽 -->
        <view class="progress-content">
            <slot :percentage="percentage">
                <text class="default-text">{{ percentage }}%</text>
            </slot>
        </view>
    </view>
</template>

<style scoped>
.progress-container {
    position: relative;
    display: inline-flex;
    justify-content: center;
    align-items: center;
}

.progress-ring {
    transform: rotate(-90deg);
    transform-origin: center;
}

.progress-background {
    transition: stroke 0.3s;
}

.progress-foreground {
    stroke-linecap: round;
    transition: stroke-dashoffset 0.5s ease-out, stroke 0.3s;
}

.progress-content {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1;
}

.default-text {
    font-size: 13px;
    font-weight: bold;
    color: #333;
}
</style>
