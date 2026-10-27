<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '@/stores';
import { storeToRefs } from 'pinia'
import { authApi } from '@/features/auth/api';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

const { user } = storeToRefs(useAuthStore());
const loading = ref(false);
const nickName = ref('');

async function handleSave() {
  if (!nickName.value) {
    notifyError('昵称不能为空');
    return;
  }

  if (nickName.value === user.value?.nickName) {
    notifyWarning('昵称未修改');
    return;
  }

  loading.value = true;
  try {
    const profileRes = await authApi.updateProfileInfo({
      nickName: nickName.value,
      avatarKey: user.value?.avatarKey || null
    });
    useAuthStore().setSession(profileRes.data);
    notifySuccess('昵称修改成功');
  } catch (err: any) {
    console.error(err);
    notifyError('昵称修改失败');
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  if (user.value?.nickName) {
    nickName.value = user.value.nickName;
  }
});
</script>

<template>
  <div class="nickname-form">
    <div class="setting-header">
      <h3 class="setting-title">昵称</h3>
      <p class="setting-subtitle">好的昵称能让大家更容易记住你。</p>
    </div>

    <div class="setting-field">
      <input id="setting-nickname" v-model="nickName" class="setting-input" aria-label="昵称" placeholder="设置昵称" />
    </div>

    <div class="setting-footer">
      <el-button type="primary" class="setting-submit" :loading="loading" @click="handleSave">
        保存
      </el-button>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 卡片外壳由 profile 页的 .setting-card 提供；这里只排「标题 + 输入 + 操作」。
// 输入框 / 标签 / 说明文字见 features/setting/style/index.scss 的
// .setting-input / .setting-label / .setting-desc。
.nickname-form {
  display: flex;
  flex-direction: column;
}
</style>
