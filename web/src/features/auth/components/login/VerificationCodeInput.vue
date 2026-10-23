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
    <div class="field code-field">
        <span>邮箱验证码</span>
        <div class="code-row">
            <input v-model="model" type="text" maxlength="6" inputmode="numeric" placeholder="请输入收到的验证码" />
            <button type="button" class="code-button" :disabled="sending || countdown > 0" @click="handleSendCode">
                <span v-if="countdown > 0">{{ countdown }}s</span>
                <span v-else-if="sending">发送中...</span>
                <span v-else>获取验证码</span>
            </button>
        </div>
    </div>
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
}

.code-field .code-row {
    display: flex;
    gap: 8px;
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

input:focus {
    border-color: var(--accent-color);
    outline: none;
}

.code-button {
    width: 100px;
    border-radius: 8px;
    border: 1px solid var(--theme-color-muted);
    background: var(--theme-color-soft);
    color: var(--theme-color-strong);
    cursor: pointer;
    font-size: 11px;
    transition: background-color 0.2s ease, color 0.2s ease;

    &:hover:not(:disabled) {
        background: var(--theme-primary-bg);
        color: var(--theme-color-contrast);
    }
}

.code-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>