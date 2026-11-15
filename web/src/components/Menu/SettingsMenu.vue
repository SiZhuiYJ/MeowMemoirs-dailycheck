<script setup lang="ts">
// 使用语义化的 `isOpen` 表示菜单是否展开，默认关闭
const isOpen = ref<boolean>(false);

/**
 * `#title` 放触发器内容；默认插槽拿到 `isOpen`，菜单项据此播放展开动画。
 * 声明后 TypeScript 使用方里的 `{ isOpen }` 才是 boolean，而不是 any。
 */
defineSlots<{
    title?: () => unknown;
    default?: (props: { isOpen: boolean }) => unknown;
}>();

/**
 * 展开 / 收起时通知父级。
 * 聊天页「更多」菜单打开时要静默刷新一次黑名单计数，取代原 el-dropdown 的
 * `@visible-change`；不监听该事件的使用方（如设置页）不受影响。
 */
const emit = defineEmits<{
    "visible-change": [visible: boolean];
}>();

watch(isOpen, (visible) => emit("visible-change", visible));

const rootRef = useTemplateRef<HTMLElement>("rootRef");

/** 键盘（Enter / 空格）与标签点击共用的开关。 */
function toggleMenu() {
    isOpen.value = !isOpen.value;
}

/**
 * 点击菜单外部时收起：原来的 el-dropdown 由 popper 负责这件事，
 * 纯 CSS 菜单没有浮层，这里补一个 document 监听保持同样的交互。
 */
function handleDocumentPointerDown(event: PointerEvent) {
    if (!isOpen.value) return;

    const root = rootRef.value;
    const target = event.target;
    if (root && target instanceof Node && root.contains(target)) return;

    isOpen.value = false;
}

onMounted(() => {
    document.addEventListener("pointerdown", handleDocumentPointerDown);
});

onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
});
</script>

<template>
    <!-- 触发器做成可聚焦的按钮形态：原 el-dropdown 触发器可用键盘操作，
         这里补上 tabindex / Enter / 空格 / Esc，避免键盘用户打不开或关不掉菜单。 -->
    <label ref="rootRef" class="main" role="button" tabindex="0" aria-haspopup="menu" :aria-expanded="isOpen"
        @keydown.enter.prevent="toggleMenu" @keydown.space.prevent="toggleMenu" @keydown.esc="isOpen = false">
        <slot name="title"></slot>
        <input class="inp" type="checkbox" v-model="isOpen" :aria-expanded="isOpen" />
        <div class="bar">
            <span class="top bar-list"></span>
            <span class="middle bar-list"></span>
            <span class="bottom bar-list"></span>
        </div>
        <section class="menu-container">
            <slot :isOpen="isOpen"></slot>
        </section>
    </label>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.main>.inp {
    display: none;
}

.main {
    font-weight: 800;
    font-size: 13px;
    white-space: nowrap;
    // 设置页顶栏菜单本身也是深色动作按钮：底色用 action，文字用自动判定的 action 前景色
    color: var(--theme-action-contrast);
    background-color: var(--theme-action-bg);
    transition: background-color 0.2s ease;
    // 尺寸跟着新顶栏走：高 32 / 24px（--shell-control-h），宽度按视口收缩。
    // 只改这一组尺寸，汉堡与展开动画的逻辑保持不变。
    // 左右内边距做成变量：使用方（如顶栏用户菜单）需要把头像与上下留白对齐时
    // 可以单独收窄左侧；默认值保持原样，设置页 / 聊天页的纯文字标题不受影响。
    padding: 0 var(--settings-menu-pad-right, 10px) 0 var(--settings-menu-pad-left, 10px);
    border-radius: 10px;

    display: flex;
    align-items: center;
    height: var(--shell-control-h, 32px);
    // 宽度默认按视口收缩；使用方可以用 --settings-menu-width 覆盖
    // （例如顶栏用户菜单要放下头像 + 邮箱）。
    width: var(--settings-menu-width, clamp(7.5rem, 30vw, 10rem));
    position: relative;
    cursor: pointer;
    justify-content: space-between;

    &:hover {
        background-color: var(--theme-action-hover);
    }

    // 键盘聚焦时的可见焦点环（点击触发时不显示）
    &:focus-visible {
        outline: 2px solid var(--theme-color-strong);
        outline-offset: 2px;
    }
}

.menu-container {
    background-color: var(--bg-elevated);
    color: var(--theme-color-strong);
    border: 1px solid var(--theme-color-muted);
    border-radius: 8px;
    position: absolute;
    width: 100%;
    left: 0;
    // 紧贴 32 / 24px 的触发按钮，原来是 top: 130%（等于又空出半行）
    top: calc(100% + 6px);
    // 菜单是页面内的浮层（不像 el-dropdown 会 teleport 到 body），
    // 顶栏这类「后面紧跟着页面内容」的场景要抬高一层，避免被内容盖住。
    z-index: 10;
    overflow: hidden;
    /* 默认隐藏菜单，选中时显示 */
    clip-path: inset(10% 50% 90% 50% round 8px);
    transition: all 0.4s;
}

.inp:checked~.menu-container {
    /* 选中时展开 */
    clip-path: inset(0% 0% 0% 0% round 8px);
}

.bar {
    display: flex;
    height: 15px;
    width: 18px;
    flex-direction: column;
    gap: 3px;
}

.bar-list {
    --transform: -25%;
    display: block;
    width: 100%;
    height: 3px;
    border-radius: 50px;
    background-color: var(--theme-action-contrast);
    transition: all 0.4s;
    position: relative;
}

.inp:checked~.bar>.top {
    transform-origin: top right;
    transform: translateY(var(--transform)) rotate(-45deg);
}

.inp:checked~.bar>.middle {
    transform: translateX(-50%);
    opacity: 0;
}

.inp:checked~.bar>.bottom {
    transform-origin: bottom right;
    transform: translateY(calc(var(--transform) * -1)) rotate(45deg);
}

// 手机 / 平板档：按钮高度已经由 --shell-control-h 收到 24px，
// 这里只再收一下宽度、内边距与字号，菜单展开动画不变。
@include rp.device-mobile {
    .main {
        width: var(--settings-menu-width, clamp(7rem, 30vw, 9rem));
        padding: 0 var(--settings-menu-pad-right, 8px) 0 var(--settings-menu-pad-left, 8px);
        border-radius: 8px;
        font-size: 12px;
    }
}
</style>
