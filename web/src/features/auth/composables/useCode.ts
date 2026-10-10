import { notifySuccess, notifyError } from "@/utils/notification";
import { authApi } from "@/features/auth/api/index";
import { useAuthStore } from "@/features/auth/stores";
import { storeToRefs } from "pinia";
const { user } = storeToRefs(useAuthStore());
const authStore = useAuthStore();

export function useCode() {
  const codeCountdown = ref(0);
  let codeTimer: number | null = null;
  const sendingCode = ref(false);

  function startCodeCountdown(seconds: number = 60) {
    codeCountdown.value = seconds;
    if (codeTimer) clearInterval(codeTimer);
    codeTimer = window.setInterval(() => {
      if (codeCountdown.value > 0) {
        codeCountdown.value--;
      } else {
        if (codeTimer) {
          clearInterval(codeTimer);
          codeTimer = null;
        }
      }
    }, 1000);
  }

  async function handleSendVerificationCode(
    actionType: "change-password" | "deactivate",
  ) {
    if (!authStore.user?.email) {
      notifyError("无法获取用户邮箱");
      return;
    }
    if (sendingCode.value || codeCountdown.value > 0) return;

    sendingCode.value = true;
    try {
      if (user.value) {
        authApi.sendEmailCode({ email: user.value.email, actionType });
        notifySuccess("验证码已发送");
        startCodeCountdown();
      } else {
        notifyError("邮箱为空");
      }
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 429) notifyError("请求过于频繁");
      else notifyError("发送失败");
    } finally {
      sendingCode.value = false;
    }
  }

  return {
    codeCountdown,
    codeTimer,
    sendingCode,

    startCodeCountdown,
    handleSendVerificationCode,
  };
}
