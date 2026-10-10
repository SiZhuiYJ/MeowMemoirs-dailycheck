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
            <div class="profile-form">
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

                <label class="field" v-if="verificationMethod === 'password'">
                    <span>旧密码</span>
                    <input v-model="changePasswordForm.oldPassword" type="password" placeholder="请输入旧密码" />
                </label>

                <div class="field code-field" v-if="verificationMethod === 'code'">
                    <span>邮箱验证码</span>
                    <div class="code-row">
                        <input v-model="changePasswordForm.code" type="text" maxlength="6" placeholder="验证码" />
                        <button type="button" class="code-button" :disabled="sendingCode || codeCountdown > 0"
                            @click="handleSendVerificationCode('change-password')">
                            <span v-if="codeCountdown > 0">{{ codeCountdown }}s</span>
                            <span v-else-if="sendingCode">发送中...</span>
                            <span v-else>获取验证码</span>
                        </button>
                    </div>
                </div>

                <label class="field">
                    <span>新密码</span>
                    <input v-model="changePasswordForm.newPassword" type="password" placeholder="请输入新密码" />
                </label>
                <label class="field">
                    <span>确认新密码</span>
                    <input v-model="changePasswordForm.confirmPassword" type="password" placeholder="请再次输入新密码" />
                </label>
            </div>

            <span class="footer">
                <button class="btn-confirm" :disabled="changePasswordLoading" @click="handleChangePassword">
                    {{ changePasswordLoading ? "提交中..." : "确认修改" }}
                </button>
            </span>
        </div>
    </div>
</template>

<style scoped lang="scss">
.setting-subpage {
    width: min(760px, 92vw);
    margin: 24px auto;
}

.setting-card {
    background-color: var(--bg-elevated);
    border-radius: 16px;
    padding: 24px;
    border: 1px solid var(--border-color);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.04);
}

.setting-header {
    margin-bottom: 16px;
}

.setting-title {
    margin: 0;
    font-size: 20px;
    color: var(--text-color);
}

.setting-subtitle {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: 13px;
}

.profile-form {
    display: flex;
    flex-direction: column;
    gap: 12px;

    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;

        input {
            width: 100%;
            padding: 8px 10px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            background: var(--bg-color);
            color: var(--text-color);
            font-size: 14px;
            box-sizing: border-box;
        }

        span {
            font-size: 14px;
            color: var(--text-muted);
        }
    }
}

.method-selector {
    display: flex;
    margin-bottom: 16px;
    background-color: var(--bg-color);
    padding: 4px;
    border-radius: 8px;
}

.radio-label {
    flex: 1;
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--text-muted);
    padding: 6px 10px;
}

.code-row {
    display: flex;
    gap: 8px;
}

.code-button {
    width: 100px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--bg-elevated);
    color: var(--text-color);
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-left: 10px;
    padding-right: 10px;

    &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
}

.footer {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 18px;
}

.btn-confirm {
    width: min(320px, 100%);
    padding: 10px 16px;
    border-radius: 10px;
    border: none;
    background: var(--theme-primary);
    color: #fff;
    cursor: pointer;

    &:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }
}
</style>
