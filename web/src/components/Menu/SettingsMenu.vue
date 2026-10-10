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
.main>.inp {
    display: none;
}

.main {
    font-weight: 800;
    color: white;
    background-color: darkviolet;
    padding: 3px 15px;
    border-radius: 10px;

    display: flex;
    align-items: center;
    height: 2.5rem;
    width: 12rem;
    position: relative;
    cursor: pointer;
    justify-content: space-between;
}

.arrow {
    height: 34%;
    aspect-ratio: 1;
    margin-block: auto;
    position: relative;
    display: flex;
    justify-content: center;
    transition: all 0.3s;
}

.arrow::after,
.arrow::before {
    content: "";
    position: absolute;
    background-color: white;
    height: 100%;
    width: 2.5px;
    border-radius: 500px;
    transform-origin: bottom;
}

.arrow::after {
    transform: rotate(35deg) translateX(-0.5px);
}

.arrow::before {
    transform: rotate(-35deg) translateX(0.5px);
}

.main>.inp:checked+.arrow {
    transform: rotateX(180deg);
}

.menu-container {
    background-color: white;
    color: darkviolet;
    border-radius: 10px;
    position: absolute;
    width: 100%;
    left: 0;
    top: 130%;
    overflow: hidden;
    /* 默认隐藏菜单，选中时显示 */
    clip-path: inset(10% 50% 90% 50% round 10px);
    transition: all 0.4s;
}

.inp:checked~.menu-container {
    /* 选中时展开 */
    clip-path: inset(0% 0% 0% 0% round 10px);
}

.bar-inp {
    -webkit-appearance: none;
    display: none;
    visibility: hidden;
}

.bar {
    display: flex;
    height: 50%;
    width: 20px;
    flex-direction: column;
    gap: 3px;
}

.bar-list {
    --transform: -25%;
    display: block;
    width: 100%;
    height: 3px;
    border-radius: 50px;
    background-color: white;
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
</style>
