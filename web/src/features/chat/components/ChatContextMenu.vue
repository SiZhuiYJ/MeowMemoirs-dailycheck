<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import type { Component } from 'vue';

export interface ChatContextMenuItem {
  key: string;
  label: string;
  icon?: Component;
  disabled?: boolean;
  danger?: boolean;
  /** 在这一项上方画一条分隔线。 */
  divider?: boolean;
  /** 附加说明，显示为右侧浅色小字。 */
  hint?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    x: number;
    y: number;
    items: ChatContextMenuItem[];
    ariaLabel?: string;
  }>(),
  {
    ariaLabel: '聊天操作菜单',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  select: [key: string];
}>();

const menuRef = useTemplateRef<HTMLElement>('menuRef');
const position = ref({ left: 0, top: 0 });

const menuStyle = computed(() => ({
  left: `${position.value.left}px`,
  top: `${position.value.top}px`,
}));

function clampPosition() {
  const menu = menuRef.value;
  if (!menu) return;

  const margin = 8;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // 默认从鼠标位置向右下展开；右侧/下方放不下时向反方向翻，
  // 最后再兜底夹在视口内（极窄屏）。
  let left = props.x;
  let top = props.y;

  if (left + width + margin > viewportWidth) {
    left = props.x - width;
  }
  if (left < margin) {
    left = margin;
  }
  if (left + width + margin > viewportWidth) {
    left = Math.max(margin, viewportWidth - width - margin);
  }

  if (top + height + margin > viewportHeight) {
    top = props.y - height;
  }
  if (top < margin) {
    top = margin;
  }
  if (top + height + margin > viewportHeight) {
    top = Math.max(margin, viewportHeight - height - margin);
  }

  position.value = { left, top };
}

async function refreshPosition() {
  // 先用鼠标坐标挂载，避免菜单在左上角闪一帧；下一帧再按真实尺寸修正。
  position.value = { left: props.x, top: props.y };
  await nextTick();
  clampPosition();
}

watch(
  () => [props.modelValue, props.x, props.y] as const,
  ([visible], previous) => {
    const wasVisible = previous?.[0] ?? false;
    if (visible && (!wasVisible || previous?.[1] !== props.x || previous?.[2] !== props.y)) {
      void refreshPosition();
    }
  },
  { immediate: true },
);

function updateModelValue(value: boolean) {
  emit('update:modelValue', value);
}

function handlePointerDown(event: PointerEvent) {
  if (!props.modelValue) return;
  const menu = menuRef.value;
  if (menu && event.target instanceof Node && menu.contains(event.target)) return;
  updateModelValue(false);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.modelValue) {
    updateModelValue(false);
  }
}

/**
 * 只监听窗口尺寸变化，**不监听滚动**。
 *
 * 聊天页在图片加载、发消息后会自动滚到底部（smooth），如果菜单一有 scroll 就关，
 * 用户刚右键打开菜单、后台恰好补一次自动滚动，菜单就会瞬间消失。
 * 菜单记录的是「点开时的那条消息」，滚动后保持打开更符合预期；
 * 点外部 / Esc / 选择菜单项都会正常关闭。
 */
function handleViewportChange() {
  if (props.modelValue) updateModelValue(false);
}

function removeWindowListeners() {
  window.removeEventListener('pointerdown', handlePointerDown, true);
  window.removeEventListener('keydown', handleKeydown, true);
  window.removeEventListener('resize', handleViewportChange);
}

function addWindowListeners() {
  window.addEventListener('pointerdown', handlePointerDown, true);
  window.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('resize', handleViewportChange);
}

watch(
  () => props.modelValue,
  (visible) => {
    removeWindowListeners();
    if (visible) addWindowListeners();
  },
  { immediate: true },
);

onBeforeUnmount(removeWindowListeners);

function selectItem(item: ChatContextMenuItem) {
  if (item.disabled) return;
  emit('select', item.key);
  updateModelValue(false);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="chat-context-menu-fade">
      <div v-if="modelValue" ref="menuRef" class="chat-context-menu" :style="menuStyle" role="menu"
        :aria-label="ariaLabel" @pointerdown.stop @contextmenu.prevent>
        <template v-for="item in items" :key="item.key">
          <div v-if="item.divider" class="chat-context-menu__divider" role="separator" />
          <button type="button" class="chat-context-menu__item"
            :class="{ 'is-danger': item.danger, 'is-disabled': item.disabled }" :disabled="item.disabled"
            :title="item.hint || item.label" role="menuitem" @click="selectItem(item)">
            <el-icon v-if="item.icon" class="chat-context-menu__icon">
              <component :is="item.icon" />
            </el-icon>
            <span class="chat-context-menu__label">{{ item.label }}</span>
            <span v-if="item.hint" class="chat-context-menu__hint">{{ item.hint }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.chat-context-menu {
  position: fixed;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  min-width: 148px;
  max-width: min(280px, calc(100vw - 16px));
  max-height: min(420px, calc(100vh - 16px));
  padding: 4px;
  overflow-y: auto;
  border: 1px solid
    color-mix(
      in srgb,
      var(--theme-color) 24%,
      var(--el-border-color-lighter, #ebeef5)
    );
  border-radius: 8px;
  background: color-mix(
    in srgb,
    var(--theme-color) 7%,
    var(--el-bg-color-overlay, #fff)
  );
  box-shadow: var(--theme-outer-glow-soft);
  backdrop-filter: blur(8px);
  user-select: none;
}

.chat-context-menu__item {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 7px 10px;
  border: 0;
  border-radius: 5px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
  background: transparent;
  transition: background-color 0.12s ease, color 0.12s ease;

  &:hover:not(:disabled) {
    background: var(--theme-color-soft);
    color: var(--theme-color-strong);
  }

  &:active:not(:disabled) {
    background: color-mix(
      in srgb,
      var(--theme-color) 22%,
      var(--el-bg-color-overlay, #fff)
    );
    color: var(--theme-color-strong);
  }

  &.is-danger {
    color: var(--el-color-danger, #f56c6c);

    &:hover:not(:disabled) {
      background: color-mix(
        in srgb,
        var(--el-color-danger, #f56c6c) 12%,
        transparent
      );
      color: var(--el-color-danger, #f56c6c);
    }
  }

  &.is-disabled {
    color: var(--el-text-color-disabled, #a8abb2);
    cursor: not-allowed;
  }
}

.chat-context-menu__icon {
  flex-shrink: 0;
  font-size: 15px;
}

.chat-context-menu__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-context-menu__hint {
  flex-shrink: 0;
  max-width: 118px;
  overflow: hidden;
  color: var(--el-text-color-secondary, #909399);
  font-size: 10px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-context-menu__divider {
  height: 1px;
  margin: 4px 6px;
  background: color-mix(
    in srgb,
    var(--theme-color) 16%,
    var(--el-border-color-lighter, #ebeef5)
  );
}

.chat-context-menu-fade-enter-active,
.chat-context-menu-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
  transform-origin: top left;
}

.chat-context-menu-fade-enter-from,
.chat-context-menu-fade-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
