<script setup lang="ts">
import { onUnmounted, ref, watch, useTemplateRef } from "vue";
import { useAuthStore } from "@/features/auth/stores";
import { notifySuccess, notifyError } from "@/utils/notification";
import { authApi } from "@/features/auth/api";
import { useRouter } from "vue-router";
import AuthTabs from "@/features/auth/components/login/AuthTabs.vue";
import LoginForm from "@/features/auth/components/login/LoginForm.vue";
import RegisterForm from "@/features/auth/components/login/RegisterForm.vue";

const router = useRouter();

const mode = ref<"login" | "register">("login");
const loginMethod = ref<"email" | "account" | "email-code">("email");

const email = ref("");
const password = ref("");
const nickName = ref("");
const userAccount = ref("");
const confirmPassword = ref("");
const code = ref("");
const sendingCode = ref(false);
const countdown = ref(0);
const userAccountError = ref("");
const lastAutouserAccount = ref("");

let countdownTimer: number | null = null;

watch(email, (newEmail) => {
  if (mode.value === "register") {
    const prefix = newEmail.split("@")[0] || "";
    // If userAccount is empty or matches the last auto-filled value, update it
    if (!userAccount.value || userAccount.value === lastAutouserAccount.value) {
      userAccount.value = prefix;
      lastAutouserAccount.value = prefix;
      userAccountError.value = "";
    }
  }
});

function generateRandomuserAccount(): void {
  userAccount.value = "mmjsb_" + Math.random().toString(36).slice(2, 10);
  userAccountError.value = ""; // Clear error when generating new
}

async function validateUserAccount(): Promise<void> {
  if (!userAccount.value || mode.value !== "register") return;

  try {
    await authApi.validateUserAccount(encodeURIComponent(userAccount.value));
    userAccountError.value = "";
  } catch (error: any) {
    if (error.response?.status === 409) {
      userAccountError.value = "账号名已存在";
    } else {
      userAccountError.value = "";
    }
  }
}

function startCountdown(seconds: number): void {
  countdown.value = seconds;
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer);
  }
  countdownTimer = window.setInterval(() => {
    if (countdown.value > 0) {
      countdown.value -= 1;
    } else {
      if (countdownTimer !== null) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }
  }, 1000);
}

const auth = useAuthStore();

const loginFormRef = useTemplateRef("loginFormRef");
const registerFormRef = useTemplateRef("registerFormRef");

async function handleLoginSubmit(): Promise<void> {
  try {
    let response;

    if (loginMethod.value === "email") {
      response = await authApi.loginWithEmail({
        email: email.value,
        password: password.value,
      });
    } else if (loginMethod.value === "account") {
      response = await authApi.loginWithAccount({
        userAccount: userAccount.value,
        password: password.value,
      });
    } else if (loginMethod.value === "email-code") {
      if (!code.value) {
        notifyError("请输入邮箱验证码");
        loginFormRef.value?.setLoading(false);
        return;
      }
      response = await authApi.loginWithEmailCode({
        email: email.value,
        code: code.value,
      });
    }

    if (response) {
      console.log("Login successful", response);
      auth.setSession(response.data);
      notifySuccess("登录成功");
      router.push("/home");
    }
  } catch (error: any) {
    if (error.response?.status === 401) {
      if (loginMethod.value === "email-code") {
        notifyError("登录失败：验证码错误或已过期");
      } else {
        notifyError("登录失败：账号或密码错误");
      }
    } else if (error.response?.status === 404) {
      notifyError("登录失败：该邮箱未注册");
    } else {
      notifyError("登录失败，请检查输入");
    }
  } finally {
    loginFormRef.value?.setLoading(false);
  }
}

async function handleRegisterSubmit(): Promise<void> {
  if (!userAccount.value) {
    notifyError("请输入账号名");
    registerFormRef.value?.setLoading(false);
    return;
  }

  // Ensure userAccount is validated
  if (userAccountError.value) {
    notifyError(userAccountError.value);
    registerFormRef.value?.setLoading(false);
    return;
  }

  // Optional: Double check if validation wasn't triggered
  await validateUserAccount();
  if (userAccountError.value) {
    notifyError(userAccountError.value);
    registerFormRef.value?.setLoading(false);
    return;
  }

  if (!code.value) {
    notifyError("请输入邮箱验证码");
    registerFormRef.value?.setLoading(false);
    return;
  }

  if (password.value.length < 6) {
    notifyError("密码长度至少为 6 位");
    registerFormRef.value?.setLoading(false);
    return;
  }

  if (password.value !== confirmPassword.value) {
    notifyError("两次输入的密码不一致");
    registerFormRef.value?.setLoading(false);
    return;
  }

  try {
    const response = await authApi.register({
      email: email.value,
      password: password.value,
      nickName: nickName.value || null,
      userAccount: userAccount.value || null,
      code: code.value,
    });
    auth.setSession(response.data);
    notifySuccess("注册并登录成功");
    router.push("/home");
  } catch (error: any) {
    if (error.response?.status === 409) {
      notifyError("注册失败：邮箱或用户名已被占用");
    } else {
      notifyError("注册失败，请检查输入");
    }
  } finally {
    registerFormRef.value?.setLoading(false);
  }
}

async function handleSendCode(): Promise<void> {
  if (!email.value) {
    notifyError("请先填写邮箱");
    return;
  }
  if (sendingCode.value || countdown.value > 0) {
    return;
  }
  sendingCode.value = true;
  try {
    // 根据当前模式确定actionType
    const actionType = mode.value === "register" ? "register" : "login";
    await authApi.sendEmailCode({
      email: email.value,
      actionType: actionType,
    });
    notifySuccess("验证码已发送，请检查邮箱");
    startCountdown(60);
  } catch (error: any) {
    const status = error?.response?.status as number | undefined;
    if (status === 429) {
      notifyError("请求过于频繁，请稍后再试");
    } else if (status === 409) {
      notifyError(mode.value === "register" ? "该邮箱已注册" : "该邮箱未注册");
    } else if (status === 400) {
      notifyError("邮箱格式不正确或请求无效");
    } else {
      notifyError("发送验证码失败，请稍后重试");
    }
  } finally {
    sendingCode.value = false;
  }
}

onUnmounted(() => {
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
});
</script>

<template>
  <div class="auth-container">
    <div class="auth-card">
      <h1 class="title">{{}}</h1>

      <LoginForm v-if="mode === 'login'" ref="loginFormRef" v-model:email="email" v-model:user-account="userAccount"
        v-model:password="password" v-model:code="code" v-model:sending-code="sendingCode" v-model:countdown="countdown"
        v-model:login-method="loginMethod" @sendCode="handleSendCode" @submit="handleLoginSubmit" />

      <RegisterForm v-else ref="registerFormRef" v-model:email="email" v-model:user-account="userAccount"
        v-model:password="password" v-model:confirm-password="confirmPassword" v-model:nick-name="nickName"
        v-model:code="code" v-model:sending-code="sendingCode" v-model:countdown="countdown"
        v-model:user-account-error="userAccountError" @send-code="handleSendCode"
        @generate-random-account="generateRandomuserAccount" @validate-account="validateUserAccount"
        @submit="handleRegisterSubmit" />

      <AuthTabs v-model="mode" />
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.auth-container {
  width: 100%;
  // --app-h 跟随地址栏/软键盘变化，移动端比 100vh 准确。
  min-height: var(--app-h);
  display: flex;
  align-items: center;
  justify-content: center;
  // 让开刘海与手势条，避免卡片贴到状态栏或系统手势区。
  padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right)) calc(12px + var(--safe-bottom)) calc(12px + var(--safe-left));
  box-sizing: border-box;
  background: radial-gradient(circle at top,
      var(--surface-soft),
      var(--bg-color));
}

.auth-card {
  width: 100%;
  max-width: 400px;
  background: var(--bg-elevated);
  padding: 32px;
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border-color);
}

.title {
  text-align: center;
  margin-bottom: 24px;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color);
}

// 480px 阈值保留，同时覆盖横屏手机（852x393 宽度超 480，
// 但纵向只有 393，卡片必须收紧内边距才放得下）。
@include rp.compact(480px) {
  .auth-card {
    margin: 0 16px;
    padding-inline: 16px;
    padding-top: 20px;
    padding-bottom: 24px;
  }

  .title {
    font-size: 18px;
  }
}
</style>
