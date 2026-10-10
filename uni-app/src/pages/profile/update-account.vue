<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import http from '@/libs/http/config';
import { onShow } from '@dcloudio/uni-app';
import { notifySuccess, notifyError } from '@/utils/notification';

const authStore = useAuthStore();
const themeStore = useThemeStore();

const loading = ref(false);
const userAccount = ref(authStore.user?.userAccount || '');

const accountStatus = reactive({
  canUpdate: false,
  nextUpdateAt: null as string | null
});

onShow(async () => {
  themeStore.updateNavBarColor();
  await checkAccountStatus();
});

async function checkAccountStatus() {
  try {
    const res = await http.get('/mm/Auth/account/status');
    accountStatus.canUpdate = res.data.canUpdate;
    accountStatus.nextUpdateAt = res.data.nextUpdateAt;
  } catch (e) {
    console.error('Failed to check account status', e);
  }
}

async function handleSave() {
  if (!userAccount.value) {
    notifyError('账号名不能为空');
    return;
  }

  if (userAccount.value === authStore.user?.userAccount) {
    uni.navigateBack();
    return;
  }

  loading.value = true;
  try {
    const accountRes = await http.post<any>('/mm/Auth/account', {
      UserAccount: userAccount.value
    });
    authStore.setSession(accountRes.data);
    notifySuccess('账号名修改成功');
    setTimeout(() => {
      uni.navigateBack();
    }, 1500);
  } catch (err: any) {
    if (err.statusCode === 409) {
      notifyError('账号名已被占用');
    } else if (err.statusCode === 403) {
      notifyError('修改过于频繁');
    } else {
      notifyError('账号名修改失败');
    }
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
        <text class="label">账号名 (全局唯一)</text>
        <input class="input" v-model="userAccount" placeholder="设置账号名"
          :disabled="!!authStore.user?.userAccount && !accountStatus.canUpdate" />
        <text v-if="!accountStatus.canUpdate && accountStatus.nextUpdateAt" class="hint-text">
          下次可修改时间：{{ new Date(accountStatus.nextUpdateAt).toLocaleDateString() }}
        </text>
        <text class="desc">账号名是您的唯一标识，请谨慎修改。</text>
      </view>
    </view>

    <view class="page-actions">
      <button class="btn-primary" :loading="loading" :disabled="!!authStore.user?.userAccount && !accountStatus.canUpdate" @click="handleSave">保存</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";

.hint-text {
  display: block;
  font-size: 12px;
  color: #fa5151;
  margin-top: 8px;
}
</style>
