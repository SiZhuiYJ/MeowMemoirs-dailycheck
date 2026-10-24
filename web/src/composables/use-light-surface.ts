import { onBeforeMount, onBeforeUnmount } from "vue";
import { refreshThemePalette } from "@/composables/use-theme";

/**
 * 固定浅色面标记。
 *
 * 聊天页 / 用户主页是浅色设计，但夜间模式下全局主题 token 会变成浅粉，
 * 白底上的文字/按钮就不可读。挂载时给 <html> 加 .theme-light-surface，
 * 让主题色阶和 Element Plus 的基础 / 语义变量都切回浅色；
 * Teleport 到 body 的弹窗、下拉层也会继承。
 *
 * 用引用计数而不是布尔值：路由切换时新旧页面可能短暂同时挂载，
 * 直接 remove 会把新页面的浅色面提前拆掉。
 */
const LIGHT_SURFACE_CLASS = "theme-light-surface";
let holders = 0;

function acquire(): void {
  holders += 1;
  if (typeof document !== "undefined") {
    document.documentElement.classList.add(LIGHT_SURFACE_CLASS);
    // 浅色面必须用日间色阶：重新生成主题变量，而不是继承夜间的值
    refreshThemePalette();
  }
}

function release(): void {
  holders = Math.max(0, holders - 1);
  if (holders === 0 && typeof document !== "undefined") {
    document.documentElement.classList.remove(LIGHT_SURFACE_CLASS);
    refreshThemePalette();
  }
}

export function useLightSurface(): void {
  onBeforeMount(acquire);
  onBeforeUnmount(release);
}
