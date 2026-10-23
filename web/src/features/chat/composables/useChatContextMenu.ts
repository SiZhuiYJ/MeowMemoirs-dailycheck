import { ref } from "vue";

/**
 * 聊天页右键菜单的通用状态。
 *
 * 只负责「在哪个坐标、对哪个对象打开了菜单」，
 * 具体菜单项与动作由调用方根据 target 自己决定。
 */
export function useChatContextMenu<T>() {
  const visible = ref(false);
  const x = ref(0);
  const y = ref(0);
  const target = ref<T | null>(null);

  function open(event: MouseEvent, data: T) {
    event.preventDefault();
    event.stopPropagation();
    x.value = event.clientX;
    y.value = event.clientY;
    target.value = data;
    visible.value = true;
  }

  function close() {
    visible.value = false;
  }

  return { visible, x, y, target, open, close };
}
