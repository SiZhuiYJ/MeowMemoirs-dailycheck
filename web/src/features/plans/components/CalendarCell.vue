<script setup lang="ts">
interface Props {
    date: Date;// 日期对象
    statusClass: string;// 进度状态类名，根据状态返回不同的颜色类
    dayLabel: string;// 日期标签，通常是日期数字
    statusStyle: string;// 进度样式，格式为 '--progress: 50%;'，表示填充到50%
}

interface Emits {
    // 点击事件，传递日期对象
    (e: "click", date: Date): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// 处理点击事件，向父组件传递日期对象
function handleClick(): void {
    emit("click", props.date);
}
</script>

<template>
    <div :class="statusClass" :style="statusStyle" @click.stop="handleClick">
        <span class="day-label">
            <p>{{ dayLabel }}</p>
        </span>
    </div>
</template>

<style scoped lang="scss">
.day-label {
    width: 100%;
    height: 100%;
    border-radius: 10px;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;

    p {
        color: inherit; // 继承父元素颜色
    }
}

.cell {
    .day-label {
        position: relative; // 为伪元素提供定位参考
        overflow: hidden; // 确保填充不会溢出圆角

        p {
            position: relative;
            z-index: 2;
        }

        &::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: var(--progress, 0);
            background-color: inherit;
            transition: height 0.3s ease;
            z-index: 1;
            pointer-events: none; // 确保点击穿透
        }
    }
}
</style>