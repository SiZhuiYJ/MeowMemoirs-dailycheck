<script setup lang="ts">
import { ref } from 'vue'
import EmailInput from './EmailInput.vue'
import AccountInput from './AccountInput.vue'
import PasswordInput from './PasswordInput.vue'
import LoginMethods from './LoginMethods.vue'
import EmailCodeLogin from './EmailCodeLogin.vue'

const email = defineModel<string>('email')
const userAccount = defineModel<string>('userAccount')
const password = defineModel<string>('password')
const code = defineModel<string>('code')
const sendingCode = defineModel<boolean>('sendingCode')
const countdown = defineModel<number>('countdown')
const loginMethod = defineModel<'email' | 'account' | 'email-code'>('loginMethod')

interface Emits {
    (e: 'sendCode'): void
    (e: 'submit'): void
}

const emit = defineEmits<Emits>()

const loading = ref(false)

function handleSubmit() {
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
    <LoginMethods v-model="loginMethod" />
    <!-- 邮箱密码登录 -->
    <form v-if="loginMethod === 'email'" class="form" @submit.prevent="handleSubmit">

        <EmailInput v-model="email" />

        <PasswordInput v-model="password" :required="true" />

        <button class="submit" type="submit" :disabled="loading">
            登录
        </button>
    </form>

    <!-- 账号密码登录 -->
    <form v-else-if="loginMethod === 'account'" class="form" @submit.prevent="handleSubmit">

        <AccountInput v-model="userAccount" :required="true" />

        <PasswordInput v-model="password" :required="true" />

        <button class="submit" type="submit" :disabled="loading">
            登录
        </button>
    </form>

    <!-- 邮箱验证码登录 -->
    <EmailCodeLogin v-else-if="loginMethod === 'email-code'" v-model:email="email" v-model:code="code"
        :sending-code="sendingCode" :countdown="countdown" :login-method="loginMethod" @send-code="$emit('sendCode')"
        @submit="handleSubmit" />

    <!-- <CodeLogin /> -->
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

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
    background: var(--theme-gradient);
    color: var(--theme-action-contrast);
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
}

.submit:disabled {
    opacity: 0.7;
    cursor: not-allowed;
}

// 480px 阈值保留，同时覆盖横屏手机。
@include rp.compact(480px) {
    .submit {
        padding: 12px 0;
        font-size: 15px;
    }
}
</style>
