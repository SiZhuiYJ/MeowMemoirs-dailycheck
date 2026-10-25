<script setup lang="ts">
import { useAuthStore } from "@/stores";
import { authApi } from "@/features/auth/api";
import { notifySuccess, notifyError } from "@/utils/notification";

const authStore = useAuthStore();

const loading = ref(false);
const userAccount = ref(authStore.user?.userAccount || "");

const accountStatus = reactive({
  canUpdate: false,
  nextUpdateAt: null as string | null,
});

onMounted(async () => {
  await checkAccountStatus();
});

async function checkAccountStatus() {
  try {
    const res = await authApi.checkAccountStatus();
    accountStatus.canUpdate = res.data.canUpdate;
    accountStatus.nextUpdateAt = res.data.nextUpdateAt;
  } catch (e) {
    console.error("Failed to check account status", e);
  }
}

async function handleSave() {
  if (!userAccount.value) {
    notifyError("账号名不能为空");
    return;
  }

  if (userAccount.value === authStore.user?.userAccount) {
    // 在 Web 环境中使用 window.history.back()
    window.history.back();
    return;
  }

  loading.value = true;
  try {
    const accountRes = await authApi.updateUserAccount(userAccount.value);
    authStore.setSession(accountRes.data);
    notifySuccess("账号修改成功");
    setTimeout(() => {
      // 在 Web 环境中使用 window.history.back()
      window.history.back();
    }, 1500);
  } catch (err: any) {
    if (err.statusCode === 409) {
      notifyError("账号已被占用");
    } else if (err.statusCode === 403) {
      notifyError("修改过于频繁");
    } else {
      notifyError("账号名修改失败");
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="setting-subpage">
    <div class="setting-card">
      <div class="setting-header">
        <h3 class="setting-title">账号修改</h3>
        <p class="setting-subtitle">账号名将作为全局唯一标识，请谨慎修改。</p>
      </div>
      <div class="form-group">
        <div class="field">
          <text class="setting-label">账号名 (全局唯一)</text>
          <input class="setting-input" v-model="userAccount" placeholder="设置账号名"
            :disabled="!!authStore.user?.userAccount && !accountStatus.canUpdate" />
          <text v-if="!accountStatus.canUpdate && accountStatus.nextUpdateAt" class="hint-text">
            下次可修改时间：{{
              new Date(accountStatus.nextUpdateAt).toLocaleDateString()
            }}
          </text>
          <text class="setting-desc">账号名是您的唯一标识，请谨慎修改。</text>
        </div>
      </div>
    </div>

    <div class="actions">
      <button class="btn-save" :loading="loading" :disabled="!!authStore.user?.userAccount && !accountStatus.canUpdate"
        @click="handleSave">
        保存
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 页面骨架见 features/setting/style/index.scss。
.form-group {
  margin-bottom: 20px;
}

.field {
  display: flex;
  flex-direction: column;
}

.hint-text {
  display: block;
  font-size: 11px;
  color: #fa5151;
  margin-top: 8px;
}

.btn-save {
  background-color: var(--theme-action-bg);
  color: var(--theme-action-contrast);
  border-radius: 8px;
  font-size: 15px;
  height: 44px;
  line-height: 44px;
  margin-top: 10px;
  width: 100%;
  border: none;
  cursor: pointer;
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.actions {
  padding: 0;
}
</style>
