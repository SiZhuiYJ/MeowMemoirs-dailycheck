<script setup lang="ts">
/**
 * 邮箱换绑（直接内嵌在 /setting/profile 页面里，不使用弹窗）。
 *
 * 流程：
 *  1. 普通账号先验证当前身份（当前密码 / 当前邮箱验证码）；
 *  2. 再填入新邮箱，并输入新邮箱收到的验证码；
 *  3. 提交成功后用接口返回的新会话更新 store，页面上的邮箱立即刷新。
 *
 * 微信注册账号的邮箱是内部占位地址（wx_*@wechat.local），既没有用户可用的
 * 密码也收不到邮件，因此只验证新邮箱；具体判定与后端保持一致。
 */
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { authApi } from "@/features/auth/api";
import { useAuthStore } from "@/stores";
import { isWechatPlaceholderEmail, isValidEmail } from "@/utils/auth";
import { notifyError, notifySuccess } from "@/utils/notification";
import { useCountdown } from "@/composables/use-countdown";

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);

const currentEmail = computed(() => user.value?.email?.trim() ?? "");
const isWechatAccount = computed(() =>
  isWechatPlaceholderEmail(currentEmail.value),
);
const currentEmailText = computed(() =>
  isWechatAccount.value
    ? "未绑定邮箱（微信注册）"
    : currentEmail.value || "未绑定邮箱",
);

const verificationMethod = ref<"password" | "code">("password");
const password = ref("");
const currentCode = ref("");
const newEmail = ref("");
const newEmailCode = ref("");
const loading = ref(false);
const sendingCurrent = ref(false);
const sendingNew = ref(false);

const {
  countdown: currentCodeCountdown,
  start: startCurrentCodeCountdown,
  reset: resetCurrentCodeCountdown,
} = useCountdown();
const {
  countdown: newCodeCountdown,
  start: startNewCodeCountdown,
  reset: resetNewCodeCountdown,
} = useCountdown();

/** 新邮箱验证码实际发往的地址：改邮箱后清空已填验证码。 */
const codeSentTo = ref("");

function normalizedNewEmail() {
  return newEmail.value.trim().toLowerCase();
}

function resetForm() {
  verificationMethod.value = "password";
  password.value = "";
  currentCode.value = "";
  newEmail.value = "";
  newEmailCode.value = "";
  codeSentTo.value = "";
  resetCurrentCodeCountdown();
  resetNewCodeCountdown();
}

watch(newEmail, () => {
  if (!codeSentTo.value) return;
  if (normalizedNewEmail() === codeSentTo.value) return;

  // 用户改了目标邮箱：之前那封验证码自然作废，允许重新获取。
  newEmailCode.value = "";
  codeSentTo.value = "";
  resetNewCodeCountdown();
});

/** 从错误响应里取出后端返回的中文提示；拿不到时用兜底文案。 */
function readErrorMessage(error: unknown, fallback: string): string {
  const response = (
    error as { response?: { status?: number; data?: unknown } }
  )?.response;
  const data = response?.data;

  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  if (response?.status === 429) return "请求过于频繁，请稍后再试";
  if (response?.status === 409) return "该邮箱已被其他账号使用";
  if (response?.status === 400) return "请求无效，请检查输入";
  if (response?.status === 401) return "登录状态已失效，请重新登录";
  return fallback;
}

async function handleSendCurrentCode() {
  if (!currentEmail.value || isWechatAccount.value) {
    notifyError("当前邮箱不可用");
    return;
  }
  if (sendingCurrent.value || currentCodeCountdown.value > 0) return;

  sendingCurrent.value = true;
  try {
    await authApi.sendEmailCode(
      { email: currentEmail.value, actionType: "change-email-current" },
      { showError: false },
    );
    notifySuccess("验证码已发送到当前邮箱");
    startCurrentCodeCountdown();
  } catch (error) {
    notifyError(
      readErrorMessage(error, "当前邮箱验证码发送失败，请稍后重试"),
    );
  } finally {
    sendingCurrent.value = false;
  }
}

async function handleSendNewCode() {
  const email = normalizedNewEmail();
  if (!email) {
    notifyError("请先填写新邮箱");
    return;
  }
  if (!isValidEmail(email)) {
    notifyError("请输入正确的邮箱地址");
    return;
  }
  if (email === currentEmail.value.toLowerCase()) {
    notifyError("新邮箱不能与当前邮箱相同");
    return;
  }
  if (isWechatPlaceholderEmail(email)) {
    notifyError("该邮箱域名不可用");
    return;
  }
  if (sendingNew.value || newCodeCountdown.value > 0) return;

  sendingNew.value = true;
  try {
    await authApi.sendEmailCode(
      { email, actionType: "change-email" },
      { showError: false },
    );
    codeSentTo.value = email;
    notifySuccess("验证码已发送到新邮箱");
    startNewCodeCountdown();
  } catch (error) {
    notifyError(readErrorMessage(error, "新邮箱验证码发送失败，请稍后重试"));
  } finally {
    sendingNew.value = false;
  }
}

async function handleSubmit() {
  const email = normalizedNewEmail();
  if (!email) {
    notifyError("请输入新邮箱");
    return;
  }
  if (!isValidEmail(email)) {
    notifyError("请输入正确的邮箱地址");
    return;
  }
  if (email === currentEmail.value.toLowerCase()) {
    notifyError("新邮箱不能与当前邮箱相同");
    return;
  }
  if (isWechatPlaceholderEmail(email)) {
    notifyError("该邮箱域名不可用");
    return;
  }
  if (!newEmailCode.value.trim()) {
    notifyError("请输入新邮箱验证码");
    return;
  }
  if (!isWechatAccount.value) {
    if (verificationMethod.value === "password" && !password.value) {
      notifyError("请输入当前密码");
      return;
    }
    if (verificationMethod.value === "code" && !currentCode.value.trim()) {
      notifyError("请输入当前邮箱验证码");
      return;
    }
  }

  loading.value = true;
  try {
    const response = await authApi.changeEmail({
      newEmail: email,
      newEmailCode: newEmailCode.value.trim(),
      password:
        !isWechatAccount.value && verificationMethod.value === "password"
          ? password.value
          : null,
      currentEmailCode:
        !isWechatAccount.value && verificationMethod.value === "code"
          ? currentCode.value.trim()
          : null,
    });

    authStore.setSession(response.data);
    notifySuccess("邮箱换绑成功");
    resetForm();
  } catch (error) {
    notifyError(readErrorMessage(error, "邮箱换绑失败，请稍后重试"));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="email-form">
    <div class="setting-header">
      <h3 class="setting-title">换绑邮箱</h3>
      <p class="setting-subtitle">
        验证当前身份后绑定新的登录邮箱。
      </p>
    </div>

    <div class="setting-form">
      <div class="setting-field">
        <span>当前邮箱</span>
        <div class="email-current" :class="{ 'is-placeholder': isWechatAccount }">
          {{ currentEmailText }}
        </div>
      </div>

      <p v-if="isWechatAccount" class="setting-desc">
        当前账号由微信注册，还没有可用的真实邮箱。换绑后即可使用邮箱验证码登录。
      </p>

      <div v-else class="setting-field">
        <span>身份验证</span>
        <div class="method-selector">
          <label class="radio-label">
            <input v-model="verificationMethod" type="radio" value="password" :disabled="loading" />
            当前密码
          </label>
          <label class="radio-label">
            <input v-model="verificationMethod" type="radio" value="code" :disabled="loading" />
            当前邮箱验证码
          </label>
        </div>

        <input v-if="verificationMethod === 'password'" v-model="password" type="password"
          autocomplete="current-password" placeholder="请输入当前密码" :disabled="loading" />

        <div v-else class="setting-code-row">
          <input v-model="currentCode" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code"
            placeholder="当前邮箱验证码" :disabled="loading" />
          <button type="button" class="setting-code-button"
            :disabled="loading || sendingCurrent || currentCodeCountdown > 0" @click="handleSendCurrentCode">
            <span v-if="currentCodeCountdown > 0">{{ currentCodeCountdown }}s</span>
            <span v-else-if="sendingCurrent">发送中...</span>
            <span v-else>获取验证码</span>
          </button>
        </div>

        <span class="setting-desc">为保护账号安全，需要先验证当前身份。</span>
      </div>

      <label class="setting-field">
        <span>新邮箱</span>
        <input v-model="newEmail" type="email" autocomplete="email" placeholder="请输入新邮箱" :disabled="loading" />
      </label>

      <div class="setting-field">
        <span>新邮箱验证码</span>
        <div class="setting-code-row">
          <input v-model="newEmailCode" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code"
            placeholder="请输入验证码" :disabled="loading" />
          <button type="button" class="setting-code-button"
            :disabled="loading || sendingNew || newCodeCountdown > 0" @click="handleSendNewCode">
            <span v-if="newCodeCountdown > 0">{{ newCodeCountdown }}s</span>
            <span v-else-if="sendingNew">发送中...</span>
            <span v-else>获取验证码</span>
          </button>
        </div>
        <span class="setting-desc">换绑成功后，原邮箱将不能再用于登录。</span>
      </div>
    </div>

    <div class="setting-footer">
      <el-button type="primary" class="setting-submit" :loading="loading" @click="handleSubmit">
        确认换绑
      </el-button>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 卡片外壳由 profile 页的 .setting-card 提供；
// 表单 / 标签 / 说明文字见 features/setting/style/index.scss。
.email-form {
  display: flex;
  flex-direction: column;
}

// 只读的当前邮箱：虚线描边 + 内嵌底色，和可编辑输入框区分开。
.email-current {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-height: var(--setting-input-h);
  padding: 8px 10px;
  border: 1px dashed var(--chat-border-strong);
  border-radius: 8px;
  background: var(--chat-inset);
  color: var(--chat-text);
  font-size: 13px;
  line-height: 20px;
  word-break: break-all;

  &.is-placeholder {
    color: var(--chat-muted);
  }
}

// 验证码输入框需要在按钮旁边收缩，否则 100% 宽会把按钮挤出卡片。
.setting-code-row input {
  flex: 1;
  min-width: 0;
}

// 校验方式选择器与 /setting/password 保持同一套外观。
.method-selector {
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--chat-border);
  border-radius: 10px;
  background: var(--chat-inset);
}

.radio-label {
  flex: 1;
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 7px;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;

  input {
    accent-color: var(--chat-accent);
  }

  &:has(input:checked) {
    color: var(--chat-accent);
    background: var(--chat-accent-soft);
    font-weight: 600;
  }
}
</style>
