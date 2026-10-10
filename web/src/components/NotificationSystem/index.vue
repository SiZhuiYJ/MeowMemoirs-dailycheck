<script setup lang="ts">
import { toRgba, darkenColor } from "@/utils/color";
import gsap from "gsap";

// import {Close} from ""
/**
 * 通知消息接口
 * 用于定义通知消息的属性
 * @property {number} id - 通知消息的唯一标识符
 * @property {string} content - 通知消息的内容
 * @property {string} color - 通知消息的颜色，支持十六进制颜色字符串
 * @property {number} [duration=5000] - 通知消息的显示时间，单位为毫秒
 * @property {boolean} [closable=true] - 是否显示关闭按钮
 * @property {'ltr' | 'rtl' | 'ttb' | 'btt' | 'center' | 'vSplit' | 'ripple' | 'spotlight' | 'fade'} [direction='vSplit'] - 通知消息的显示方向
 * ltr - 从左向右显示
 * rtl - 从右向左显示
 * ttb - 从上到下显示
 * btt - 从下到上显示
 * center - 居中显示
 * vSplit - 垂直分割显示
 * ripple - 涟漪效果显示
 * spotlight - 聚光灯效果显示
 * fade - 渐变效果显示
 * @property {number} count - 通知消息的出现次数
 * @property {number} progress - 通知消息的进度，用于动画效果
 * @property {boolean} isRemoving - 是否正在移除通知消息
 * @property {gsap.core.Tween | null} tween - 用于动画效果的 GSAP 补间对象
 */
export interface NotificationMessage {
  id: number;
  content: string;
  color: string;
  duration?: number;
  closable?: boolean;
  direction?:
  | "ltr"
  | "rtl"
  | "ttb"
  | "btt"
  | "center"
  | "vSplit"
  | "ripple"
  | "spotlight"
  | "fade";
  count: number;
  progress: number;
  isRemoving: boolean;
  tween?: gsap.core.Tween | null;
}

const messages = ref<NotificationMessage[]>([]);
const itemRefs = ref<Record<number, HTMLElement>>({});

// 全局消息ID计数器，确保每个消息都有唯一ID
let messageIdCounter = 0;

const activeMessages = computed(() => messages.value.slice(0, 5));

const setItemRef = (el: any, id: number) => {
  if (el) itemRefs.value[id] = el as HTMLElement;
  else delete itemRefs.value[id];
};

const getLuminance = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const getDynamicTextColor = (msg: NotificationMessage) => {
  const luminance = getLuminance(msg.color);
  // return luminance < 0.6 ? "#ffffff" : "#1e293b";
  return luminance < 0.6 ? "#ffffff" : "#ffffff";
};

const getBadgeBg = (msg: NotificationMessage) => {
  return getDynamicTextColor(msg) === "#ffffff"
    ? "rgba(255, 255, 255, 0.2)"
    : "rgba(0, 0, 0, 0.06)";
};

const getItemBaseStyle = (msg: NotificationMessage, index: number) => ({
  background: toRgba(msg.color, 0.5),
  color: msg.color,
  zIndex: 100 - index,
  "--bgc": toRgba(msg.color, 0.5),
});

const getProgressStyle = (msg: NotificationMessage) => {
  let style: any = {
    transform: "scale(1)",
    transformOrigin: "left center",
    opacity: 1,
    filter: "none",
  };

  switch (msg.direction) {
    case "ltr":
      style.transform = `scaleX(${msg.progress})`;
      style.transformOrigin = "left center";
      break;
    case "rtl":
      style.transform = `scaleX(${msg.progress})`;
      style.transformOrigin = "right center";
      break;
    case "ttb":
      style.transform = `scaleY(${msg.progress})`;
      style.transformOrigin = "center top";
      break;
    case "btt":
      style.transform = `scaleY(${msg.progress})`;
      style.transformOrigin = "center bottom";
      break;
    case "center":
      style.transform = `scaleX(${msg.progress})`;
      style.transformOrigin = "center center";
      break;
    case "vSplit":
      style.transform = `scaleY(${msg.progress})`;
      style.transformOrigin = "center center";
      break;
    case "ripple":
      style.transform = `scaleX(${msg.progress})`;
      style.transformOrigin = "left center";
      break;
    case "spotlight":
      style.transform = `scaleX(${msg.progress})`;
      style.transformOrigin = "left center";
      break;
    case "fade":
      style.opacity = msg.progress;
      style.transform = `scale(${0.98 + 0.02 * msg.progress})`;
      style.filter = `blur(${(1 - msg.progress) * 2}px)`;
      break;
  }
  return style;
};

const getSpotlightStyle = (msg: NotificationMessage) => {
  return {
    left: `${msg.progress * 100}%`,
    transform: "translateX(-100%)",
    opacity: msg.progress > 0.1 ? 1 : 0,
    transition: "opacity 0.3s",
  };
};

const animateLayout = (callback: () => void) => {
  const state = new Map<number, number>();
  activeMessages.value.forEach((msg) => {
    const el = itemRefs.value[msg.id];
    if (el) state.set(msg.id, el.getBoundingClientRect().top);
  });
  callback();
  nextTick(() => {
    const moves: Array<{ id: number; el: HTMLElement; deltaY: number; distance: number }> = [];
    state.forEach((oldTop, id) => {
      const el = itemRefs.value[id];
      if (!el) return;
      const newTop = el.getBoundingClientRect().top;
      const deltaY = oldTop - newTop;
      if (deltaY !== 0) {
        moves.push({ id, el, deltaY, distance: Math.abs(deltaY) });
      }
    });

    if (moves.length > 0) {
      // Sort by distance so larger moves animate first for a natural flow
      moves.sort((a, b) => b.distance - a.distance);
      const tl = gsap.timeline({ defaults: { duration: 0.46, ease: 'power3.out', force3D: true } });
      moves.forEach((m, idx) => {
        const staggerDelay = Math.min(0.08, idx * 0.02);
        // start slightly overlapped to avoid rigid simultaneous motion
        tl.fromTo(
          m.el,
          ({ y: m.deltaY, opacity: 0.95, filter: 'blur(2px)' } as any),
          ({
            y: 0,
            opacity: 1,
            filter: 'blur(0px)',
            onStart: () => (m.el.style.willChange = 'transform, opacity'),
            onComplete: () => (m.el.style.willChange = ''),
          } as any),
          Math.max(0, staggerDelay - 0.06),
        );
      });
    }
  });
};

const addMessage = (options: {
  content: string;
  color?: string;
  duration?: number;
  closable?: boolean;
  direction?: NotificationMessage["direction"];
}) => {
  const {
    content,
    color = "#3b82f6",
    duration = 5000,
    closable = true,
    direction = "rtl",
  } = options;

  const existing = messages.value.find(
    (m) =>
      m.content === content &&
      m.color.toLowerCase() === color.toLowerCase() &&
      !m.isRemoving,
  );

  if (existing) {
    existing.count++;
    if (existing.tween) existing.tween.kill();
    startCountdown(existing, duration);
    const el = itemRefs.value[existing.id];
    if (el) {
      gsap.to(el, { scale: 1.05, duration: 0.1, yoyo: true, repeat: 1 });
    }
    return;
  }

  animateLayout(() => {
    // 使用递增计数器确保唯一性，避免 Date.now() 可能产生的重复值
    const id = ++messageIdCounter;
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
      tween: null,
    });
    messages.value.unshift(newMessage);

    nextTick(() => {
      const el = itemRefs.value[id];
      if (el) {
        // 更明显的顶部滑入效果：从更上方进入并平滑落位
        gsap.fromTo(
          el,
          { y: -80, opacity: 0, scale: 0.96, filter: "blur(6px)" },
          {
            y: 0,
            opacity: 1,
            scale: 1,
            filter: "blur(0px)",
            duration: 0.52,
            ease: "power4.out",
          },
        );
        startCountdown(newMessage, duration);
      }
    });
  });
};

const startCountdown = (message: NotificationMessage, duration: number) => {
  message.progress = 1;
  message.tween = gsap.to(message, {
    progress: 0,
    duration: duration / 1000,
    ease: "none",
    onComplete: () => removeMessage(message.id),
  });
};

const removeMessage = (id: number) => {
  const index = messages.value.findIndex((m) => m.id === id);
  if (index === -1) return;
  const message = messages.value[index];
  if (!message) return;
  if (message.isRemoving) return;

  animateLayout(() => {
    message.isRemoving = true;
    if (message.tween) message.tween.kill();
    const el = itemRefs.value[id];
    if (el) {
      const tl = gsap.timeline({
        onComplete: () => {
          messages.value = messages.value.filter((m) => m.id !== id);
        },
      });
      // 缩小移除：动画先将元素整体缩放到 0 并淡出，同时收缩内边距，随后折叠高度
      tl.to(el, {
        scale: 0,
        opacity: 0,
        filter: "blur(6px)",
        paddingTop: 0,
        paddingBottom: 0,
        transformOrigin: "center center",
        duration: 0.35,
        ease: "power2.in",
      }).to(
        el,
        { height: 0, marginBottom: 0, duration: 0.25, ease: "power2.in" },
        "-=0.15",
      );
    } else {
      messages.value = messages.value.filter((m) => m.id !== id);
    }
  });
};

defineExpose({
  addMessage,
  removeMessage,
});
</script>

<template>
  <div class="notification-container">
    <div v-for="(msg, index) in activeMessages" :key="msg.id" :ref="(el) => setItemRef(el, msg.id)"
      class="notification-item" :style="getItemBaseStyle(msg, index)">
      <div class="bg-layer-persistent"></div>

      <div class="fg-layer-progress" :style="getProgressStyle(msg)"></div>

      <!-- Spotlight 额外光晕 -->
      <div v-if="msg.direction === 'spotlight'" class="spotlight-glow" :style="getSpotlightStyle(msg)"></div>

      <div class="content-wrapper" :style="{ color: getDynamicTextColor(msg) }">
        <div v-if="msg.closable" class="spacer"></div>
        <span class="text-content" :title="msg.content">{{ msg.content }}</span>
        <span v-if="msg.count > 1" class="count-badge" :style="{ backgroundColor: getBadgeBg(msg) }">
          <p>*</p>
          {{ msg.count }}
        </span>
        <span v-if="msg.closable" class="close-btn" :style="{
          '--bgc-color': darkenColor(msg.color, 0.1),
          '--border-color': darkenColor(msg.color, 0.5),
        }" @click="removeMessage(msg.id)">
        </span>
      </div>
    </div>

    <div v-if="messages.length > 5" class="hidden-count-badge">
      + {{ messages.length - 5 }} 条未显示通知
    </div>
  </div>
</template>

<style scoped lang="scss">
:root {
  --item-height: 44px;
  --main-radius: 22px;
}

.notification-container {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  padding: 12px;
  box-sizing: border-box;
}

.notification-item {
  pointer-events: auto;
  position: relative;
  margin-bottom: 8px;
  padding: 8px 20px;
  border-radius: 22px;
  width: fit-content;
  max-width: calc(100vw - 40px);
  min-width: 140px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 20px -6px rgba(0, 0, 0, 0.12);
  user-select: none;
  background: rgba(0, 0, 0, 0.12);
  overflow: hidden;
  will-change: transform, opacity;
  border: 2px solid currentColor;
  transition: all 0.3s ease;

  /* Added border */
  &:hover {
    box-shadow: 0 0 20px 2px var(--bgc);
    // border: 3px solid currentColor;
  }
}

@media (max-width: 640px) {
  .notification-item {
    padding: 6px 16px;
    min-height: 40px;
    min-width: 120px;
  }
}

.bg-layer-persistent {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: 0.15;
  background-color: currentColor;
  border-radius: 22px;
}

.fg-layer-progress {
  position: absolute;
  inset: 0;
  z-index: 2;
  background-color: currentColor;
  border-radius: 22px;
  will-change: transform, opacity, filter;
}

.spotlight-glow {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 60px;
  background: linear-gradient(90deg,
      transparent,
      rgba(255, 255, 255, 0.6),
      transparent);
  z-index: 3;
  pointer-events: none;
}

.content-wrapper {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  transition: color 0.5s ease;
  min-width: 0;
}

.text-content {
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.025em;
  flex: 1 1 auto;
  min-width: 0;
}

.spacer {
  width: 18px;
  flex-shrink: 0;
}

.count-badge {
  display: flex;
  font-weight: 900;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 0.7rem;
  box-shadow: 0 0 2px rgb(255 255 255);
  flex-shrink: 0;
  transition: transform 0.3s;
  animation: smoothShake 1.2s infinite;
  /* 总时长1.2s，前0.6s晃动，后0.6s静止 */

  >p {
    font-weight: 400;
  }

  &:hover {
    opacity: 1;
    animation: none;
    /* 停止晃动 */
    transform: scale(1.1);
    /* 放大元素 */
  }
}

/* 晃动动画 */
@keyframes smoothShake {
  0% {
    transform: rotate(0deg) scale(1);
  }

  10% {
    transform: rotate(9deg) scale(1);
    /* 向右 */
  }

  20% {
    transform: rotate(-9deg) scale(1);
    /* 向左 */
  }

  30% {
    transform: rotate(6deg) scale(1);
    /* 向右减弱 */
  }

  40% {
    transform: rotate(-6deg) scale(1);
    /* 向左减弱 */
  }

  50% {
    transform: rotate(0deg) scale(1);
    /* 恢复静止 */
  }

  100% {
    transform: rotate(0deg) scale(1);
    /* 保持静止至周期结束 */
  }
}

.close-btn {
  // 定义 close-btn 的 SCSS 变量
  $close-color: #ffffff;
  $bgc-color: #000000;
  $border-color: #000000;
  $size: 24px;
  $plus-size: 14px;
  $plus-thickness: 4px;
  $border-width: 1px;
  $transition-duration: 0.2s;
  $rotate-duration: 0.5s;
  $scale-factor: 1.2;

  // 设置 CSS 变量，供其他样式使用
  --close-color: #{$close-color};
  --bgc-color: #{$bgc-color};
  --border-color: #{$border-color};

  opacity: 0.5;
  width: $size;
  height: $size;
  border-radius: 50%;
  border-width: 5px;
  border-spacing: 5px;
  border: $border-width dashed var(--close-color);
  background-color: var(--bgc-color);

  // 使用 SCSS 循环和函数生成加号背景
  background-image:
    linear-gradient($close-color, $close-color),
    linear-gradient($close-color, $close-color);
  background-repeat: no-repeat;
  background-position: center;
  background-size:
    $plus-size $plus-thickness,
    $plus-thickness $plus-size;

  // 定义过渡效果
  transition:
    background-color $transition-duration ease,
    box-shadow $transition-duration ease,
    transform $rotate-duration ease;
  cursor: pointer;
  transform: rotate(45deg);

  &:hover {
    opacity: 1;
    transform: rotate(225deg) scale($scale-factor);
  }

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: 0 0 0 6px var(--close-color);
    opacity: 0;
    transition: 0.3s;
  }

  &:focus-visible {
    outline: 0;
  }

  &:hover,
  &:focus {
    color: var(--bgc-color);
    border-color: var(--close-color);
  }

  &:active {
    background-color: var(--bgc-color);

    &::after {
      transition: 0s;
      box-shadow: none;
      opacity: 0.4;
    }
  }
}

.hidden-count-badge {
  font-size: 10px;
  color: #94a3b8;
  margin-top: 0.5rem;
  font-weight: 700;
  padding: 0.25rem 0.75rem;
  background-color: rgba(255, 255, 255, 0.8);
  border-radius: 9999px;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
</style>
