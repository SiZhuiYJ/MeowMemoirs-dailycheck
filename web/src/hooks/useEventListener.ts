import { onUnmounted } from "vue";

/**
 * 监听window对象的事件
 * @param event 事件名称
 * @param listener 事件监听器
 * @param options 事件选项
 */
export function useWindowEventListener(
  event: keyof WindowEventMap,
  listener: (this: Window, ev: WindowEventMap[keyof WindowEventMap]) => any,
  options?: boolean | AddEventListenerOptions
) {
  window.addEventListener(event, listener, options);

  // 组件卸载时自动移除监听
  onUnmounted(() => {
    window.removeEventListener(event, listener, options);
  });
}
