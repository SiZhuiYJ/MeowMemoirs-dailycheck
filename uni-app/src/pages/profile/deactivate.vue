<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import http from '@/libs/http/config';
import { notifySuccess, notifyError } from '@/utils/notification';

const authStore = useAuthStore();
const themeStore = useThemeStore();

const loading = ref(false);
const deactivateCode = ref('');

// Verification Code Logic
const codeCountdown = ref(0);
let codeTimer: number | null = null;
const sendingCode = ref(false);

function startCodeCountdown(seconds: number = 60) {
    codeCountdown.value = seconds;
    if (codeTimer) clearInterval(codeTimer);
    codeTimer = setInterval(() => {
        if (codeCountdown.value > 0) {
            codeCountdown.value--;
        } else {
            if (codeTimer) {
                clearInterval(codeTimer);
                codeTimer = null;
            }
        }
    }, 1000);
}

async function handleSendVerificationCode() {
    if (!authStore.user?.email) {
        notifyError('无法获取用户邮箱');
        return;
    }
    if (sendingCode.value || codeCountdown.value > 0) return;

    sendingCode.value = true;
    try {
        await http.post('/mm/Auth/email-code', {
            email: authStore.user.email,
            actionType: 'deactivate'
        });
        notifySuccess('验证码已发送');
        startCodeCountdown();
    } catch (error: any) {
        const status = error.statusCode;
        if (status === 429) notifyError('请求过于频繁');
        else notifyError('发送失败');
    } finally {
        sendingCode.value = false;
    }
}

async function handleDeactivateConfirm() {
    if (!deactivateCode.value) {
        notifyError('请输入验证码');
        return;
    }

    loading.value = true;
    try {
        await http.post('/mm/Auth/deactivate', {
            code: deactivateCode.value
        });
        notifySuccess('账号已注销');
        authStore.clear();
        uni.reLaunch({ url: '/pages/auth/index' });
    } catch (error: any) {
        if (error.statusCode === 400) notifyError('验证码错误');
        else notifyError('注销失败');
    } finally {
        loading.value = false;
    }
}
function navigateBack() {
    uni.navigateBack();
}
onShow(() => {
    themeStore.updateNavBarColor();
});
</script>

<template>
    <view class="page-container" :style="themeStore.themeStyle">
        <NotificationSystem />

        <view class="page-card">
            <view class="form-field">
                <text class="modal-header">注销账号</text>
                <text class="warning-text">注销后账号将无法登录，所有数据保留30天后彻底删除。</text>

                <view class="code-row">
                    <input class="input code-input" v-model="deactivateCode" placeholder="验证码"
                        placeholder-class="input-placeholder" />
                    <button class="code-btn" :disabled="sendingCode || codeCountdown > 0"
                        @click="handleSendVerificationCode">
                        {{ codeCountdown > 0 ? `${codeCountdown}s` : (sendingCode ? '发送中...' : '获取验证码') }}
                    </button>
                </view>
            </view>
        </view>

        <view class="page-actions">
            <button class="modal-btn cancel" @click="navigateBack()">取消</button>
            <button class="modal-btn danger" :loading="loading" @click="handleDeactivateConfirm">确认注销</button>
        </view>
    </view>
</template>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";

.modal-header {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 8px;
}

.warning-text {
    display: block;
    color: #fa5151;
    margin-bottom: 12px;
}

.code-row {
    display: flex;
    gap: 8px;
}

.code-input {
    flex: 1;
}

.code-btn {
    width: 100px;
    height: 44px;
    line-height: 44px;
    text-align: center;
    padding: 0;
    font-size: 12px;
    background-color: #f9fafb;
    border: 1px solid #e5e7eb;
    color: #1f2937;
}

.page-actions {
    display: flex;
    gap: 12px;
    padding: 16px;
}

.modal-btn {
    flex: 1;
    height: 44px;
    border-radius: 8px;
    text-align: center;
    line-height: 44px;
    font-weight: 600;
    background: #f3f4f6;
}

.modal-btn.danger {
    background: #ff4d4f;
    color: white;
}

.modal-btn.cancel {
    background: #f3f4f6;
}
</style>
