<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import http from '@/libs/http/config';
import { notifyError, notifySuccess, notifyWarning } from '@/utils/notification';
import { APP_TITLE } from '@/config';
import { useCountdown } from '@/composables/useCountdown';
import MmNavBar from '@/components/MmNavBar.vue';

const themeStore = useThemeStore();
type Mode = 'login' | 'register' | 'wechat';

const mode = ref<Mode>('wechat'); // 添加微信模式
const loginMethod = ref<'email' | 'account'>('email');
const loading = ref(false);

const email = ref('');
const password = ref('');
const nickName = ref('');
const userAccount = ref('');
const userAccountError = ref('');
const lastAutouserAccount = ref('');
const confirmPassword = ref('');

const { countdown, startCountdown } = useCountdown(60);

watch(email, (newEmail) => {
  if (mode.value === 'register') {
    const prefix = newEmail.split('@')[0];
    if (!userAccount.value || userAccount.value === lastAutouserAccount.value) {
      userAccount.value = prefix;
      lastAutouserAccount.value = prefix;
      userAccountError.value = '';
    }
  }
});

const code = ref('');
const sendingCode = ref(false);

function generateRandomuserAccount() {
  userAccount.value = 'mmjsb_' + Math.random().toString(36).slice(2, 10);
  userAccountError.value = '';
}

async function validateuserAccount() {
  if (!userAccount.value || mode.value !== 'register') return;

  try {
    await http.post('/mm/Auth/validate-account?userAccount=' + encodeURIComponent(userAccount.value));
    userAccountError.value = '';
  } catch (error: any) {
    if (error.statusCode === 409) {
      userAccountError.value = '账号名已存在';
    } else {
      userAccountError.value = '';
    }
  }
}

const auth = useAuthStore();

async function handleSubmit() {
  if (mode.value === 'register') {
    if (!userAccount.value) {
      notifyError('请输入账号名');
      return;
    }
    // Ensure userAccount is validated
    if (userAccountError.value) {
      notifyError(userAccountError.value);
      return;
    }
    // Optional: Double check if validation wasn't triggered
    await validateuserAccount();
    if (userAccountError.value) {
      notifyError(userAccountError.value);
      return;
    }

    if (!code.value) {
      notifyError('请输入邮箱验证码');
      return;
    }
    if (password.value.length < 6) {
      notifyError('密码长度至少为 6 位');
      return;
    }
    if (password.value !== confirmPassword.value) {
      notifyError('两次输入的密码不一致');
      return;
    }
  }
  loading.value = true;
  try {
    if (mode.value === 'login') {
      let response;
      if (loginMethod.value === 'email') {
        response = await http.post<any>('/mm/Auth/login', {
          email: email.value,
          password: password.value,
        });
      } else {
        response = await http.post<any>('/mm/Auth/login-account', {
          userAccount: userAccount.value,
          password: password.value,
        });
      }
      // console.log(response.data);
      auth.setSession(response.data);
      notifySuccess('登录成功');
      setTimeout(() => {
        // Redirect to main page (which handles tabs manually)
        uni.reLaunch({ url: '/pages/main/index' });
      }, 1500);
    } else {
      const response = await http.post<any>('/mm/Auth/register', {
        email: email.value,
        password: password.value,
        nickName: nickName.value || null,
        userAccount: userAccount.value || null,
        code: code.value,
      });
      auth.setSession(response.data);
      notifySuccess('注册并登录成功');
      setTimeout(() => {
        uni.reLaunch({ url: '/pages/main/index' });
      }, 1500);
    }
  } catch (error: any) {
    if (error.statusCode === 401) {
      uni.showToast({ title: '账号或密码错误', icon: 'none' });
    } else if (error.statusCode === 409) {
      uni.showToast({ title: '用户名已被占用', icon: 'none' });
    } else {
      uni.showToast({ title: '操作失败', icon: 'none' });
    }
  } finally {
    loading.value = false;
  }
}

async function handleSendCode() {
  if (!email.value) {
    notifyWarning('请先填写邮箱');
    return;
  }
  if (sendingCode.value || countdown.value > 0) {
    return;
  }
  sendingCode.value = true;
  try {
    await http.post('/mm/Auth/email-code', {
      email: email.value,
      actionType: 'register'
    });
    notifySuccess('验证码已发送');
    startCountdown(60);
  } catch (error: any) {
    const status = error?.statusCode;
    if (status === 429) {
      notifyError('请求过于频繁');
    } else if (status === 409) {
      notifyError('该邮箱已注册');
    } else if (status === 400) {
      notifyError('邮箱格式不正确');
    } else {
      notifyError('发送失败');
    }
  } finally {
    sendingCode.value = false;
  }
}

function switchMode(next: Mode) {
  mode.value = next;
}
// 微信登录
async function handleWechatLogin() {

  try {
    // 1. 获取临时凭证
    uni.login({
      provider: 'weixin',
      success: async function (loginRes) {
        const code = loginRes.code;
        //	打印临时凭证
        console.log(code)
        // 2. 调用后端接口
        const response = await http.post<any>('/mm/Auth/wechat/login-auto', { code: code });
        auth.setSession(response.data);
        notifySuccess('登录成功');
        setTimeout(() => {
          // Redirect to main page (which handles tabs manually)
          uni.reLaunch({ url: '/pages/main/index' });
        }, 1500);
      },
    });
  } catch (error: any) {
    uni.showToast({ title: error.message, icon: 'none' });
  }
}
</script>

<template>
  <!-- 页面根节点绑定当前主题变量表，卡片 / 文字 / 强调色都跟随用户主题 -->
  <view class="auth-container" :style="themeStore.themeStyle">
    <MmNavBar title="登录/注册" />
    <NotificationSystem />
    <view class="auth-body">
      <view class="auth-card">
        <view class="title">{{ APP_TITLE }}</view>
        <view class="tabs">
          <view :class="['tab', mode === 'wechat' ? 'active' : '']" hover-class="mm-hover"
            @click="switchMode('wechat')">
            微信
          </view>
          <view :class="['tab', mode === 'login' ? 'active' : '']" hover-class="mm-hover" @click="switchMode('login')">
            登录
          </view>
          <view :class="['tab', mode === 'register' ? 'active' : '']" hover-class="mm-hover"
            @click="switchMode('register')">
            注册
          </view>
        </view>

        <view class="form">
          <view class="login-methods" v-if="mode === 'login'">
            <view :class="['method-tab', loginMethod === 'email' ? 'active' : '']" hover-class="mm-hover"
              @click="loginMethod = 'email'">邮箱登录
            </view>
            <view :class="['method-tab', loginMethod === 'account' ? 'active' : '']" hover-class="mm-hover"
              @click="loginMethod = 'account'">账号登录
            </view>
          </view>

          <view class="field" v-if="mode === 'login' && loginMethod === 'email' || mode === 'register'">
            <text>邮箱</text>
            <input class="input" v-model="email" type="text" placeholder="请输入邮箱" placeholder-class="input-placeholder" />
          </view>
          <view v-if="mode === 'register'" class="field code-field">
            <text>邮箱验证码</text>
            <view class="code-row">
              <input class="input" v-model="code" type="number" maxlength="6" placeholder="验证码"
                placeholder-class="input-placeholder" />
              <button class="code-button" :disabled="sendingCode || countdown > 0" @click="handleSendCode">
                <text v-if="countdown > 0">{{ countdown }}s</text>
                <text v-else-if="sendingCode">发送中...</text>
                <text v-else>获取验证码</text>
              </button>
            </view>
          </view>

          <view class="field" v-if="mode === 'login' && loginMethod === 'account' || mode === 'register'">
            <text>账号</text>
            <view class="input-row">
              <input class="input" :class="{ 'input-error': userAccountError }" v-model="userAccount" type="text"
                placeholder="账号" placeholder-class="input-placeholder" @blur="validateuserAccount"
                @input="userAccountError = ''" />
              <button v-if="mode === 'register'" class="mini-btn" @click="generateRandomuserAccount">随机</button>
            </view>
            <text v-if="userAccountError" class="error-msg">{{ userAccountError }}</text>
          </view>

          <view class="field"
            v-if="(mode === 'login' && loginMethod === 'account') || (mode === 'login' && loginMethod === 'email')">
            <text>密码</text>
            <input class="input" v-model="password" type="password" password placeholder="请输入密码"
              placeholder-class="input-placeholder" />
          </view>

          <view v-if="mode === 'register'" class="field">
            <text>确认密码</text>
            <input class="input" v-model="confirmPassword" type="password" password placeholder="再次输入密码"
              placeholder-class="input-placeholder" />
          </view>

          <view v-if="mode === 'register'" class="field">
            <text>昵称（可选）</text>
            <input class="input" v-model="nickName" type="text" placeholder="您的昵称"
              placeholder-class="input-placeholder" />
          </view>

          <button class="submit" :loading="loading" @click="handleSubmit" v-if="mode !== 'wechat'">
            {{ mode === 'login' ? '登录' : '注册并登录' }}
          </button>

          <button class="submit" :loading="loading" @click="handleWechatLogin" v-if="mode === 'wechat'">
            微信一键登录
          </button>
        </view>
      </view>
    </view>

  </view>

</template>

<style scoped lang="scss">
/*
  登录 / 注册页：对齐 web 端登录页的单色视觉
  · 浅灰底 + 顶部主题色径向微光（用 seed 的 rgb 通道做低透明度渐变，避免 color-mix）；
  · 白色圆角卡片：16 圆角 + 1px 描边 + 主题外发光阴影；
  · 输入框 44px 高 / 10 圆角 / 聚焦主题色描边；
  · 提交按钮使用 --theme-gradient，错误提示使用 --color-danger 系列。
  页面颜色全部来自根节点 :style="themeStore.themeStyle" 注入的 token，这里不再覆盖任何变量。
*/
.auth-container {
  min-height: 100vh;
  /* 顶栏固定在顶部：根容器改为纵向布局，卡片区域用 .auth-body 占满剩余高度并居中 */
  display: flex;
  flex-direction: column;
  padding: 16px var(--page-pad) calc(16px + var(--safe-bottom));
  background-color: var(--bg-color);
  background-image: radial-gradient(
    circle at top,
    rgba(var(--theme-color-rgb), 0.16),
    var(--bg-color) 62%
  );
  box-sizing: border-box;
}

/* 卡片区：顶栏占位之后剩余高度内保持原来的水平 / 垂直居中 */
.auth-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-card {
  width: 100%;
  max-width: 400px;
  background-color: var(--bg-elevated);
  padding: 20px;
  border-radius: 16px;
  border: 1px solid var(--border-color);
  box-shadow: var(--theme-outer-glow);
  box-sizing: border-box;
}

.title {
  text-align: center;
  margin-bottom: 20px;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color);
}

/* 页内 tab：胶囊形分段控件，选中项用主题色强化，未选中弱化为 muted */
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  padding: 4px;
  background-color: var(--surface-soft);
  border: 1px solid var(--border-color);
  border-radius: 10px;
}

.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 14px;
  transition: opacity 0.2s ease, color 0.2s ease;
}

.tab.active {
  background-color: var(--bg-elevated);
  color: var(--theme-color-strong);
  font-weight: 600;
  box-shadow: var(--theme-outer-glow-lighter);
}

.login-methods {
  display: flex;
  gap: 20px;
  margin-bottom: 12px;
}

/* 登录方式（邮箱 / 账号）小切换：选中态主题色文字 + 下划线 */
.method-tab {
  display: flex;
  align-items: center;
  min-height: 44px;
  font-size: 14px;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
}

.method-tab.active {
  color: var(--theme-color-strong);
  border-bottom-color: var(--theme-primary);
  font-weight: 600;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field text {
  font-size: 13px;
  color: var(--text-muted);
}

/* 输入框：44px 高、10 圆角；H5 用 focus-within（uni-input 内层 input 获焦） */
.input {
  width: 100%;
  height: var(--control-h);
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background-color: var(--bg-color);
  color: var(--text-color);
  font-size: 14px;
  box-sizing: border-box;
  transition: border-color 0.2s ease;
}

.input:focus,
.input:focus-within {
  border-color: var(--theme-primary);
  outline: none;
}

:deep(.input-placeholder) {
  color: var(--text-faint);
}

.input-row {
  display: flex;
  gap: 8px;
}

/* 次要按钮（随机 / 获取验证码）：主题浅底 + 主题色描边 + 主题色文字 */
.mini-btn,
.code-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: var(--control-h);
  padding: 0 12px;
  border-radius: 10px;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--theme-color-muted);
  color: var(--theme-color-strong);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  box-sizing: border-box;
}

.mini-btn {
  width: 64px;
}

.code-button {
  width: 104px;
}

.code-field .code-row {
  display: flex;
  gap: 8px;
}

.mini-btn::after,
.code-button::after,
.submit::after {
  border: none;
}

.code-button[disabled] {
  opacity: 0.5;
}

/* 主提交按钮：主题渐变底 + 44px 点击高度 */
.submit {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
  width: 100%;
  height: var(--control-h);
  border-radius: 10px;
  border: none;
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
}

.input-error {
  border-color: var(--color-danger) !important;
}

.error-msg {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-danger-text);
}
</style>
