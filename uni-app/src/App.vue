<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { useAuthStore } from './stores/auth';
import { useThemeStore } from './stores/theme';

onLaunch(() => {
  console.log("App Launch");
  
  // Init Theme
  const themeStore = useThemeStore();
  themeStore.initTheme();

  // Check auth
  const auth = useAuthStore();
  if (!auth.isAuthenticated) {
    uni.reLaunch({ url: '/pages/auth/index' });
  } else {
    // Redirect to main page if already authenticated
    // Use reLaunch to clear history stack
    // We need to check if current page is not main page to avoid loop, 
    // but onLaunch happens only once.
    // Actually, pages.json sets 'pages/main/index' as first page, so it loads by default.
    // But if we are reloading or deep linking...
    // If we are on auth page, we should go to main.
    // If we are already on main, we stay.
    
    // Simplest: If authenticated, just let it be handled by pages.json order 
    // OR if we were redirected to auth, we go back.
    // But since pages/main/index is the entry page, onLaunch will trigger.
    // If auth failed, we redirect to auth.
    // If auth success, we are already on main (or whatever page was launched).
  }
});
onShow(() => {
  console.log("App Show");
  const themeStore = useThemeStore();
  themeStore.updateNavBarColor();
});
onHide(() => {
  console.log("App Hide");
});
</script>
<style>
/* 
  In WeChat Mini Program, :root selector is not supported for defining global variables that cascade to all components.
  We must use the 'page' selector.
  We keep :root for H5 compatibility.
*/
:root, page {
  /* New Theme Configuration */
  --theme-primary: #8EA88E;
  --theme-secondary: #B3C6AB;
  --theme-bg: #ECE7DA;
  --theme-surface: #F1F1EB;

  --bg-color: var(--theme-bg);
  --bg-elevated: var(--theme-surface);
  --border-color: #d9d9d9; /* Keeping neutral for now or maybe #B3C6AB? Let's stick to neutral */
  --text-color: #191919;
  --text-muted: #666666;
  --accent-color: var(--theme-primary);
  --accent-alt: var(--theme-secondary);
  --accent-on: #ffffff;
  --surface-soft: #f7f7f7;

  /* Uni UI Variables */
  --uni-card-border-radius: 30px;
  --uni-card-padding: 20px;
  --uni-card-margin-bottom: 10px;

  --uni-header-border-radius: 30px;
  --uni-header-padding: 16px 20px;
  --uni-header-margin-bottom: 10px;

  --uni-container-padding: 10px;
  --uni-button-margin-top: 0px;
}

.dark-mode, page.dark-mode {
  --bg-color: #111111;
  --bg-elevated: #191919;
  --border-color: #2c2c2c;
  --text-color: #dddddd;
  --text-muted: #7d7d7d;
  --accent-color: #8EA88E;
  --accent-alt: #B3C6AB;
  --accent-on: #ffffff;
  --surface-soft: #232323;
}

/* Light mode support can be added here using media queries or class toggle */

page {
  background-color: var(--bg-color);
  color: var(--text-color);
  font-size: 14px;
  height: 100%;
}

::-webkit-scrollbar {
  display: none;
  width: 0 !important;
  height: 0 !important;
  -webkit-appearance: none;
  background: transparent;
}

view, text, button, input {
  box-sizing: border-box;
}

/* 解决H5下uni-input选中问题 */
uni-input input {
  user-select: text;
  -webkit-user-select: text;
}
</style>
