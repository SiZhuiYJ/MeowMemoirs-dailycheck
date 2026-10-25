<script setup lang="ts">
/**
 * 主题色设置对话框。
 *
 * 外壳复用聊天页的 `ChatDialog`：同样的主题色渐变底、悬浮毛玻璃顶 / 底栏、
 * 高度随内容自适应；在聊天页里是浅色卡片，在暗色页面的顶栏里打开时则跟随
 * 当前主题面变成暗色（ChatDialog 的颜色取的是 Element Plus 的主题变量）。
 *
 * 内容（预设色点 / 取色器）由 ThemeColorPicker 提供；这里只负责把内容包进
 * 一张半透明卡片、给一句说明，并提供「完成」按钮。
 */
import ChatDialog from "@/features/chat/components/ChatDialog.vue";
import ThemeColorPicker from "@/components/ThemeColorPicker.vue";

const visible = defineModel<boolean>({ default: false });
</script>

<template>
  <ChatDialog v-model="visible" title="主题色" content-width="400px">
    <div class="theme-color-dialog">
      <p class="theme-color-dialog__hint">
        选择一个预设色，或用取色器自定义。选色后停 1 秒自动应用，连续调整只应用最后一次；刷新后保持。
      </p>
      <div class="theme-color-dialog__card">
        <ThemeColorPicker />
      </div>
    </div>

    <template #footer>
      <el-button type="primary" @click="visible = false">完成</el-button>
    </template>
  </ChatDialog>
</template>

<style scoped lang="scss">
.theme-color-dialog {
  // ThemeColorPicker 用的是全局中性变量（--text-color / --bg-elevated …），
  // 这些变量不随 .theme-light-surface 切换；这里统一映射到当前主题面的 EP 变量，
  // 避免聊天页（暗色模式 + 浅色面）里出现浅字浅底。
  --text-color: var(--el-text-color-primary);
  --text-muted: var(--el-text-color-secondary);
  --bg-elevated: var(--el-bg-color-overlay);
  --border-color: var(--el-border-color-lighter);

  display: grid;
  gap: 14px;
  color: var(--el-text-color-primary);
}

.theme-color-dialog__hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

// 取色器放进一层半透明卡片，和主题色渐变背景拉开层次。
.theme-color-dialog__card {
  padding: 14px;
  border: 1px solid
    color-mix(
      in srgb,
      var(--theme-color) 18%,
      var(--el-border-color-lighter)
    );
  border-radius: 16px;
  background: color-mix(
    in srgb,
    var(--el-bg-color-overlay) 78%,
    transparent
  );
  backdrop-filter: blur(10px);
}
</style>
