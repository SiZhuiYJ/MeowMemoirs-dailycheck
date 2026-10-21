<script setup lang="ts">
import { ref } from 'vue'
import EmailInput from './EmailInput.vue'
import AccountInput from './AccountInput.vue'
import PasswordInput from './PasswordInput.vue'
import VerificationCodeInput from './VerificationCodeInput.vue'


const email = defineModel<string>('email')
const userAccount = defineModel<string>('userAccount')
const password = defineModel<string>('password')
const confirmPassword = defineModel<string>('confirmPassword')
const nickName = defineModel<string>('nickName')
const code = defineModel<string>('code')
const sendingCode = defineModel<boolean>('sendingCode')
const countdown = defineModel<number>('countdown')
const userAccountError = defineModel<string>('userAccountError')


interface Emits {
    (e: 'sendCode'): void
    (e: 'generateRandomAccount'): void
    (e: 'validateAccount'): void
    (e: 'submit'): void
}

const emit = defineEmits<Emits>()

const loading = ref(false)

function handleSubmit() {
    loading.value = true
    emit('submit')
    // 在父组件处理完后会重置loading状态
}

function handleGenerateRandomAccount() {
    emit('generateRandomAccount')
}

function handleValidateAccount() {
    emit('validateAccount')
}

function handleAccountInput() {
    userAccountError.value = ''
}

defineExpose({
    setLoading: (value: boolean) => {
        loading.value = value
    }
})
</script>

<template>
    <form class="form" @submit.prevent="handleSubmit">
        <EmailInput v-model="email" />

        <VerificationCodeInput v-model="code" :sending="sendingCode!" :countdown="countdown!"
            @send-code="$emit('sendCode')" />

        <AccountInput v-model="userAccount" :required="true" :error="userAccountError" @blur="handleValidateAccount"
            @input="handleAccountInput">
            <template #suffix>
                <button type="button" class="btn-sm" @click="handleGenerateRandomAccount">
                    随机
                </button>
            </template>
        </AccountInput>

        <PasswordInput v-model="password" :required="true" label="密码" />

        <PasswordInput v-model="confirmPassword" :required="true" label="确认密码" placeholder="请确认密码" />

        <label class="field">
            <span>昵称（可选）</span>
            <input v-model="nickName" type="text" placeholder="请输入昵称" />
        </label>

        <button class="submit" type="submit" :disabled="loading">
            注册并登录
        </button>
    </form>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.form {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

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

.btn-sm {
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-elevated);
    color: var(--text-color);
    cursor: pointer;
    font-size: 11px;
    white-space: nowrap;
}

input:focus {
    border-color: var(--accent-color);
    outline: none;
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

// 480px 阈值保留，同时覆盖横屏手机。
@include rp.compact(480px) {
    .submit {
        padding: 12px 0;
        font-size: 15px;
    }
}
</style>