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
.menu-list {
    --delay: 0.4s;
    --trdelay: 0.15s;
    --index: 0;
    padding: 8px 10px;
    border-radius: inherit;
    transition: background-color 0.2s 0s;
    position: relative;
    transform: translateY(30px);
    opacity: 0;
}

.menu-list::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    height: 1px;
    background-color: rgba(0, 0, 0, 0.3);
    width: 95%;
}

.menu-list:hover {
    background-color: rgb(223, 223, 223);
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
</style>
