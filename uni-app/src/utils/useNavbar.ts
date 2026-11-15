import { ref } from 'vue';
import { getSystemInfoCompat } from '@/utils/systemInfo';

export function useNavbar() {
  const paddingTop = ref(0);
  const height = ref(0);
  const paddingLeft = ref(0); // For right alignment to avoid overlapping with capsule
  const navbarHeight = ref(0); // Total height including capsule and bottom margin

  // Initialize
  // 优先新 API（getWindowInfo 等），避免 wx.getSystemInfoSync 弃用警告
  const sysInfo = getSystemInfoCompat();
  const statusBarHeight = sysInfo.statusBarHeight || 0;
  
  // Default values
  paddingTop.value = statusBarHeight + 4; 
  height.value = 32; // Standard capsule height
  paddingLeft.value = 16;
  navbarHeight.value = paddingTop.value + height.value + 8;

  // #ifdef MP-WEIXIN
  try {
    const menuButton = uni.getMenuButtonBoundingClientRect();
    paddingTop.value = menuButton.top;
    height.value = menuButton.height;
    
    // Calculate right padding/margin to avoid overlap if we have long text
    // sysInfo.windowWidth - menuButton.right gives the right margin
    // We might want similar left margin for balance, or just enough to align
    paddingLeft.value = sysInfo.windowWidth - menuButton.right;
    navbarHeight.value = menuButton.bottom + 8;
  } catch (e) {
    console.error('getMenuButtonBoundingClientRect failed', e);
  }
  // #endif

  return {
    paddingTop,
    height,
    paddingLeft,
    navbarHeight
  };
}
