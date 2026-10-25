<script setup lang="ts">
import { CloseBold, EditPen } from "@element-plus/icons-vue";
import ProgressiveAvatar from '@/components/ProgressiveAvatar/index.vue';
import nickname from '@/features/auth/components/Settings/nickname.vue';
import router from "@/routers";
import { useAuthStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { extractEmail, extractDomain } from '@/utils/auth';
import { getUserAvatarSources } from '@/utils/avatar';

const { user } = storeToRefs(useAuthStore());
const inputEmail = ref<string>('');
const emailDisabled = ref<boolean>(true);
const avatar = computed(() => getUserAvatarSources(user.value?.userId, user.value?.avatarKey));
// 邮箱后缀名
const emailFix = ref<string[]>(['@qq.com', '@163.com', '@126.com', '@sina.com', '@aliyun.com']);
const select = ref<string>();
watch(
    () => user.value?.email,
    (newVal?: string) => {
        if (newVal) {
            inputEmail.value = extractEmail(newVal);
            select.value = '@' + extractDomain(newVal);
            emailDisabled.value = true;
        } else {
            inputEmail.value = '';
            emailDisabled.value = false;
        }
    }, { immediate: true });
</script>

<template>
    <div class="setting-subpage">
        <div class="setting-card">
            <div class="setting-header">
                <h3 class="setting-title">个人信息</h3>
                <p class="setting-subtitle">统一管理头像、昵称与邮箱信息。</p>
            </div>

            <div class="profile-main">
                <ProgressiveAvatar :src="avatar.src" :thumbnail-src="avatar.thumbnailSrc" :size="100" :is-preview="true"
                    shape="square">
                    {{ (user ? (user?.nickName || user?.userAccount || user?.email).slice(0, 1).toUpperCase() : 'U') }}
                </ProgressiveAvatar>
                <el-button type="primary" plain @click="router.push('/setting/avatar')">
                    更换头像
                </el-button>
                <el-input v-model="inputEmail" :disabled="emailDisabled" clearable :clear-icon="CloseBold"
                    placeholder="邮箱地址" style="width: min(420px, 100%)">
                    <template #prepend>
                        <el-button :icon="EditPen" @click="emailDisabled = !emailDisabled" />
                    </template>
                    <template #append>
                        <el-select v-model="select" placeholder="Select" :disabled="emailDisabled" style="width: 150px">
                            <el-option v-for="(value, index) in emailFix" :label="value" :value="index" />
                        </el-select>
                    </template>
                </el-input>
            </div>
        </div>

        <div class="setting-card">
            <nickname></nickname>
        </div>
    </div>
</template>

<style scoped lang="scss">
// 页面骨架（.setting-subpage / .setting-card / 标题 / 副标题）
// 见 features/setting/style/index.scss，这里只写本页独有的布局。
.profile-main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
}
</style>
