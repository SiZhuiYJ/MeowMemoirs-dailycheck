import { ref, onUnmounted } from 'vue';

/**
 * A composable for handling countdown logic.
 */
export function useCountdown(initialSeconds = 60) {
  const countdown = ref(0);
  let timer: number | null = null;

  function startCountdown(seconds: number = initialSeconds) {
    countdown.value = seconds;
    if (timer !== null) {
      clearInterval(timer);
    }
    timer = setInterval(() => {
      if (countdown.value > 0) {
        countdown.value -= 1;
      } else {
        stopCountdown();
      }
    }, 1000);
  }

  function stopCountdown() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    countdown.value = 0;
  }

  onUnmounted(() => {
    stopCountdown();
  });

  return {
    countdown,
    startCountdown,
    stopCountdown
  };
}
