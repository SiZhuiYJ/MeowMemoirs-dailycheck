/**
 * 系统信息兼容封装
 *
 * 微信基础库 3.x 起 `wx.getSystemInfoSync` 被标记为 deprecated（仍能用，但控制台会刷
 * 一长串警告）。这里优先使用新 API：
 *   · wx.getWindowInfo()  → 窗口尺寸 / 状态栏高度 / 像素比 等
 *   · wx.getDeviceInfo()  → 机型 / 平台 等
 *   · wx.getAppBaseInfo() → 基础库 / 语言 等
 * 三者合并后与旧 getSystemInfoSync() 的常用字段保持同名，取不到时再回退旧 API，
 * 因此 H5 / App / 低版本基础库都不会出问题。
 */

declare const wx: any;

/** 旧 getSystemInfoSync() 里本项目实际会用到的窗口字段。 */
export interface WindowInfoLite {
  statusBarHeight: number;
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
}

/** 微信右上角胶囊按钮的位置（仅小程序端可用，其余端返回 null）。 */
export interface MenuButtonRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  height: number;
}

/**
 * 兼容版系统信息：优先「新 API 合并」，失败时回退 getSystemInfoSync()。
 * 返回值保持旧的字段命名（statusBarHeight / windowWidth / pixelRatio / safeAreaInsets …）。
 */
export function getSystemInfoCompat(): any {
  // #ifdef MP-WEIXIN
  try {
    if (typeof wx !== 'undefined' && wx) {
      const parts: any[] = [];
      if (typeof wx.getDeviceInfo === 'function') parts.push(wx.getDeviceInfo());
      if (typeof wx.getAppBaseInfo === 'function') parts.push(wx.getAppBaseInfo());
      if (typeof wx.getWindowInfo === 'function') parts.push(wx.getWindowInfo());
      if (parts.length > 0) {
        const merged: any = Object.assign({}, ...parts);
        // 新 API 的 safeArea 是 {left,right,top,bottom,width,height}，
        // 旧代码用的是 safeAreaInsets，这里补一份保持兼容。
        if (!merged.safeAreaInsets && merged.safeArea) {
          const safe = merged.safeArea;
          merged.safeAreaInsets = {
            top: safe.top || 0,
            left: safe.left || 0,
            right: (merged.screenWidth || merged.windowWidth || 0) - (safe.right || 0),
            bottom: (merged.screenHeight || merged.windowHeight || 0) - (safe.bottom || 0),
          };
        }
        return merged;
      }
    }
  } catch (e) {
    // 新 API 不可用 / 调用失败：走下面的旧 API 回退
  }
  // #endif
  return uni.getSystemInfoSync();
}

/** 只需要窗口尺寸的轻量封装（导航栏、状态栏适配用）。 */
export function getWindowInfoCompat(): WindowInfoLite {
  const info = getSystemInfoCompat();
  return {
    statusBarHeight: info?.statusBarHeight || 0,
    windowWidth: info?.windowWidth || 0,
    windowHeight: info?.windowHeight || 0,
    pixelRatio: info?.pixelRatio || 1,
  };
}

/** 微信右上角胶囊位置；H5 / App 端返回 null（无需避让）。 */
export function getMenuButtonRectCompat(): MenuButtonRect | null {
  try {
    const api = (uni as any).getMenuButtonBoundingClientRect;
    if (typeof api === 'function') {
      return api.call(uni) as MenuButtonRect;
    }
  } catch (e) {
    // 非小程序环境或页面栈未就绪
  }
  return null;
}
