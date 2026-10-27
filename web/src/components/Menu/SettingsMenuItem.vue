<script setup lang="ts">
interface Props {
    index: number; // 序列号
    isOpen: boolean;
}

interface Emits {
    (e: "click"): void; // 点击事件，传递日期对象
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
</script>
<template>
    <div class="menu-list" :class="{ open: isOpen }" :style="{ '--index': index }" @click="emit('click')"
        @keydown.enter.prevent="emit('click')" tabindex="0" role="menuitem" :inert="!isOpen">
        <slot></slot>
    </div>
</template>
<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.menu-list {
    --delay: 0.4s;
    --trdelay: 0.15s;
    --index: 0;
    // 行高与 32 / 24px 的顶栏控件对齐，7 项不再占掉半屏
    padding: 5px 9px;
    border-radius: inherit;
    transition: background-color 0.2s 0s;
    position: relative;
    transform: translateY(30px);
    opacity: 0;
    font-size: 12px;
    line-height: 17px;
}

.menu-list::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    height: 1px;
    background-color: color-mix(in srgb, var(--theme-color-muted) 50%, transparent);
    width: 95%;
}

.menu-list:hover {
    background-color: var(--theme-color-soft);
}

.menu-list:focus-visible {
    outline: 2px solid var(--theme-color-strong);
    outline-offset: -2px;
}

.open.menu-list {
    transform: translateY(0);
    opacity: 1;
}

.open.menu-list {
    transition:
        transform 0.4s calc(var(--delay) + (var(--trdelay) * var(--index))),
        opacity 0.4s calc(var(--delay) + (var(--trdelay) * var(--index)));
}

// 手机 / 平板档：菜单行再收一档，和 24px 的触发按钮同一密度。
@include rp.device-mobile {
    .menu-list {
        padding: 4px 8px;
        font-size: 11px;
        line-height: 16px;
    }
}
</style>
