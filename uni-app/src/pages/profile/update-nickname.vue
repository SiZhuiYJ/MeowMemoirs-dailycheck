<script setup lang="ts">
import { ref } from 'vue';
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
    <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
    <MmNavBar title="修改昵称" />
    <NotificationSystem />

    <!-- 分组小标题：13px 灰色，与全站设置页一致 -->
    <text class="group-title">个人资料</text>

    <view class="page-card">
      <view class="form-field">
        <text class="label">昵称</text>
        <input class="input" v-model="nickName" placeholder="设置昵称" focus />
        <text class="desc">好的昵称能让大家更容易记住你。</text>
      </view>
    </view>

    <view class="page-actions">
      <button class="btn-primary" hover-class="mm-hover" :loading="loading" @click="handleSave">保存</button>
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
</style>
