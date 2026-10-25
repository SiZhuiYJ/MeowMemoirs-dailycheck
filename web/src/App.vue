<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { telemetry } from "@/libs/telemetry";

/**
 * 埋点诊断入口（悬浮按钮）。
 * 有错误事件时显示红点，方便在手机上直接点开看「刚才报了什么」。
 * 关闭方式：.env 里设 VITE_TELEMETRY_DEBUG=false
 */
const telemetryDebugEnabled = telemetry.isDebugEnabled();
const route = useRoute();
const router = useRouter();
const telemetryErrorCount = ref(
  telemetry.getEvents().filter((event) => event.level === "error").length,
);
telemetry.subscribe((event) => {
  if (event.level === "error") telemetryErrorCount.value += 1;
});
const showTelemetryFab = computed(
  () => telemetryDebugEnabled && route.path !== "/debug/telemetry",
);
// 2495550774@qq.com
import { dayjs } from "element-plus";
import { setNotificationInstance } from "@/utils/notification";
import { useDeviceLayout } from "@/composables/use-device-layout";
import NotificationSystem from "@/components/NotificationSystem/index.vue";
import TelemetryFab from "@/components/TelemetryFab.vue";
// import {
//   notify,
//   notifySuccess,
//   notifyWarning,
//   notifyError,
// } from "@/utils/notification";
// @ts-ignore
import zhCn from "element-plus/dist/locale/zh-cn.mjs";
// @ts-ignore
dayjs.en.weekStart = 1;

const notificationSystemRef = useTemplateRef("notificationSystemRef");

/**
 * Element Plus 组件的全局尺寸，随窗口自适应。
 *
 * 交给 el-config-provider 的 size，而不是各处单独写：EP 会给所有子组件加
 * `--small` / `--large` 尺寸类，按钮、输入框、下拉、日期选择器等一起跟着变，
 * 是官方且唯一的统一切换点。
 *
 * 策略：只有「视口过矮」（横屏手机 852x393、被拉扁的窗口、分屏）才降到 small ——
 * 那时纵向空间是主要矛盾；竖屏手机宽度虽窄但高度充足，用默认尺寸，
 * 否则 24px 的输入框在触屏上反而难点中。
 *
 * 「窄但不矮」的窗口由 styles/responsive.scss 里的流体尺寸变量
 * （--el-component-size 等，28~32px）负责，两级配合覆盖各种窗口。
 */
const { isShortViewport } = useDeviceLayout();
const elementComponentSize = computed<"default" | "small">(() =>
  isShortViewport.value ? "small" : "default",
);

// import gsap from 'gsap';

// import { useTransitionComposable } from '@/composables/transition-composable';

// const { toggleTransitionComplete } = useTransitionComposable();

// // Transition Hooks
// const onEnter = (el: Element, done: () => void) => {
//   gsap.set(el, { autoAlpha: 0, scale: 0.8, xPercent: -100 });
//   gsap
//     .timeline({
//       paused: true,
//       onComplete() {
//         toggleTransitionComplete(true);
//         done();
//       },
//     })
//     .to(el, { autoAlpha: 1, xPercent: 0, duration: 0.25 })
//     .to(el, { scale: 1, duration: 0.25 })
//     .play();
// };

// const onLeave = (el: Element, done: () => void) => {
//   toggleTransitionComplete(false);
//   gsap
//     .timeline({ paused: true, onComplete: done })
//     .to(el, { scale: 0.8, duration: 0.2 })
//     .to(el, { xPercent: 100, autoAlpha: 0, duration: 0.2 })
//     .play();
// };

onMounted(async () => {
  //   toggleTransitionComplete(true);

  setNotificationInstance(notificationSystemRef.value);

  // 测试通知系统（减少测试数量以避免性能问题）
  // notify({
  //   content: "欢迎使用每日打卡系统",
  //   color: "#10b981",
  //   duration: 30000,
  // });

  // 延迟测试不同类型的通知
  // setTimeout(() => {
  //   notifySuccess("登录成功！");
  // }, 2000);
  // setTimeout(() => {
  //   notifyWarning("请注意打卡时间");
  // }, 4000);
  // setTimeout(() => {
  //   notifyError("网络连接异常");
  // }, 6000);
});

import type { ButtonInstance, DialogTransition } from "element-plus";

type GlobalConfig = {
  alignCenter: boolean;
  draggable: boolean;
  overflow: boolean;
  transition?: DialogTransition;
};

const config = shallowReactive<GlobalConfig>({
  alignCenter: true,
  draggable: false,
  overflow: false,
});
const enableTransition = ref(true);
const isObjectTransition = ref(false);

const buttonRef = ref<ButtonInstance>();

const ANIMATION_DURATION = 300;

const globalConfig = computed<GlobalConfig>(() => {
  let transition: DialogTransition | undefined;
  if (enableTransition.value) {
    if (isObjectTransition.value) {
      transition = {
        css: false,
        onBeforeEnter(el: Element) {
          nextTick(() => {
            if (buttonRef.value) {
              const buttonRect = buttonRef.value.ref!.getBoundingClientRect();
              const dialogEl = (el as HTMLElement).querySelector(".el-dialog") as HTMLElement;

              if (dialogEl) {
                const dialogRect = dialogEl.getBoundingClientRect();

                const offsetX =
                  buttonRect.left +
                  buttonRect.width / 2 -
                  (dialogRect.left + dialogRect.width / 2);
                const offsetY =
                  buttonRect.top +
                  buttonRect.height / 2 -
                  (dialogRect.top + dialogRect.height / 2);

                dialogEl.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(0.3)`;
                dialogEl.style.opacity = "0";
              }
            }
          });
        },
        onEnter(el: Element, done: () => void) {
          nextTick(() => {
            const dialogEl = (el as HTMLElement).querySelector(".el-dialog") as HTMLElement | null;
            if (dialogEl) {
              // force reflow
              dialogEl.offsetHeight;

              dialogEl.style.transition = `all ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 1, 1)`;
              dialogEl.style.transform = "translate(0, 0) scale(1)";
              dialogEl.style.opacity = "1";

              // wait for animation to complete, then cleanup inline styles to avoid affecting drag
              setTimeout(() => {
                dialogEl.style.transition = "";
                dialogEl.style.transform = "";
                dialogEl.style.opacity = "";
                done();
              }, ANIMATION_DURATION);
            } else {
              done();
            }
          });
        },
        onLeave(el: Element, done: () => void) {
          const dialogEl = (el as HTMLElement).querySelector(".el-dialog") as HTMLElement | null;
          if (dialogEl) {
            if (buttonRef.value?.ref) {
              const buttonRect = (buttonRef.value.ref as HTMLElement).getBoundingClientRect();
              const dialogRect = dialogEl.getBoundingClientRect();

              const currentTransform = dialogEl.style.transform;
              let dragOffsetX = 0;
              let dragOffsetY = 0;

              // avoid draggable effect
              if (currentTransform) {
                const translateMatch = currentTransform.match(
                  /translate\(([^,]+),\s*([^)]+)\)/,
                );
                if (translateMatch && translateMatch[1] && translateMatch[2]) {
                  dragOffsetX = Number.parseFloat(translateMatch[1]);
                  dragOffsetY = Number.parseFloat(translateMatch[2]);
                }
              }

              const offsetX =
                buttonRect.left +
                buttonRect.width / 2 -
                (dialogRect.left + dialogRect.width / 2) +
                dragOffsetX;
              const offsetY =
                buttonRect.top +
                buttonRect.height / 2 -
                (dialogRect.top + dialogRect.height / 2) +
                dragOffsetY;

              dialogEl.style.transition = `all ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 1, 1)`;
              dialogEl.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(0.3)`;
              dialogEl.style.opacity = "0";

              // wait for animation to complete, then cleanup inline styles
              setTimeout(() => {
                dialogEl.style.transition = "";
                dialogEl.style.transform = "";
                dialogEl.style.opacity = "";
                done();
              }, ANIMATION_DURATION);
            } else {
              done();
            }
          } else {
            done();
          }
        },
      };
    } else {
      transition = "dialog-bounce";
    }
  }
  return {
    alignCenter: config.alignCenter,
    draggable: config.draggable,
    overflow: config.overflow,
    transition,
  };
});
</script>

<template>
  <!-- Element Plus全局配置组件 -->
  <el-config-provider :locale="zhCn" :dialog="globalConfig" :size="elementComponentSize">
    <!-- 路由视图容器 -->
    <router-view />
    <NotificationSystem ref="notificationSystemRef" />

    <!-- 埋点诊断悬浮按钮：可拖动，位置会记住（见 components/TelemetryFab.vue） -->
    <TelemetryFab
      v-if="showTelemetryFab"
      :error-count="telemetryErrorCount"
      @open="router.push('/debug/telemetry')"
    />
  </el-config-provider>
</template>
