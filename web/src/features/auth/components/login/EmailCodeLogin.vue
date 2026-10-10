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
    <form class="form" @submit.prevent="handleSubmit">

        <EmailInput v-model="email" />

        <VerificationCodeInput v-model="code" :sending="sendingCode!" :countdown="countdown!" placeholder="请输入验证码"
            @send-code="emit('sendCode')" />

        <button class="submit" type="submit" :disabled="loading || !email || !code">
            登录
        </button>
    </form>
</template>

<style scoped lang="scss">
.form {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.submit {
    margin-top: 8px;
    padding: 12px;
    border-radius: 8px;
    border: none;
    background: linear-gradient(to right, var(--accent-color), var(--accent-alt));
    color: #fff;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
}

.submit:disabled {
    opacity: 0.7;
    cursor: not-allowed;
}

@media (max-width: 480px) {
    .submit {
        padding: 12px 0;
        font-size: 16px;
    }
}
</style>