<script setup lang="ts">
const props = defineProps<{
    isPinned: boolean;
}>();

const emit = defineEmits<{
    togglePinned: [];
}>();
</script>

<template>
    <!-- From Uiverse.io by vinodjangid07 -->
    <label class="container">
        <input type="checkbox" :checked="props.isPinned" @change="emit('togglePinned')" />
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 75 100" class="pin">
            <line stroke-width="12" stroke="currentColor" y2="100" x2="37" y1="64" x1="37"></line>
            <path stroke-width="10" stroke="currentColor"
                d="M16.5 36V4.5H58.5V36V53.75V54.9752L59.1862 55.9903L66.9674 67.5H8.03256L15.8138 55.9903L16.5 54.9752V53.75V36Z">
            </path>
        </svg>
    </label>
</template>


<style scoped lang="scss">
/* From Uiverse.io by vinodjangid07 */
.container input {
    display: none;
}

.pin {
    // 随控件高度缩放：32px 时约 15px、24px 时约 11px
    width: 47%;
    height: auto;
    transform: rotate(35deg);
    // 未选中：中性描边；选中后整颗图钉用主题色填充。
    // 不再写死黑色 / 紫色，夜间模式下才不会变成「黑描边看不见」。
    color: var(--chat-muted);
    fill: none;
    stroke: currentColor;
}

.container {
    // 与聊天页 / ChatDialog 的控件高度对齐（桌面 32px，手机平板 24px）。
    // 弹层把它放进了 .composer，45px 的旧尺寸会把底栏撑高。
    width: var(--chat-control-h, 45px);
    height: var(--chat-control-h, 45px);
    background-color: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: calc(var(--chat-control-h, 45px) * 0.22);
}

.container input:checked~.pin {
    color: var(--chat-accent);
    fill: currentColor;
    stroke: currentColor;
}

.container:hover {
    background-color: var(--chat-accent-soft);
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.06);
}

.container:active {
    transform: scale(0.9);
}
</style>
