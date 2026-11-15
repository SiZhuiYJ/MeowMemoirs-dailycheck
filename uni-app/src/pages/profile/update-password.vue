<script setup lang="ts">
import { ref, reactive } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import MmNavBar from '@/components/MmNavBar.vue';
import http from '@/libs/http/config';
import { notifySuccess, notifyError } from '@/utils/notification';

const authStore = useAuthStore();
const themeStore = useThemeStore();

onShow(() => {
  themeStore.updateNavBarColor();
});

const loading = ref(false);
const codeCountdown = ref(0);
let codeTimer: number | null = null;
const sendingCode = ref(false);
const verificationMethod = ref<'password' | 'code'>('password');

const pwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
  code: ''
});

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
      actionType: 'change-password'
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

async function handleChangePassword() {
  if (!pwdForm.newPassword) {
    notifyError('请输入新密码');
    return;
  }

  if (pwdForm.newPassword !== pwdForm.confirmPassword) {
    notifyError('两次输入的新密码不一致');
    return;
  }

  if (verificationMethod.value === 'code' && !pwdForm.code) {
    notifyError('请输入验证码');
    return;
  }

  if (verificationMethod.value === 'password' && !pwdForm.oldPassword) {
    notifyError('请输入旧密码');
    return;
  }

  loading.value = true;
  try {
    const payload: any = {
      newPassword: pwdForm.newPassword
    };

    if (verificationMethod.value === 'password') {
      payload.oldPassword = pwdForm.oldPassword;
    } else {
      payload.code = pwdForm.code;
    }

    await http.post('/mm/Auth/change-password', payload);
    notifySuccess('密码修改成功，请重新登录');
    authStore.clear();
    uni.reLaunch({ url: '/pages/auth/index' });
  } catch (error: any) {
    if (error.statusCode === 401) notifyError('旧密码错误');
    else if (error.statusCode === 400) notifyError('请求无效');
    else notifyError('修改失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <view class="page-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
    <MmNavBar title="修改密码" />
    <NotificationSystem />

    <!-- 分组小标题：13px 灰色，与全站设置页一致 -->
    <text class="group-title">安全设置</text>

    <view class="page-card">
      <view class="form-field">
        <text class="label">验证方式</text>
        <!-- 分段选择器：选中态用主题浅底 + 深色字（单色语言，不做多色高亮） -->
        <view class="method-selector">
          <view :class="['method-tab', verificationMethod === 'password' ? 'active' : '']" hover-class="mm-hover"
            @click="verificationMethod = 'password'">旧密码验证</view>
          <view :class="['method-tab', verificationMethod === 'code' ? 'active' : '']" hover-class="mm-hover"
            @click="verificationMethod = 'code'">验证码验证</view>
        </view>
      </view>

      <view class="form-field" v-if="verificationMethod === 'password'">
        <text class="label">旧密码</text>
        <input class="input" v-model="pwdForm.oldPassword" password
          placeholder="请输入旧密码" />
      </view>

      <view class="form-field" v-if="verificationMethod === 'code'">
        <text class="label">验证码</text>
        <view class="code-row">
          <input class="input code-input" v-model="pwdForm.code" 
            placeholder="请输入验证码" />
          <button class="code-btn" hover-class="mm-hover" :disabled="sendingCode || codeCountdown > 0"
            @click="handleSendVerificationCode">
            {{ codeCountdown > 0 ? `${codeCountdown}s` : (sendingCode ? '发送中...' : '获取验证码') }}
          </button>
        </view>
      </view>

      <view class="form-field">
        <text class="label">新密码</text>
        <input class="input" v-model="pwdForm.newPassword" password 
          placeholder="请输入新密码" />
      </view>

      <view class="form-field">
        <text class="label">确认新密码</text>
        <input class="input" v-model="pwdForm.confirmPassword" password 
          placeholder="请再次输入新密码" />
      </view>
    </view>

    <view class="page-actions">
      <button class="btn-primary" hover-class="mm-hover" :loading="loading" @click="handleChangePassword">保存</button>
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

/* 验证方式分段选择器：整体 44px 热区，浅灰底 + 1px 描边 */
.method-selector {
  display: flex;
  gap: 4px;
  padding: 4px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-sizing: border-box;
}

.method-tab {
  flex: 1;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: 8px;
  transition:
    color 0.2s ease,
    background-color 0.2s ease,
    opacity 0.2s ease;
}

/* 选中态：白底 + 主题强调色文字 + 1px 描边，保持单色克制 */
.method-tab.active {
  background-color: var(--bg-elevated);
  border-color: var(--border-color);
  color: var(--theme-color-strong);
  font-weight: 600;
  box-shadow: var(--theme-outer-glow-lighter);
}

.code-row {
  display: flex;
  gap: 8px;
}

.code-input {
  flex: 1;
}

/* 获取验证码：次级按钮（主题浅底 + 描边），高度对齐 44px 控规范 */
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
</style>
