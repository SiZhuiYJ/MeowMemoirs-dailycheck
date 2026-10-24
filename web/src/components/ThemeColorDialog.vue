<script setup lang="ts">
import ThemeColorPicker from "@/components/ThemeColorPicker.vue";

const visible = defineModel<boolean>({ default: false });
</script>

<template>
  <el-dialog
    v-model="visible"
    class="theme-color-dialog"
    modal-class="theme-color-dialog-overlay"
    title="主题色"
    width="min(92vw, 400px)"
    append-to-body
  >
    <p class="theme-color-dialog__hint">
      选择一个预设色，或用取色器自定义；修改会实时应用并保存，刷新后保持。
    </p>
    <ThemeColorPicker />
    <template #footer>
      <el-button type="primary" @click="visible = false">完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.theme-color-dialog__hint {
  margin: 0 0 14px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}
</style>

<style lang="scss">
// 主题色对话框：用当前种子色做一层柔和的主题渐变，
// 让对话框本身也成为取色预览的一部分，而不是一块纯白 / 纯黑的板子。
.theme-color-dialog-overlay {
  background: color-mix(in srgb, var(--theme-color) 12%, rgba(2, 6, 23, 0.55));
  backdrop-filter: blur(5px);
}

.theme-color-dialog.el-dialog {
  overflow: hidden;
  padding: 20px 22px 18px;
  border: 1px solid color-mix(in srgb, var(--theme-color) 30%, var(--border-color));
  border-radius: 20px;
  background:
    radial-gradient(
      120% 95% at 0% 0%,
      color-mix(in srgb, var(--theme-color) 30%, transparent),
      transparent 58%
    ),
    radial-gradient(
      100% 85% at 100% 100%,
      color-mix(in srgb, var(--theme-color-strong) 16%, transparent),
      transparent 55%
    ),
    color-mix(in srgb, var(--theme-color) 10%, var(--bg-elevated));
  box-shadow:
    0 24px 70px rgba(var(--theme-color-rgb), 0.24),
    0 12px 30px rgba(17, 24, 39, 0.14);
}

.theme-color-dialog.el-dialog::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: linear-gradient(
    90deg,
    var(--theme-color),
    var(--theme-color-strong)
  );
  opacity: 0.85;
  pointer-events: none;
  z-index: 2;
}

.theme-color-dialog .el-dialog__header {
  position: relative;
  padding-bottom: 10px;
}

.theme-color-dialog .el-dialog__title {
  color: var(--text-color);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.theme-color-dialog .el-dialog__headerbtn {
  top: 7px;
  right: 7px;
}

.theme-color-dialog .el-dialog__headerbtn .el-dialog__close {
  color: var(--text-muted);
}

.theme-color-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: var(--theme-color-strong);
}

.theme-color-dialog .el-dialog__body {
  position: relative;
  padding: 4px 0 0;
}

// 取色器放进一层半透明卡片，和渐变背景拉开层次。
.theme-color-dialog .theme-color-picker {
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--theme-color) 18%, var(--border-color));
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-elevated) 78%, transparent);
  backdrop-filter: blur(10px);
}

.theme-color-dialog .el-dialog__footer {
  position: relative;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
}
</style>

