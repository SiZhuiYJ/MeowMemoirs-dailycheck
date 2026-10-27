import { onUnmounted, ref } from "vue";

/**
 * 秒级倒计时：验证码按钮的通用冷却。
 *
 * 每个调用方拿到一份独立状态，因此同一页面可以同时存在多个验证码按钮
 * （例如换绑邮箱时的「当前邮箱」和「新邮箱」）。
 */
export function useCountdown() {
  const countdown = ref(0);
  let timer: number | null = null;

  function stop() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function start(seconds = 60) {
    stop();
    countdown.value = seconds;
    timer = window.setInterval(() => {
      if (countdown.value <= 0) {
        stop();
        return;
      }
      countdown.value -= 1;
    }, 1000);
  }

  function reset() {
    stop();
    countdown.value = 0;
  }

  onUnmounted(stop);

  return { countdown, start, reset, stop };
}
