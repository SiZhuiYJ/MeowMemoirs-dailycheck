<script setup lang="ts">
import { ref } from 'vue';
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
const nickName = ref(authStore.user?.nickName || '');

async function handleSave() {
  if (!nickName.value) {
    notifyError('昵称不能为空');
    return;
  }

  if (nickName.value === authStore.user?.nickName) {
    uni.navigateBack();
    return;
  }

  loading.value = true;
  try {
    const profileRes = await http.post<any>('/mm/Auth/profile', {
      userAccount: authStore.user?.userAccount || '',
      nickName: nickName.value,
      avatarKey: authStore.user?.avatarKey || null,
    });
    authStore.setSession(profileRes.data);
    notifySuccess('昵称修改成功');
    setTimeout(() => {
      uni.navigateBack();
    }, 1500);
  } catch (err: any) {
    notifyError('昵称修改失败');
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
        <text class="label">昵称</text>
        <input class="input" v-model="nickName" placeholder="设置昵称" focus />
        <text class="desc">好的昵称能让大家更容易记住你。</text>
      </view>
    </view>

    <view class="page-actions">
      <button class="btn-primary" :loading="loading" @click="handleSave">保存</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";
</style>
