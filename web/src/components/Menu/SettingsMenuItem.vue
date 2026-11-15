<script setup lang="ts">
interface Props {
    index: number; // 序列号
    isOpen: boolean;
    /** 禁用：不触发 click，不进入 tab 焦点 */
    disabled?: boolean;
    /**
     * 禁用时是否变淡（默认 true）。
     * 纯展示行（如聊天页「连接状态」）可以传 false：它本来就不是可点的操作，
     * 再叠一层 45% 透明度会让小字看不清。
     */
    dimWhenDisabled?: boolean;
}

interface Emits {
    (e: "click"): void;
}

const props = withDefaults(defineProps<Props>(), {
    disabled: false,
    dimWhenDisabled: true,
});
const emit = defineEmits<Emits>();

function handleClick() {
    if (props.disabled) return;
    emit("click");
}
</script>
<template>
    <div class="menu-list" :class="{ open: isOpen, disabled, dimmed: disabled && dimWhenDisabled }"
        :style="{ '--index': index }" @click="handleClick" @keydown.enter.prevent="handleClick" tabindex="0"
        role="menuitem" :aria-disabled="disabled || undefined" :inert="!isOpen || disabled">
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

// 禁用项（例如「发起群聊」好友不足两条时）：不响应 hover，展开后变淡。
// 变淡只写在展开态（.open）上：如果基础态也写 opacity，会盖掉 .menu-list 的
// opacity: 0，导致菜单一展开这一项没有淡入过渡、直接出现。
.menu-list.disabled {
    cursor: not-allowed;
}

.menu-list.disabled:hover {
    background-color: transparent;
}

.open.menu-list.dimmed {
    opacity: 0.45;
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
