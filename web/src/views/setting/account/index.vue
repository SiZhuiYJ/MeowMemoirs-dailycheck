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

      <div class="setting-field">
        <label class="setting-label" for="setting-account">账号名（全局唯一）</label>
        <input id="setting-account" v-model="userAccount" class="setting-input" placeholder="设置账号名"
          :disabled="!!authStore.user?.userAccount && !accountStatus.canUpdate" />
        <span v-if="!accountStatus.canUpdate && accountStatus.nextUpdateAt" class="setting-hint">
          下次可修改时间：{{
            new Date(accountStatus.nextUpdateAt).toLocaleDateString()
          }}
        </span>
        <span class="setting-desc">账号名是您的唯一标识，请谨慎修改。</span>
      </div>
    </div>

    <div class="setting-footer">
      <el-button type="primary" class="setting-submit" :loading="loading"
        :disabled="!!authStore.user?.userAccount && !accountStatus.canUpdate" @click="handleSave">
        保存
      </el-button>
    </div>
  </div>
</template>
