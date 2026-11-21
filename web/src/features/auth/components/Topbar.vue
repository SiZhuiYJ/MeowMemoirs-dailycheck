<script setup lang="ts">

import ProgressiveAvatar from "@/components/ProgressiveAvatar/index.vue";
import SettingsMenu from "@/components/Menu/SettingsMenu.vue";
import SettingsMenuItem from "@/components/Menu/SettingsMenuItem.vue";
import MarqueeText from "@/components/Text/MarqueeText.vue";
import AppDialog from "@/components/AppDialog.vue";
import ThemeColorDialog from "@/components/ThemeColorDialog.vue";
import { useAuthStore } from "@/features/auth/stores";
import { authApi } from "@/features/auth/api/index";
import type { PasswordPayload } from "@/features/auth/types";
import { ElMessageBox } from "element-plus";
import { notifySuccess, notifyError } from "@/utils/notification";
import { APP_TITLE } from "@/config";
import { getUserAvatarSources } from "@/utils/avatar";
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import router from "@/routers/index";
import { maskEmail, maskString } from "@/utils/auth";
import { useTheme } from "@/composables/use-theme";
const { user } = storeToRefs(useAuthStore());
const currentAvatar = computed(() => getUserAvatarSources(user.value?.userId, user.value?.avatarKey));

// 顶栏菜单标题：与原下拉一致，打码邮箱（+ 打码昵称）。
// 放不下时由 MarqueeText 左右来回滚动，而不是用 CSS 省略号。
const userMenuText = computed(() => {
  const email = user.value?.email;
  if (!email) return "";
  const nickName = user.value?.nickName;
  return `${maskEmail(email)}${nickName ? `(${maskString(nickName)})` : ""}`;
});
const userInitial = computed(() => {
  const nickName = user.value?.nickName?.trim();
  return nickName ? nickName.charAt(0).toUpperCase() : "U";
});

// SVG Icons
const MoonIcon = {
  render: () =>
    h("svg", { viewBox: "0 0 24 24", width: "1.2em", height: "1.2em" }, [
      h("path", {
        fill: "currentColor",
        d: "M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z",
      }),
    ]),
};

const SunIcon = {
  render: () =>
    h("svg", { viewBox: "0 0 24 24", width: "1.2em", height: "1.2em" }, [
      h("path", {
        fill: "currentColor",
        d: "M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.79 1.41-1.41-1.79-1.79-1.41 1.41zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z",
      }),
    ]),
};

// 顶部导航图标：首页（与主题切换按钮同一套圆形按钮样式）
const HomeIcon = {
  render: () =>
    h("svg", { viewBox: "0 0 24 24", width: "1.2em", height: "1.2em" }, [
      h("path", {
        fill: "currentColor",
        d: "M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3l9-8z",
      }),
    ]),
};

// 顶部导航入口：首页（当前路由高亮）
const route = useRoute();
const isHomeActive = computed(
  () => route.path === "/home" || route.path === "/",
);

function goToNav(path: string): void {
  if (route.path === path) return;
  void router.push(path);
}

const authStore = useAuthStore();

// 主题状态与切换动画统一由 use-theme 管理：
// 点击后新的主题画面会以视口中心为圆心，用环形波纹向外扩散。
const { theme, toggleTheme } = useTheme();
const themeColorDialogVisible = ref(false);

function handleCommand(command: string): void {
  if (command === "logout") {
    // 先让服务端撤销令牌：短令牌有效期 30 分钟，只清本地会让旧令牌在有效期内仍然可用
    void authApi.logout().catch(() => undefined);
    authStore.clear();
    router.push("/login");
  } else if (command === "profile") {
    // openProfileDialog();
    router.push("/setting");
  } else if (command === "chat") {
    // openProfileDialog();
    router.push("/chat");
  } else if (command === "schedule") {
    router.push("/schedule");
  } else if (command === "changePassword") {
    openChangePasswordDialog();
  } else if (command === "themeColor") {
    themeColorDialogVisible.value = true;
  } else if (command === "deactivate") {
    openDeactivateDialog();
  }
}

// Verification Code Logic
const codeCountdown = ref(0);
let codeTimer: number | null = null;
const sendingCode = ref(false);

function startCodeCountdown(seconds: number = 60) {
  codeCountdown.value = seconds;
  if (codeTimer) clearInterval(codeTimer);
  codeTimer = window.setInterval(() => {
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

async function handleSendVerificationCode(
  actionType: "change-password" | "deactivate",
) {
  if (!authStore.user?.email) {
    notifyError("无法获取用户邮箱");
    return;
  }
  if (sendingCode.value || codeCountdown.value > 0) return;

  sendingCode.value = true;
  try {
    if (user.value) {
      authApi.sendEmailCode({ email: user.value.email, actionType });
      notifySuccess("验证码已发送");
      startCodeCountdown();
    } else {
      notifyError("邮箱为空");
    }
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 429) notifyError("请求过于频繁");
    else notifyError("发送失败");
  } finally {
    sendingCode.value = false;
  }
}

// Change Password Dialog
const changePasswordVisible = ref(false);
const verificationMethod = ref<"password" | "code">("password");
const changePasswordForm = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
  code: "",
});
const changePasswordLoading = ref(false);

function openChangePasswordDialog() {
  changePasswordForm.oldPassword = "";
  changePasswordForm.newPassword = "";
  changePasswordForm.confirmPassword = "";
  changePasswordForm.code = "";
  verificationMethod.value = "password";
  changePasswordVisible.value = true;
}

async function handleChangePassword() {
  if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
    notifyError("两次输入的新密码不一致");
    return;
  }

  if (verificationMethod.value === "code" && !changePasswordForm.code) {
    notifyError("请输入验证码");
    return;
  }

  if (
    verificationMethod.value === "password" &&
    !changePasswordForm.oldPassword
  ) {
    notifyError("请输入旧密码");
    return;
  }

  changePasswordLoading.value = true;
  try {
    const payload: PasswordPayload = {
      oldPassword: null,
      newPassword: changePasswordForm.newPassword,
      code: null,
    };

    if (verificationMethod.value === "password") {
      payload.oldPassword = changePasswordForm.oldPassword;
    } else {
      payload.code = changePasswordForm.code;
    }

    await authApi.updatePassword(payload);
    notifySuccess("密码修改成功");
    changePasswordVisible.value = false;
    authStore.clear();
  } catch (error: any) {
    if (error.response?.status === 401) notifyError("旧密码错误");
    else if (error.response?.status === 400)
      notifyError(error.response.data || "请求无效");
    else notifyError("修改失败");
  } finally {
    changePasswordLoading.value = false;
  }
}

// Deactivate Account Dialog
const deactivateVisible = ref(false);
const deactivateCode = ref("");
const deactivateLoading = ref(false);

function openDeactivateDialog() {
  deactivateCode.value = "";
  deactivateVisible.value = true;
}

async function handleDeactivateConfirm(): Promise<void> {
  if (!deactivateCode.value) {
    notifyError("请输入验证码");
    return;
  }

  try {
    await ElMessageBox.confirm(
      "确定要注销账号吗？注销后将无法登录，数据将保留30天。",
      "注销确认",
      {
        confirmButtonText: "确认注销",
        cancelButtonText: "取消",
        type: "warning",
      },
    );

    deactivateLoading.value = true;
    await authApi.deactivateConfirm({ code: deactivateCode.value });
    notifySuccess("账号已注销");
    deactivateVisible.value = false;
    authStore.clear();
  } catch (error: any) {
    if (error === "cancel") return;
    if (error.response?.status === 400)
      notifyError(error.response.data || "验证码错误");
    else notifyError("注销失败");
  } finally {
    deactivateLoading.value = false;
  }
}
</script>

<template>
  <header class="topbar">
    <div class="brand">{{ APP_TITLE }}</div>
    <div class="right">
      <!-- 页面导航：首页（课表入口在右上角用户下拉列表里） -->
      <nav class="topbar-nav" aria-label="页面导航">
        <button type="button" class="topbar-nav-icon" :class="{ 'is-active': isHomeActive }" title="首页"
          aria-label="首页" :aria-current="isHomeActive ? 'page' : undefined" @click="goToNav('/home')">
          <component :is="HomeIcon" />
        </button>
      </nav>
      <button type="button" class="theme-toggle-icon" @click="toggleTheme"
        :title="theme === 'dark' ? '切换到白昼模式' : '切换到暗夜模式'"
        :aria-label="theme === 'dark' ? '切换到白昼模式' : '切换到暗夜模式'"
        :aria-pressed="theme === 'dark'">
        <component :is="theme === 'dark' ? SunIcon : MoonIcon" />
      </button>
      <!-- 用户菜单：与设置页共用 SettingsMenu（标题 + 汉堡 + 展开动画），
           原来的 el-dropdown 触发器内容放进 #title 插槽，菜单项用 SettingsMenuItem。 -->
      <SettingsMenu v-if="user" class="topbar-user-menu">
        <template #title>
          <span class="user-menu-title">
            <!-- 头像跟随菜单按钮的方形圆角，不再用圆形 -->
            <!-- 尺寸 26：按钮高 32，上下各留 3px，配合下面的左内边距让四周留白一致 -->
            <ProgressiveAvatar :src="currentAvatar.src" :thumbnail-src="currentAvatar.thumbnailSrc" :size="26"
              shape="square">
              {{ userInitial }}
            </ProgressiveAvatar>
            <!-- 文字放不下时左右来回滚动（保留原下拉的 marquee 效果），宽度由 MarqueeText 自己实测 -->
            <MarqueeText class="user-menu-name" :text="userMenuText" :speed="10" mode="bounce" />
          </span>
        </template>
        <template #default="{ isOpen }">
          <SettingsMenuItem :index="0" :is-open="isOpen" @click="handleCommand('profile')">
            个人设置
          </SettingsMenuItem>
          <SettingsMenuItem :index="1" :is-open="isOpen" @click="handleCommand('changePassword')">
            修改密码
          </SettingsMenuItem>
          <SettingsMenuItem :index="2" :is-open="isOpen" @click="handleCommand('themeColor')">
            主题色
          </SettingsMenuItem>
          <SettingsMenuItem :index="3" :is-open="isOpen" @click="handleCommand('chat')">
            飞猫传书
          </SettingsMenuItem>
          <SettingsMenuItem :index="4" :is-open="isOpen" @click="handleCommand('schedule')">
            课程表
          </SettingsMenuItem>
          <SettingsMenuItem class="user-menu-danger" :index="5" :is-open="isOpen" @click="handleCommand('deactivate')">
            注销账号
          </SettingsMenuItem>
          <SettingsMenuItem :index="6" :is-open="isOpen" @click="handleCommand('logout')">
            退出登录
          </SettingsMenuItem>
        </template>
      </SettingsMenu>
    </div>

    <!-- Change Password Dialog -->
    <AppDialog v-model="changePasswordVisible" title="修改密码" content-width="400px">
      <div class="setting-form">
        <div class="method-selector">
          <label class="radio-label">
            <input type="radio" value="password" v-model="verificationMethod" />
            旧密码验证
          </label>
          <label class="radio-label">
            <input type="radio" value="code" v-model="verificationMethod" />
            验证码验证
          </label>
        </div>

        <label class="setting-field" v-if="verificationMethod === 'password'">
          <span>旧密码</span>
          <input v-model="changePasswordForm.oldPassword" type="password" placeholder="请输入旧密码" />
        </label>

        <div class="setting-field" v-if="verificationMethod === 'code'">
          <span>邮箱验证码</span>
          <div class="setting-code-row">
            <input v-model="changePasswordForm.code" type="text" maxlength="6" placeholder="验证码" />
            <button type="button" class="setting-code-button" :disabled="sendingCode || codeCountdown > 0"
              @click="handleSendVerificationCode('change-password')">
              <span v-if="codeCountdown > 0">{{ codeCountdown }}s</span>
              <span v-else-if="sendingCode">发送中...</span>
              <span v-else>获取验证码</span>
            </button>
          </div>
        </div>

        <label class="setting-field">
          <span>新密码</span>
          <input v-model="changePasswordForm.newPassword" type="password" placeholder="请输入新密码" />
        </label>
        <label class="setting-field">
          <span>确认新密码</span>
          <input v-model="changePasswordForm.confirmPassword" type="password" placeholder="请再次输入新密码" />
        </label>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <button class="btn-cancel" @click="changePasswordVisible = false">
            取消
          </button>
          <button class="btn-confirm" :disabled="changePasswordLoading" @click="handleChangePassword">
            {{ changePasswordLoading ? "提交中..." : "确认修改" }}
          </button>
        </span>
      </template>
    </AppDialog>

    <!-- Deactivate Account Dialog -->
    <AppDialog v-model="deactivateVisible" title="注销账号" content-width="400px">
      <div class="setting-form">
        <p class="setting-warning-text">
          注销后账号将无法登录，所有数据保留30天后彻底删除。请输入验证码确认注销。
        </p>
        <div class="setting-field">
          <span>邮箱验证码</span>
          <div class="setting-code-row">
            <input v-model="deactivateCode" type="text" maxlength="6" placeholder="验证码" />
            <button type="button" class="setting-code-button" :disabled="sendingCode || codeCountdown > 0"
              @click="handleSendVerificationCode('deactivate')">
              <span v-if="codeCountdown > 0">{{ codeCountdown }}s</span>
              <span v-else-if="sendingCode">发送中...</span>
              <span v-else>获取验证码</span>
            </button>
          </div>
        </div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <button class="btn-cancel" @click="deactivateVisible = false">
            取消
          </button>
          <button class="btn-confirm btn-danger" :disabled="deactivateLoading" @click="handleDeactivateConfirm">
            {{ deactivateLoading ? "处理中..." : "确认注销" }}
          </button>
        </span>
      </template>
    </AppDialog>
  </header>

    <!-- 主题色设置 -->
    <ThemeColorDialog v-model="themeColorDialogVisible" />
</template>

<style scoped lang="scss">
.topbar {
  // 用 --header-total-h（--header-h + --safe-top）而不是 --header-h：
  // 在刘海屏/灵动岛上顶栏要往下让出状态栏区域，
  // 而各页面的 calc(视口 - 顶栏) 引用同一个变量，两边始终一致。
  height: var(--header-total-h);
  width: 100%;
  // 横屏手机刘海在左/右侧，所以左右也要让开安全区。
  padding: var(--safe-top) calc(8px + var(--safe-right)) 0 calc(16px + var(--safe-left));
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-elevated);
}

.brand {
  font-weight: 600;
  color: var(--theme-color-strong);
}

.right {
  display: flex;
  align-items: center;
  gap: 16px;
}

// 页面导航入口（课表 / 首页）：与主题切换按钮同一套圆形按钮样式
.topbar-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.topbar-nav-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--theme-color-soft);
    border-color: var(--theme-color-muted);
    color: var(--theme-color-strong);
  }

  &.is-active {
    background: var(--theme-color-soft);
    border-color: var(--theme-color-muted);
    color: var(--theme-color-strong);
  }
}

// 窄屏（手机竖屏）顶栏空间有限：隐藏文字品牌名，
// 优先保证「首页 / 主题 / 用户菜单」这几个入口都能放下。
@media (max-width: 480px) {
  .brand {
    display: none;
  }
}

// 用户菜单：SettingsMenu 默认宽度（7.5~10rem）放不下头像 + 邮箱，
// 通过它支持的 CSS 变量放宽一档（窄屏 10rem，桌面最大 13rem），
// 让跑马灯有足够窗口；clamp 里的 vw 项随视口收缩。
// 左侧内边距从默认的 10px 收到 3px：头像 26px、按钮高 32px，上下本来就各留 3px，
// 左右改成 3px 才和上下对称（尺寸见模板里的 :size="26"）。
.topbar-user-menu {
  --settings-menu-width: clamp(10rem, 40vw, 13rem);
  --settings-menu-pad-left: 3px;
}

.user-menu-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

// 文字容器：占满头像与汉堡之间的剩余宽度；真实宽度由 ResizeObserver 量给 Txet，
// 文字变长时由 Txet 左右滚动，不再用 overflow 省略号截断。
.user-menu-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
}

.user-menu-danger {
  color: #ef4444;
}

.theme-toggle-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--theme-color-muted);
  background: var(--theme-color-soft);
  color: var(--theme-color-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--theme-primary-bg);
    color: var(--theme-color-contrast);
    border-color: var(--theme-primary-bg);
  }

}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn-cancel {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--theme-color-muted);
  background: var(--theme-color-soft);
  color: var(--theme-color-strong);
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;

  &:hover {
    background: var(--theme-primary-bg);
    color: var(--theme-color-contrast);
  }
}

.btn-danger {
  background: #ef4444;

  &:hover {
    background: #dc2626;
  }
}

.btn-confirm {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  background: var(--theme-gradient);
  color: var(--theme-action-contrast);
  cursor: pointer;

  &:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
}

.method-selector {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-color);
}
</style>
