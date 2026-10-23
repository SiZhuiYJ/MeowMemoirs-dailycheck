import type { ComponentPublicInstance } from "vue";
import { telemetry } from "@/libs/telemetry";

// Define the shape of the notification options based on the component's interface
// We duplicate this interface to avoid hard dependency on the component file for types,
// but keep it compatible.
export interface NotificationOptions {
  content: string;
  color?: string;
  duration?: number;
  closable?: boolean;
  direction?:
    | "ltr"
    | "rtl"
    | "ttb"
    | "btt"
    | "center"
    | "rtl"
    | "ripple"
    | "spotlight"
    | "fade";
}

// Define the shape of the component instance method we need
interface NotificationInstance extends ComponentPublicInstance {
  addMessage: (options: NotificationOptions) => void;
}

let notificationInstance: NotificationInstance | null = null;

/**
 * Register the global notification component instance.
 * This should be called once in the root App component.
 */
export const setNotificationInstance = (
  instance: NotificationInstance | null,
) => {
  notificationInstance = instance;
};

/**
 * Show a notification message.
 */
export const notify = (options: NotificationOptions) => {
  // 记录「用户实际看到的提示」：排查时经常需要知道报错是以什么文案弹出来的
  telemetry.track(
    "ui",
    "toast",
    { content: options.content, color: options.color },
    options.color === "#ef4444" ? "error" : "info",
  );

  if (notificationInstance) {
    notificationInstance.addMessage(options);
  } else {
    console.warn(
      "NotificationSystem instance is not registered. Make sure to add <NotificationSystem /> in App.vue",
    );
  }
};

/**
 * Helper for success messages
 */
export const notifySuccess = (content: string, duration?: number) => {
  notify({
    content,
    color: "#10b981", // Emerald 500
    direction: "rtl",
    duration,
  });
};

/**
 * Helper for error messages
 */
export const notifyError = (content: string, duration?: number) => {
  notify({
    content,
    color: "#ef4444", // Red 500
    direction: "rtl", // Default to rtl or another style
    duration,
  });
};

/**
 * Helper for warning messages
 */
export const notifyWarning = (content: string, duration?: number) => {
  notify({
    content,
    color: "#f59e0b", // Amber 500
    direction: "rtl",
    duration,
  });
};

/**
 * Helper for info messages
 */
export const notifyInfo = (content: string, duration?: number) => {
  notify({
    content,
    // 全局主题强调色（浅色主题下的 strong），不再使用蓝色
    color: "#9a4f8d",
    direction: "rtl",
    duration,
  });
};
