/**
 * 本机设备标识（web）。
 *
 * 首次访问时生成一个随机 ID 并持久化到 localStorage，之后随每个请求以
 * `X-Device-Id` 头上报，供后端把同一台设备的多次登录归并到一条登录设备记录。
 *
 * 注意：ID 是「本机持久化」的 —— 清缓存 / 换浏览器 / 换设备都会得到新 ID，
 * 后端会把它当成一台新设备，这是预期行为。
 */

/** localStorage 键名（与后端 device_key 的清洗规则兼容：UUID 含 `-` 是允许字符）。 */
const DEVICE_ID_STORAGE_KEY = "MM-device-id";

/**
 * 内存缓存：localStorage 不可用（无痕模式、被禁用等）时，
 * 保证同一页面生命周期内返回同一个 ID，而不是每次调用都重新生成。
 */
let cachedDeviceId: string | null = null;

/** 生成设备 ID：优先 crypto.randomUUID，兜底「时间戳 36 进制-随机串」。 */
function createDeviceId(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // crypto 在旧内核 / 非安全上下文（http 非 localhost）下可能不可用，走兜底
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 获取本机设备 ID：已持久化则直接复用，否则生成并写入 localStorage。
 * 所有 localStorage 读写都包在 try/catch 里：存储失败不影响正常请求。
 */
export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const stored = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
  } catch {
    // localStorage 读取失败：继续生成临时 ID
  }

  const deviceId = createDeviceId();
  cachedDeviceId = deviceId;
  try {
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  } catch {
    // 写不进去就只用内存缓存，本次会话内保持稳定
  }
  return deviceId;
}
