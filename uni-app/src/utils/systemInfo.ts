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

/**
 * 模块级缓存：小程序里每个页面都会 new 一个 MmNavBar，如果每个实例都调一次
 * wx.getWindowInfo / getMenuButtonBoundingClientRect，会重复注册窗口信息监听
 * （真机上表现为 "N listeners of event WindowInfoChanged have been added"）。
 * 这里只取一次并复用；窗口尺寸/胶囊位置在会话内基本不变，如需刷新可调
 * resetSystemInfoCache()。
 */
let cachedSystemInfo: any = null;
let cachedWindowInfo: WindowInfoLite | null = null;
let cachedMenuRect: MenuButtonRect | null | undefined = undefined;

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
  if (cachedSystemInfo) return cachedSystemInfo;
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
        cachedSystemInfo = merged;
        return merged;
      }
    }
  } catch (e) {
    // 新 API 不可用 / 调用失败：走下面的旧 API 回退
  }
  // #endif
  cachedSystemInfo = uni.getSystemInfoSync();
  return cachedSystemInfo;
}

/** 只需要窗口尺寸的轻量封装（导航栏、状态栏适配用）。 */
export function getWindowInfoCompat(): WindowInfoLite {
  if (cachedWindowInfo) return cachedWindowInfo;
  const info = getSystemInfoCompat();
  cachedWindowInfo = {
    statusBarHeight: info?.statusBarHeight || 0,
    windowWidth: info?.windowWidth || 0,
    windowHeight: info?.windowHeight || 0,
    pixelRatio: info?.pixelRatio || 1,
  };
  return cachedWindowInfo;
}

/** 清空缓存（窗口尺寸真的变化时调用，例如横竖屏切换/分屏）。 */
export function resetSystemInfoCache(): void {
  cachedSystemInfo = null;
  cachedWindowInfo = null;
  cachedMenuRect = undefined;
}

/** 微信右上角胶囊位置；H5 / App 端返回 null（无需避让）。 */
export function getMenuButtonRectCompat(): MenuButtonRect | null {
  if (cachedMenuRect !== undefined) return cachedMenuRect;
  try {
    const api = (uni as any).getMenuButtonBoundingClientRect;
    if (typeof api === 'function') {
      cachedMenuRect = api.call(uni) as MenuButtonRect;
      return cachedMenuRect;
    }
  } catch (e) {
    // 非小程序环境或页面栈未就绪
  }
  cachedMenuRect = null;
  return null;
}

/**
 * 客户端平台标识（与后端 X-Client-Platform 白名单保持一致）。
 * 条件编译按当前构建目标取值，H5 / App / 小程序各端只保留自己的分支。
 */
export type ClientPlatform = 'mp-weixin' | 'h5' | 'app';

/**
 * 当前客户端平台，供 HTTP 层上报 X-Client-Platform（登录记录展示设备用）。
 * 默认按 H5 处理，小程序 / App 构建时由条件编译覆盖。
 */
export function getClientPlatform(): ClientPlatform {
  let platform: ClientPlatform = 'h5';
  // #ifdef MP-WEIXIN
  platform = 'mp-weixin';
  // #endif
  // #ifdef APP-PLUS
  platform = 'app';
  // #endif
  return platform;
}

/**
 * 当前客户端机型（仅小程序端能拿到，其余端返回空串）。
 * 供 HTTP 层上报 X-Client-Device；后端没收到时会用 User-Agent 兜底，
 * 因此这里取不到也不影响业务。
 */
export function getClientDeviceModel(): string {
  let model = '';
  // #ifdef MP-WEIXIN
  try {
    const info = getSystemInfoCompat();
    const rawModel = info?.model;
    const rawBrand = info?.brand;
    if (typeof rawModel === 'string' && rawModel.trim()) {
      model = rawModel.trim();
    } else if (typeof rawBrand === 'string' && rawBrand.trim()) {
      model = rawBrand.trim();
    }
  } catch (e) {
    // 系统信息不可用：按「没上报机型」处理
    model = '';
  }
  // #endif
  return model;
}
