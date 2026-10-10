<script setup lang="ts">
const model = defineModel<string>()
</script>

<template>
    <label class="field">
        <span>邮箱</span>
        <input v-model="model" type="email" required placeholder="请输入邮箱" />
    </label>
</template>

<style scoped lang="scss">
.field {
    display: flex;
    flex-direction: column;
    gap: 6px;

    span {
        font-size: 14px;
        color: var(--text-muted);
    }

    input {
        width: 100%;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        background: var(--bg-color);
        color: var(--text-color);
        font-size: 14px;
        transition: border-color 0.2s;
        box-sizing: border-box;
    }
}

input:focus {
    border-color: var(--accent-color);
    outline: none;
}
</style>