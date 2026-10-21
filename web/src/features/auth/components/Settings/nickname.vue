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
  console.log(user.value);
});
</script>

<template>
  <div class="card">
    <div class="form-group">
      <div class="field">
        <label class="label">昵称</label>
        <input class="input" v-model="nickName" placeholder="设置昵称" focus />
        <label class="desc">好的昵称能让大家更容易记住你。</label>
      </div>
    </div>
  </div>

  <div class="actions">
    <el-button class="btn-save" :loading="loading" @click="handleSave">保存</el-button>
  </div>
</template>

<style scoped lang="scss">
.card {
  background-color: var(--bg-elevated);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
}

.label {
  display: block;
  font-size: 13px;
  color: var(--label-muted);
  margin-bottom: 8px;
}

.input {
  width: 100%;
  height: 44px;
  background-color: var(--bg-color);
  border-radius: 8px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--label-color);
  box-sizing: border-box;
  border: 1px solid var(--border-color);
}

.desc {
  display: block;
  font-size: 11px;
  color: var(--label-muted);
  margin-top: 8px;
}

.btn-save {
  border-radius: 8px;
  font-size: 15px;
  height: 44px;
  line-height: 44px;
  margin-top: 10px;
}

.actions {
  padding: 0 10px;
}
</style>
