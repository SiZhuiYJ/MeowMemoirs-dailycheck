<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue';
// @ts-ignore
import gsap from 'gsap/dist/gsap';
import { setNotificationInstance } from '../utils/notification';

export interface NotificationMessage {
  id: number;
  content: string;
  color: string;
  duration?: number;
  closable?: boolean;
  direction?: 'ltr' | 'rtl' | 'ttb' | 'btt' | 'center' | 'vSplit' | 'ripple' | 'spotlight' | 'fade';
  count: number;
  progress: number;
  isRemoving: boolean;
  tween?: gsap.core.Tween | null;
}

const messages = ref<NotificationMessage[]>([]);

// Uni-app: active messages limit
const activeMessages = computed(() => messages.value.slice(0, 5));

/**
 * 通知条单色改造：统一为「白卡片 + 语义强调色细条」的语言。
 *
 * 调用方（utils/notification.ts 的 notifySuccess / notifyError / notifyWarning / notifyInfo）
 * 历史上会直接传绿 / 红 / 黄 / 蓝的写死色值。项目规范要求颜色只能来自主题 token，
 * 因此这里按 RGB 色相把传入颜色归类到 --color-success / -danger / -warning / -info，
 * 样式里不直出旧色值；无法识别的颜色（含默认的 var(--theme-primary)）用主题强调色。
 */
const resolveAccentColor = (color?: string): string => {
  const value = (color || '').trim();
  if (value.startsWith('var(')) return value;
  const hex = value.replace('#', '');
  if (!/^[\da-f]{6}$/i.test(hex)) return 'var(--theme-primary)';

  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);

  // 绿 → 成功；红 → 危险；黄/橙 → 警告；蓝 → 信息；其余 → 主题强调色
  if (g > r * 1.15 && g > b * 1.15) return 'var(--color-success)';
  if (r > g * 1.15 && r > b * 1.15) {
    return r > 200 && g > 140 ? 'var(--color-warning)' : 'var(--color-danger)';
  }
  if (b > r * 1.15 && b > g * 1.05) return 'var(--color-info)';
  return 'var(--theme-primary)';
};

/** 卡片只负责层级；强调色通过左侧 3px 描边体现（颜色由语义变量决定）。 */
const getItemBaseStyle = (msg: NotificationMessage, index: number) => ({
  zIndex: 9999 - index,
  borderLeftColor: resolveAccentColor(msg.color),
});

const getProgressStyle = (msg: NotificationMessage): any => {
  let style: any = {
    transform: 'scale(1)',
    transformOrigin: 'left center',
    opacity: 1,
    backgroundColor: resolveAccentColor(msg.color),
  };

  switch (msg.direction) {
    case 'ltr':
      style.transform = `scaleX(${msg.progress})`;
      style.transformOrigin = 'left center';
      break;
    case 'rtl':
      style.transform = `scaleX(${msg.progress})`;
      style.transformOrigin = 'right center';
      break;
    case 'ttb':
      style.transform = `scaleY(${msg.progress})`;
      style.transformOrigin = 'center top';
      break;
    case 'btt':
      style.transform = `scaleY(${msg.progress})`;
      style.transformOrigin = 'center bottom';
      break;
    case 'center':
      style.transform = `scaleX(${msg.progress})`;
      style.transformOrigin = 'center center';
      break;
    case 'vSplit':
      style.transform = `scaleY(${msg.progress})`;
      style.transformOrigin = 'center center';
      break;
    default:
      style.transform = `scaleX(${msg.progress})`;
      style.transformOrigin = 'left center';
      break;
  }
  return style;
};

const addMessage = (options: {
  content: string;
  color?: string;
  duration?: number;
  closable?: boolean;
  direction?: NotificationMessage['direction'];
}) => {
  const {
    content,
    color = 'var(--theme-primary)',
    duration = 3000,
    closable = true,
    direction = 'vSplit'
  } = options;

  const existing = messages.value.find(m =>
    m.content === content && m.color === color && !m.isRemoving
  );

  if (existing) {
    existing.count++;
    if (existing.tween) existing.tween.kill();
    startCountdown(existing, duration);
    return;
  }

  const id = Date.now();
  const newMessage = reactive<NotificationMessage>({
    id,
    content,
    color,
    duration,
    closable,
    direction,
    count: 1,
    progress: 1,
    isRemoving: false,
    tween: null
  });

  messages.value.unshift(newMessage);
  startCountdown(newMessage, duration);
};

const startCountdown = (message: NotificationMessage, duration: number) => {
  message.progress = 1;
  // Use GSAP to animate the reactive 'progress' property
  message.tween = gsap.to(message, {
    progress: 0,
    duration: duration / 1000,
    ease: "none",
    onComplete: () => removeMessage(message.id)
  });
};

const removeMessage = (id: number) => {
  const index = messages.value.findIndex(m => m.id === id);
  if (index === -1) return;
  const message = messages.value[index];
  if (!message || message.isRemoving) return;

  message.isRemoving = true;
  if (message.tween) message.tween.kill();

  // Simple timeout to allow for leave animation if we added one,
  // but for now we just remove it to keep it simple in Uni-app
  messages.value = messages.value.filter(m => m.id !== id);
};

const instance = {
  addMessage,
  removeMessage
};

onMounted(() => {
  setNotificationInstance(instance);
});

defineExpose(instance);
</script>

<template>
  <view class="notification-container">
    <view
      v-for="(msg, index) in activeMessages"
      :key="msg.id"
      class="notification-item"
      :style="getItemBaseStyle(msg, index)"
    >
      <!-- 进度层：底部细条按剩余时间收缩，颜色跟随语义强调色 -->
      <view class="progress-layer" :style="getProgressStyle(msg)"></view>

      <!-- Content -->
      <view class="content-wrapper">
        <text class="text-content">{{ msg.content }}</text>
        <view v-if="msg.count > 1" class="count-badge">
          <text class="count-text">{{ msg.count }}</text>
        </view>
        <view v-if="msg.closable" @click.stop="removeMessage(msg.id)" class="close-btn" hover-class="mm-hover">
          <text class="close-text">×</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 通知容器：顶部固定、居中、不拦截页面点击 */
.notification-container {
  position: fixed;
  /* 顶栏下方：状态栏 + 自定义导航栏 44px + 8px 间距（与 MmNavBar 保持一致） */
  top: calc(var(--status-bar-height, 0px) + var(--navbar-h, 44px) + 8px);
  padding-top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

/* 单色卡片语言：白底 + 1px 描边 + 左侧语义强调条 */
.notification-item {
  position: relative;
  margin-bottom: 10px;
  padding: 10px 16px;
  border-radius: var(--card-radius);
  min-width: 160px;
  max-width: 88%;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--theme-primary);
  box-shadow: var(--card-shadow);
  overflow: hidden;
  pointer-events: auto;
}

/* 倒计时进度层：贴底 3px 细条，只做透明度/缩放过渡 */
.progress-layer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  opacity: 0.72;
  background-color: var(--theme-primary);
}

.content-wrapper {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-color);
}

.text-content {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

/* 重复计数徽标：中性浅底，保持单色语言 */
.count-badge {
  padding: 1px 8px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--surface-soft);
  border: 1px solid var(--divider-color);
}

.count-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

/* 关闭按钮：行内小控件，热区 36px，避免误触 */
.close-btn {
  width: 36px;
  height: 36px;
  margin-right: -8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--text-faint);
}

.close-text {
  font-size: 18px;
  line-height: 18px;
}
</style>
