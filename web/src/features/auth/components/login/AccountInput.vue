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
    <label class="auth-field">
        <span>{{ label }}</span>
        <div class="auth-input-group">
            <input v-model="model" type="text" :required="required" :placeholder="placeholder" @blur="handleBlur"
                @input="handleInput" :class="{ 'auth-input-error': error }" />
            <slot name="suffix"></slot>
        </div>
        <span v-if="error" class="auth-error-msg">{{ error }}</span>
    </label>
</template>
