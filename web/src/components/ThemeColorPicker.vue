<script setup lang="ts">
import { computed } from "vue";
import { useTheme } from "@/composables/use-theme";
import { THEME_COLOR_PRESETS } from "@/composables/theme-palette";

/**
 * 主题色选择器，放在 ThemeColorDialog 对话框里。
 *
 * 预设色点 + 原生取色器；所有操作都实时写入 useTheme 的 themeColor，
 * 由它生成整套色阶并持久化，同时播放 500ms 的纯颜色过渡。
 */
const { themeColor, setThemeColor, resetThemeColor } = useTheme();

const currentColor = computed(() => themeColor.value.toLowerCase());

function selectColor(color: string): void {
  setThemeColor(color);
}

function handleCustomColor(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input?.value) setThemeColor(input.value);
}
</script>

<template>
  <div class="theme-color-picker" @click.stop @mousedown.stop>
    <div class="theme-color-picker__head">
      <span>主题色</span>
      <code class="theme-color-picker__value">{{ themeColor }}</code>
    </div>

    <div class="theme-color-picker__swatches" role="group" aria-label="预设主题色">
      <button
        v-for="color in THEME_COLOR_PRESETS"
        :key="color"
        type="button"
        class="theme-color-picker__swatch"
        :class="{ 'is-active': currentColor === color.toLowerCase() }"
        :style="{ backgroundColor: color }"
        :title="color"
        :aria-label="`使用主题色 ${color}`"
        :aria-pressed="currentColor === color.toLowerCase()"
        @click="selectColor(color)"
      />
    </div>

    <div class="theme-color-picker__custom">
      <label class="theme-color-picker__custom-label">
        <input
          class="theme-color-picker__input"
          type="color"
          :value="themeColor"
          aria-label="自定义主题色"
          @input="handleCustomColor"
          @change="handleCustomColor"
        />
        <span>自定义颜色</span>
      </label>
      <button type="button" class="theme-color-picker__reset" @click="resetThemeColor">
        恢复默认
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.theme-color-picker {
  display: grid;
  gap: 12px;
  padding: 2px 0 0;
  color: var(--text-color);
}

.theme-color-picker__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 12px;
}

.theme-color-picker__value {
  color: var(--theme-color-strong);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.theme-color-picker__swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.theme-color-picker__swatch {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  background-clip: padding-box;
  box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.16);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    transform: scale(1.1);
  }

  &.is-active {
    border-color: var(--text-color);
    box-shadow:
      0 0 0 2px var(--bg-elevated),
      0 0 0 4px var(--theme-color-strong);
  }
}

.theme-color-picker__custom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}

.theme-color-picker__custom-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-color);
  font-size: 12px;
  cursor: pointer;
}

.theme-color-picker__input {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;

  &::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  &::-webkit-color-swatch {
    border: 2px solid var(--theme-color-strong);
    border-radius: 50%;
  }

  &::-moz-color-swatch {
    border: 2px solid var(--theme-color-strong);
    border-radius: 50%;
  }
}

.theme-color-picker__reset {
  padding: 2px;
  border: 0;
  color: var(--theme-color-strong);
  font-size: 11px;
  background: transparent;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}
</style>
