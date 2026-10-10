<script setup lang="ts">
// ProgressRing component (renamed from ProgressBar to avoid conflicts)
import { computed } from 'vue'

interface Props {
    progress: number     // 进度 0.0 - 1.0
    color?: string       // 进度条颜色
    trackColor?: string  // 轨道颜色
    radius?: number      // 半径 (deprecated in CSS version)
    size?: number        // 组件整体大小 (px)
    strokeWidth?: number // 线条宽度 (px)
}

const props = withDefaults(defineProps<Props>(), {
    color: '#22c55e', // 默认绿色
    trackColor: '#eee',
    radius: 40,
    size: 100,
    strokeWidth: 6
})

const percentage = computed(() => Math.round(props.progress * 100))

const ringStyle = computed(() => {
    const p = Math.max(0, Math.min(1, props.progress)) * 100
    // 计算遮罩半径比例
    // 内半径 = size/2 - strokeWidth
    // 比例 = (内半径 / (size/2)) * 100
    const innerRadius = (props.size / 2) - props.strokeWidth
    const maskPercentage = (innerRadius / (props.size / 2)) * 100
    
    // 确保比例在合理范围内
    const safeMaskPercentage = Math.max(0, Math.min(99, maskPercentage))

    return {
        width: props.size + 'px',
        height: props.size + 'px',
        background: `conic-gradient(${props.color} ${p}%, ${props.trackColor} 0)`,
        // 使用 mask 实现环形
        'mask-image': `radial-gradient(transparent ${safeMaskPercentage}%, black ${safeMaskPercentage + 0.5}%)`,
        '-webkit-mask-image': `radial-gradient(transparent ${safeMaskPercentage}%, black ${safeMaskPercentage + 0.5}%)`,
        'border-radius': '50%'
    }
})
</script>

<template>
    <view class="progress-container" :style="{ width: props.size + 'px', height: props.size + 'px' }">
        <!-- CSS Ring -->
        <view class="progress-ring" :style="ringStyle"></view>

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
    position: absolute;
    top: 0;
    left: 0;
}

.progress-content {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
}

.default-text {
    font-size: 14px;
    font-weight: bold;
    color: #333;
}
</style>