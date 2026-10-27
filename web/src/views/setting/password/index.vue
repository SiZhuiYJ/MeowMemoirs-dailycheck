<script setup lang="ts">
import type { PasswordPayload } from "@/features/auth/types";
import { notifySuccess, notifyError } from "@/utils/notification";
import { authApi } from "@/features/auth/api/index";
import { useAuthStore } from "@/features/auth/stores";
const authStore = useAuthStore();

import { useCode } from "@/features/auth/composables/useCode";
const { codeCountdown, sendingCode, handleSendVerificationCode } = useCode();

const changePasswordVisible = ref(false);
const verificationMethod = ref<"password" | "code">("password");
const changePasswordForm = reactive({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
    code: "",
});
const changePasswordLoading = ref(false);

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
            oldPassword: '',
            newPassword: changePasswordForm.newPassword,
            code: '',
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
        authStore.initialAuth();
    }
}
</script>

<template>
    <div class="setting-subpage">
        <div class="setting-card">
            <div class="setting-header">
                <h3 class="setting-title">密码修改</h3>
                <p class="setting-subtitle">支持旧密码和验证码两种校验方式。</p>
            </div>

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

            <div class="setting-footer">
                <el-button type="primary" class="setting-submit" :loading="changePasswordLoading"
                    @click="handleChangePassword">
                    确认修改
                </el-button>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
// 页面骨架与表单控件见 features/setting/style/index.scss，
// 这里只保留本页独有的「校验方式」选择器。
.method-selector {
    display: flex;
    gap: 2px;
    margin-bottom: 2px;
    padding: 3px;
    border: 1px solid var(--chat-border);
    border-radius: 10px;
    background: var(--chat-inset);
}

.radio-label {
    flex: 1;
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    padding: 6px 10px;
    border-radius: 7px;
    color: var(--chat-muted);
    font-size: 12px;
    line-height: 18px;
    cursor: pointer;
    transition: background-color 0.16s ease, color 0.16s ease;

    input {
        accent-color: var(--chat-accent);
    }

    // 选中态：与聊天页会话列表的 .active 同一套主题浅底
    &:has(input:checked) {
        color: var(--chat-accent);
        background: var(--chat-accent-soft);
        font-weight: 600;
    }
}
</style>
