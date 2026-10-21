<script setup lang="ts">
const model = defineModel<string>()

interface Props {
    required?: boolean
    placeholder?: string
    label?: string
    type?: 'password' | 'text'
}

const props = withDefaults(defineProps<Props>(), {
    required: false,
    placeholder: '请输入密码',
    label: '密码',
    type: 'password'
})
</script>

<template>
    <label class="field">
        <span>{{ label }}</span>
        <input v-model="model" :type="type" :required="required" :placeholder="placeholder" />
    </label>
</template>

<style scoped lang="scss">
.field {
    display: flex;
    flex-direction: column;
    gap: 6px;

    span {
        font-size: 13px;
        color: var(--text-muted);
    }

    input {
        width: 100%;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        background: var(--bg-color);
        color: var(--text-color);
        font-size: 13px;
        transition: border-color 0.2s;
        box-sizing: border-box;
    }
}

input:focus {
    border-color: var(--accent-color);
    outline: none;
}
</style>