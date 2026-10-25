<script setup lang="ts">
interface Props {
    sending: boolean
    countdown: number
}

const model = defineModel<string>()

interface Emits {
    (e: 'sendCode'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

function handleSendCode() {
    emit('sendCode')
}
</script>

<template>
    <div class="auth-field">
        <span>邮箱验证码</span>
        <div class="auth-code-row">
            <input v-model="model" type="text" maxlength="6" inputmode="numeric" placeholder="请输入收到的验证码" />
            <button type="button" class="auth-code-button" :disabled="sending || countdown > 0" @click="handleSendCode">
                <span v-if="countdown > 0">{{ countdown }}s</span>
                <span v-else-if="sending">发送中...</span>
                <span v-else>获取验证码</span>
            </button>
        </div>
    </div>
</template>
