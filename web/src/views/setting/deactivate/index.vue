<script setup lang="ts">
import { notifySuccess, notifyError } from "@/utils/notification";
import { ElMessageBox } from "element-plus";
import { authApi } from "@/features/auth/api/index";
import { useAuthStore } from "@/features/auth/stores";
const authStore = useAuthStore();

import { useCode } from "@/features/auth/composables/useCode";
const { codeCountdown, sendingCode, handleSendVerificationCode } = useCode();

const deactivateCode = ref("");
const deactivateLoading = ref(false);

async function handleDeactivateConfirm(): Promise<void> {
    if (!deactivateCode.value) {
        notifyError("请输入验证码");
        return;
    }

    try {
        await ElMessageBox.confirm(
            "确定要注销账号吗？注销后将无法登录，数据将保留30天。",
            "注销确认",
            {
                confirmButtonText: "确认注销",
                cancelButtonText: "取消",
                type: "warning",
            },
        );

        deactivateLoading.value = true;
        await authApi.deactivateConfirm({ code: deactivateCode.value });
        notifySuccess("账号已注销");

        authStore.clear();
    } catch (error: any) {
        if (error === "cancel") return;
        if (error.response?.status === 400)
            notifyError(error.response.data || "验证码错误");
        else notifyError("注销失败");
    } finally {
        deactivateLoading.value = false;
    }
}
</script>

<template>
    <div class="setting-subpage">
        <div class="setting-card">
            <div class="setting-header">
                <h3 class="setting-title">注销账号</h3>
                <p class="setting-subtitle">该操作不可逆，请谨慎处理。</p>
            </div>
            <div class="setting-form">
                <p class="setting-warning-text">
                    注销后账号将无法登录，所有数据保留30天后彻底删除。请输入验证码确认注销。
                </p>
                <div class="setting-field">
                    <span>邮箱验证码</span>
                    <div class="setting-code-row">
                        <input v-model="deactivateCode" type="text" maxlength="6" placeholder="验证码" />
                        <button type="button" class="setting-code-button" :disabled="sendingCode || codeCountdown > 0"
                            @click="handleSendVerificationCode('deactivate')">
                            <span v-if="codeCountdown > 0">{{ codeCountdown }}s</span>
                            <span v-else-if="sendingCode">发送中...</span>
                            <span v-else>获取验证码</span>
                        </button>
                    </div>
                </div>
            </div>
            <span class="setting-footer">
                <button class="setting-submit setting-submit--danger" :disabled="deactivateLoading"
                    @click="handleDeactivateConfirm">
                    {{ deactivateLoading ? "处理中..." : "确认注销" }}
                </button>
            </span>
        </div>
    </div>
</template>

<style scoped lang="scss">
// 页面骨架、表单、验证码按钮与危险按钮见
// features/setting/style/index.scss，这里只补一处本页的间距微调。
.setting-code-row {
    padding: 4px 0;
}
</style>
