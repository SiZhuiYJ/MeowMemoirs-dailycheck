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
    <label class="auth-field">
        <span>{{ label }}</span>
        <input v-model="model" :type="type" :required="required" :placeholder="placeholder" />
    </label>
</template>
