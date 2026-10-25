<script setup lang="ts">
import { ref } from 'vue'
import EmailInput from './EmailInput.vue'
import VerificationCodeInput from './VerificationCodeInput.vue'

const email = defineModel<string>('email')
const code = defineModel<string>('code')
const sendingCode = defineModel<boolean>('sendingCode')
const countdown = defineModel<number>('countdown')

interface Emits {
    (e: 'sendCode'): void
    (e: 'submit'): void
}

const emit = defineEmits<Emits>()

const loading = ref(false)

function handleSubmit() {
    if (!email.value || !code.value) {
        return
    }
    loading.value = true
    emit('submit')
    // 在父组件处理完后会重置loading状态
}

defineExpose({
    setLoading: (value: boolean) => {
        loading.value = value
    }
})
</script>

<template>
    <!-- 邮箱验证码登录 -->
    <form class="auth-form" @submit.prevent="handleSubmit">

        <EmailInput v-model="email" />

        <VerificationCodeInput v-model="code" :sending="sendingCode!" :countdown="countdown!" placeholder="请输入验证码"
            @send-code="emit('sendCode')" />

        <button class="auth-submit" type="submit" :disabled="loading || !email || !code">
            登录
        </button>
    </form>
</template>
