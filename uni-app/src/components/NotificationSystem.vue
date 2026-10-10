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

const getLuminance = (hex: string) => {
  // Simple hex to rgb conversion
  let r = 0, g = 0, b = 0;
  if (hex.startsWith('#')) {
    hex = hex.slice(1);
  }
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const getDynamicTextColor = (msg: NotificationMessage) => {
  const luminance = getLuminance(msg.color);
  return luminance < 0.6 ? '#ffffff' : '#1e293b';
};

const getBadgeBg = (msg: NotificationMessage) => {
  return getDynamicTextColor(msg) === '#ffffff' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.06)';
};

const getItemBaseStyle = (msg: NotificationMessage, index: number) => ({
  color: msg.color,
  zIndex: 9999 - index
});

const getProgressStyle = (msg: NotificationMessage) => {
  let style: any = {
    transform: 'scale(1)',
    transformOrigin: 'left center',
    opacity: 1,
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
    color = '#3b82f6',
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
  <view class="notification-container" :style="{ pointerEvents: 'none' }">
    <view 
      v-for="(msg, index) in activeMessages" 
      :key="msg.id" 
      class="notification-item" 
      :style="getItemBaseStyle(msg, index)"
    >
      <!-- Background Layer -->
      <view class="bg-layer-persistent"></view>

      <!-- Progress Layer -->
      <view class="fg-layer-progress" :style="getProgressStyle(msg)"></view>

      <!-- Content -->
      <view class="content-wrapper" :style="{ color: getDynamicTextColor(msg) }">
        <text class="text-content">{{ msg.content }}</text>
        <view v-if="msg.count > 1" class="count-badge" :style="{ backgroundColor: getBadgeBg(msg) }">
          <text class="count-text">{{ msg.count }}</text>
        </view>
        <view v-if="msg.closable" @click.stop="removeMessage(msg.id)" class="close-btn">
          <text class="close-text">×</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.notification-container {
  position: fixed;
  top: var(--status-bar-height);
  /* Add some offset from top */
  padding-top: 40px; 
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.notification-item {
  position: relative;
  margin-bottom: 10px;
  padding: 8px 20px;
  border-radius: 22px;
  min-width: 140px;
  max-width: 80%;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  background-color: #fff;
  overflow: hidden;
  pointer-events: auto;
  border: 2px solid currentColor;
}

.bg-layer-persistent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  opacity: 0.15;
  background-color: currentColor;
  border-radius: 22px;
  z-index: 1;
}

.fg-layer-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: currentColor;
  border-radius: 22px;
  z-index: 2;
}

.content-wrapper {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.text-content {
  font-size: 14px;
  font-weight: 700;
  lines: 1;
  text-overflow: ellipsis;
}

.count-badge {
  padding: 1px 6px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.count-text {
  font-size: 10px;
  font-weight: 900;
  color: inherit;
}

.close-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
}

.close-text {
  font-size: 18px;
  line-height: 18px;
}
</style>
