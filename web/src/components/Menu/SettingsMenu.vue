<script setup lang="ts">
// 使用语义化的 `isOpen` 表示菜单是否展开，默认关闭
const isOpen = ref<boolean>(false);
</script>

<template>
    <label class="main">
        <slot name="title"></slot>
        <input class="inp" type="checkbox" v-model="isOpen" aria-expanded="false" />
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
    padding: 0 10px;
    border-radius: 10px;

    display: flex;
    align-items: center;
    height: var(--shell-control-h, 32px);
    width: clamp(7.5rem, 30vw, 10rem);
    position: relative;
    cursor: pointer;
    justify-content: space-between;

    &:hover {
        background-color: var(--theme-action-hover);
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
        width: clamp(7rem, 30vw, 9rem);
        padding: 0 8px;
        border-radius: 8px;
        font-size: 12px;
    }
}
</style>
