<script setup lang="ts">

const model = defineModel<string>()
interface Props {
    required?: boolean
    placeholder?: string
    label?: string
    error?: string
}

interface Emits {
    (e: 'blur'): void
    (e: 'input'): void
}

const props = withDefaults(defineProps<Props>(), {
    required: false,
    placeholder: '请输入账号',
    label: '账号'
})
const emit = defineEmits<Emits>()



function handleInput() {
    emit('input')
}

function handleBlur() {
    emit('blur')
}
</script>

<template>
    <label class="field">
        <span>{{ label }}</span>
        <div class="input-group">
            <input v-model="model" type="text" :required="required" :placeholder="placeholder" @blur="handleBlur"
                @input="handleInput" :class="{ 'input-error': error }" />
            <slot name="suffix"></slot>
        </div>
        <span v-if="error" class="error-msg">{{ error }}</span>
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

.input-group {
    display: flex;
    gap: 8px;
}

input:focus {
    border-color: var(--accent-color);
    outline: none;
}

.input-error {
    border-color: #ef4444;
}

.error-msg {
    font-size: 11px;
    color: #ef4444;
}
</style>