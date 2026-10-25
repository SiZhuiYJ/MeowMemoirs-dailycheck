<script setup lang="ts">
const model = defineModel<string>()
</script>

<template>
    <label class="auth-field">
        <span>邮箱</span>
        <input v-model="model" type="email" required placeholder="请输入邮箱" />
    </label>
</template>
