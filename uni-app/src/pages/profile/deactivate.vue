<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import MmNavBar from '@/components/MmNavBar.vue';
import http from '@/libs/http/config';
import { notifySuccess, notifyError } from '@/utils/notification';

const authStore = useAuthStore();
const themeStore = useThemeStore();

const loading = ref(false);
const deactivateCode = ref('');

// 验证码倒计时逻辑
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
        <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
        <MmNavBar title="注销账号" />
        <NotificationSystem />

        <text class="group-title">危险操作</text>

        <view class="page-card">
            <view class="form-field">
                <text class="modal-header">注销账号</text>

                <!-- 危险提示：danger soft 底 + danger 描边，语义化提示 -->
                <view class="danger-notice">
                    <text class="warning-text">注销后账号将无法登录，所有数据保留30天后彻底删除。</text>
                </view>

                <view class="code-row">
                    <input class="input code-input" v-model="deactivateCode" placeholder="验证码"
                        placeholder-class="input-placeholder" />
                    <button class="code-btn" hover-class="mm-hover" :disabled="sendingCode || codeCountdown > 0"
                        @click="handleSendVerificationCode">
                        {{ codeCountdown > 0 ? `${codeCountdown}s` : (sendingCode ? '发送中...' : '获取验证码') }}
                    </button>
                </view>
            </view>
        </view>

        <view class="page-actions">
            <button class="modal-btn cancel" hover-class="mm-hover" @click="navigateBack()">取消</button>
            <button class="modal-btn danger" hover-class="mm-hover" :loading="loading"
                @click="handleDeactivateConfirm">确认注销</button>
        </view>
    </view>
</template>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";

/* 分组小标题：13px / 600 灰字 */
.group-title {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.02em;
    margin: 0 2px 8px;
}

/* 输入框聚焦：主题色描边（:focus-within 兼容 H5 的 uni-input 包裹层） */
.input:focus,
.input:focus-within {
    border-color: var(--theme-primary);
}

.modal-header {
    display: block;
    font-size: 17px;
    font-weight: 600;
    color: var(--text-color);
    margin-bottom: 10px;
}

/* 危险提示框：danger 浅底 + 描边 + 深色文字 */
.danger-notice {
    padding: 10px 12px;
    margin-bottom: 16px;
    background-color: var(--color-danger-soft);
    border: 1px solid var(--color-danger);
    border-radius: 10px;
}

.warning-text {
    display: block;
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-danger-text);
}

.code-row {
    display: flex;
    gap: 8px;
}

.code-input {
    flex: 1;
}

/* 获取验证码：次级按钮（主题浅底 + 描边），高度对齐 44px 控件规范 */
.code-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 112px;
    height: var(--control-h);
    padding: 0 8px;
    font-size: 12px;
    background-color: var(--theme-color-soft);
    border: 1px solid var(--theme-color-muted);
    color: var(--theme-color-strong);
    border-radius: 10px;
    box-sizing: border-box;
}

.code-btn[disabled] {
    opacity: 0.55;
}

.code-btn::after {
    border: none;
}

.page-actions {
    display: flex;
    gap: 12px;
    padding: 0;
}

.modal-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--control-h);
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    box-sizing: border-box;
}

.modal-btn.cancel {
    background-color: var(--surface-soft);
    border: 1px solid var(--border-color);
    color: var(--text-color);
}

/* 危险按钮：danger soft 底 + danger 描边 + danger 深色字 */
.modal-btn.danger {
    background-color: var(--color-danger-soft);
    border: 1px solid var(--color-danger);
    color: var(--color-danger-text);
}
</style>
