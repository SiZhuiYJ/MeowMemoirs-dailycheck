<script setup lang="ts">
import ProgressiveAvatar from '@/components/ProgressiveAvatar/index.vue';
import nickname from '@/features/auth/components/Settings/nickname.vue';
import EmailSettings from '@/features/auth/components/Settings/email.vue';
import router from "@/routers";
import { useAuthStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { isWechatPlaceholderEmail } from '@/utils/auth';
import { getUserAvatarSources } from '@/utils/avatar';

const { user } = storeToRefs(useAuthStore());
const avatar = computed(() => getUserAvatarSources(user.value?.userId, user.value?.avatarKey));

/** 微信注册账号的邮箱是内部占位地址，页面上显示为「未绑定」。 */
const isWechatAccount = computed(() => isWechatPlaceholderEmail(user.value?.email));
const displayEmail = computed(() => {
    if (isWechatAccount.value) return '未绑定邮箱（微信注册）';
    return user.value?.email || '未绑定邮箱';
});
</script>

<template>
    <div class="setting-subpage">
        <div class="setting-card">
            <div class="setting-header">
                <h3 class="setting-title">个人信息</h3>
                <p class="setting-subtitle">统一管理头像、昵称与邮箱信息。</p>
            </div>

            <div class="profile-main">
                <ProgressiveAvatar class="profile-avatar" :src="avatar.src" :thumbnail-src="avatar.thumbnailSrc"
                    :size="96" :is-preview="true" shape="square">
                    {{ (user ? (user?.nickName || user?.userAccount || user?.email).slice(0, 1).toUpperCase() : 'U') }}
                </ProgressiveAvatar>
                <el-button type="primary" plain @click="router.push('/setting/avatar')">
                    更换头像
                </el-button>

                <div class="profile-field">
                    <span class="setting-label">邮箱</span>
                    <el-input :model-value="displayEmail" readonly :aria-label="`当前邮箱：${displayEmail}`" />
                    <span class="setting-desc">
                        {{ isWechatAccount
                            ? '当前账号由微信注册，绑定真实邮箱后可使用邮箱验证码登录。'
                            : '邮箱用于登录和接收验证码，换绑后原邮箱将失效。' }}
                    </span>
                </div>
            </div>
        </div>

        <div class="setting-card">
            <EmailSettings />
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
    gap: 14px;
}

.profile-avatar {
    color: var(--chat-text);
    font-size: 32px;
}

.profile-field {
    display: flex;
    flex-direction: column;
    width: min(420px, 100%);
}

// 窄屏上头像缩到聊天页详情弹层里那一档（72px），给下方表单留高度。
@media (max-width: 480px) {
    .profile-avatar {
        width: 72px !important;
        height: 72px !important;
        font-size: 24px;
    }
}
</style>
