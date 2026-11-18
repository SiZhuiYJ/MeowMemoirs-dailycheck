/**
 * 接口基址解析（开发环境自动选择后端）
 *
 * 背景：
 * · 小程序没有浏览器的同源代理，接口必须是绝对地址；
 * · 手机/电脑的局域网 IP 会随网络变化（比如 192.168.77.x 与 192.168.0.x 切换）；
 * · 生产构建又必须固定用正式域名。
 *
 * 方案：
 * · 生产 / H5：候选只有 1 个（域名或空串=同源代理），直接使用，不探测；
 * · 小程序开发：scripts/dev-env.mjs 在构建前扫描本机所有网卡，把候选写成
 *   `VITE_API_BASE_URL=http://ip1:5211,http://ip2:5211,http://127.0.0.1:5211`；
 *   启动时并行探测各候选的 /mm/Plans（返回 401/200 即视为可达），
 *   选中第一个可达地址并缓存，后续请求与图片/上传 URL 都用它。
 *
 * 这样换网段、换 Wi-Fi 都不需要改代码或配置。
 */
import { ref } from 'vue';
import { API_BASE_CANDIDATES } from '@/config';

const STORAGE_KEY = 'notebook_api_base';

/** 当前生效的接口基址（响应式：探测完成后页面里的图片/上传地址会自动更新） */
export const apiBase = ref<string>(API_BASE_CANDIDATES[0] ?? '');

/** 同步读取当前接口基址（事件回调 / 非模板代码用）。 */
export function getApiBase(): string {
  return apiBase.value;
}

/** 拼接后端文件地址（path 以 / 开头，如 /mm/Files/...）。 */
export function fileUrl(path: string): string {
  return getApiBase() + path;
}

/**
 * 给公开图片地址追加缩略图参数。
 *
 * 后端对头像 / 个人主页背景图支持 `?thumbnail=true`：返回预处理的缩略占位图
 * （背景图 128px、头像 96px；缩略图不存在时自动回退返回原图）。
 * 配合 MmLazyImage 做「占位图秒开 → 原图淡入」的渐进加载。
 */
export function thumbnailUrl(url: string): string {
  if (!url) return '';
  return url + (url.includes('?') ? '&' : '?') + 'thumbnail=true';
}

let resolving: Promise<string> | null = null;

/**
 * 按可达性选择接口基址。
 * - 候选只有 1 个时立即返回（生产 / H5）
 * - 开发环境并行探测，首次成功的候选胜出；全部失败则回退第一个候选
 */
export function resolveApiBase(): Promise<string> {
  if (API_BASE_CANDIDATES.length <= 1) {
    apiBase.value = API_BASE_CANDIDATES[0] ?? '';
    return Promise.resolve(apiBase.value);
  }
  if (!resolving) {
    resolving = probeCandidates().finally(() => {
      resolving = null;
    });
  }
  return resolving;
}

/** 并行探测：任何 HTTP 响应（含 401）都说明该地址可达且是后端。 */
function probeCandidates(): Promise<string> {
  const candidates = [...API_BASE_CANDIDATES];
  // 把上次成功的地址排到最前面，缩短下次启动的探测时间
  let cached = '';
  try {
    cached = uni.getStorageSync(STORAGE_KEY) || '';
  } catch (e) {
    cached = '';
  }
  if (cached && candidates.includes(cached)) {
    candidates.splice(candidates.indexOf(cached), 1);
    candidates.unshift(cached);
  }

  return new Promise<string>((resolve) => {
    let settled = false;
    let pending = candidates.length;

    const finish = (base: string) => {
      if (settled) return;
      settled = true;
      apiBase.value = base;
      try {
        uni.setStorageSync(STORAGE_KEY, base);
      } catch (e) {
        // 存储不可用时忽略，仅影响下次启动排序
      }
      resolve(base);
    };

    candidates.forEach((base) => {
      uni.request({
        url: `${base}/mm/Plans`,
        method: 'GET',
        // 不带 token，后端会返回 401——能收到响应就说明地址可达
        timeout: 2500,
        success: () => finish(base),
        fail: () => {
          pending -= 1;
          if (pending === 0) finish(candidates[0]!);
        },
      });
    });

    // 双保险：极端情况下所有请求都没有回调
    setTimeout(() => {
      if (!settled) finish(candidates[0]!);
    }, 3000);
  });
}
