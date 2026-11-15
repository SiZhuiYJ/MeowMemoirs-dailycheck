import type { ComponentPublicInstance } from 'vue';

// Define the shape of the notification options based on the component's interface
export interface NotificationOptions {
  content: string;
  color?: string;
  duration?: number;
  closable?: boolean;
  direction?: 'ltr' | 'rtl' | 'ttb' | 'btt' | 'center' | 'rtl' | 'ripple' | 'spotlight' | 'fade';
}

// Define the shape of the component instance method we need
export interface NotificationInstance {
  addMessage: (options: NotificationOptions) => void;
}

let notificationInstance: NotificationInstance | null = null;

/**
 * Register the global notification component instance.
 * This should be called once in the root App component.
 */
export const setNotificationInstance = (instance: NotificationInstance | null) => {
  notificationInstance = instance;
};

/**
 * Show a notification message.
 */
export const notify = (options: NotificationOptions) => {
  if (notificationInstance) {
    notificationInstance.addMessage(options);
  } else {
    console.warn('NotificationSystem instance is not registered. Make sure to add <NotificationSystem /> in App.vue');
  }
};

/**
 * Helper for success messages
 */
export const notifySuccess = (content: string, duration?: number) => {
  notify({
    content,
    color: '#22c55e', // 语义成功色，与 --color-success 一致
    direction: 'rtl',
    duration,
  });
};

/**
 * Helper for error messages
 */
export const notifyError = (content: string, duration?: number) => {
  notify({
    content,
    color: '#ef4444', // 语义错误色，与 --color-danger 一致
    direction: 'rtl', // Default to rtl or another style
    duration,
  });
};

/**
 * Helper for warning messages
 */
export const notifyWarning = (content: string, duration?: number) => {
  notify({
    content,
    color: '#eab308', // 语义警告色，与 --color-warning 一致
    direction: 'rtl',
    duration,
  });
};

/**
 * Helper for info messages
 */
export const notifyInfo = (content: string, duration?: number) => {
  notify({
    content,
    color: '#6b7280', // 语义信息色，与 --color-info 一致
    direction: 'rtl',
    duration,
  });
};
