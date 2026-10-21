<script setup lang="ts">
const model = defineModel<'login' | 'register'>()
</script>

<template>
    <div class="auth-tabs-wrapper">
        <div class="tabs">
            <button type="button" :class="['tab', modelValue === 'login' ? 'active' : '']"
                @click="() => model = 'login'">
                登录
            </button>
            <span class="divider">|</span>
            <button type="button" :class="['tab', modelValue === 'register' ? 'active' : '']"
                @click="() => model = 'register'">
                注册
            </button>
        </div>
    </div>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.auth-tabs-wrapper {
    display: flex;
    justify-content: center;
    margin-top: 24px;
    opacity: 0.7;
    transition: opacity 0.2s ease;
}

.auth-tabs-wrapper:hover {
    opacity: 1;
}

.tabs {
    display: inline-flex;
    background: transparent;
    padding: 0;
    border-radius: 12px;
    width: fit-content;
    box-shadow: none;
}

.tab {
    flex: 1;
    border: none;
    background: transparent;
    padding: 8px 16px;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
    font-weight: 400;
    transition: all 0.2s ease;
    min-width: 60px;
    position: relative;
    font-size: 13px;
    border-bottom: 2px solid transparent;
}

.tab.active {
    color: var(--accent-color);
    font-weight: 500;
    border-bottom-color: var(--accent-color);
}

.tab:not(.active):hover {
    color: var(--text-color);
    background: rgba(255, 255, 255, 0.03);
}

.divider {
    color: var(--text-muted);
    opacity: 0.5;
    padding: 0 8px;
    font-weight: 300;
    align-self: center;
}

// 480px 阈值保留，同时覆盖横屏手机（宽度超 480 但高度只有手机级别）。
@include rp.compact(480px) {
    .auth-tabs-wrapper {
        margin-top: 20px;
    }

    .tab {
        padding: 6px 12px;
        font-size: 13px;
        min-width: 50px;
    }
}
</style>