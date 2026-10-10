<script setup lang="ts">
import { ref, reactive } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
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
    <NotificationSystem />
    
    <view class="page-card">
      <view class="form-field">
        <text class="label">验证方式</text>
        <view class="method-selector">
          <view :class="['method-tab', verificationMethod === 'password' ? 'active' : '']"
            @click="verificationMethod = 'password'">旧密码验证</view>
          <view :class="['method-tab', verificationMethod === 'code' ? 'active' : '']"
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
          <button class="code-btn" :disabled="sendingCode || codeCountdown > 0"
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
      <button class="btn-primary" :loading="loading" @click="handleChangePassword">保存</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";

.method-selector {
  display: flex;
  margin-bottom: 16px;
  background-color: #f3f4f6;
  padding: 4px;
  border-radius: 8px;
}

.method-tab {
  flex: 1;
  text-align: center;
  padding: 8px 0;
  font-size: 14px;
  color: #6b7280;
  border-radius: 6px;
  transition: all 0.2s;
}

.method-tab.active {
  background-color: #ffffff;
  color: #1f2937;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
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
  border-radius: 8px;
}

.code-btn[disabled] {
  opacity: 0.6;
}

.code-btn::after {
  border: none;
}
</style>