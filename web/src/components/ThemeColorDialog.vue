<script setup lang="ts">
import ThemeColorPicker from "@/components/ThemeColorPicker.vue";

const visible = defineModel<boolean>({ default: false });
</script>

<template>
  <el-dialog
    v-model="visible"
    class="theme-color-dialog"
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
