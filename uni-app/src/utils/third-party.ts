/**
 * @file 第三方账号绑定的共享工具
 * @description 绑定状态接口 `/mm/Auth/bindings` 返回 `{ bindings: [{ provider, boundAt, isBound }] }`，
 * 这里统一做「取值 + 兜底 + 中文化」，避免个人主页和绑定页各自解析、状态显示不一致。
 */

import { toLocalDateOnlyStringFromDateTime } from '@/utils/date';

/** 单条第三方绑定信息（只保留展示需要的字段） */
export interface ThirdPartyBindingItem {
  /** 渠道编号，如 wechat */
  provider: string;
  /** 绑定时间（后端返回完整 ISO 时间戳；拿不到时为空串） */
  boundAt: string;
  /** 是否仍处于绑定状态，缺省视为已绑定 */
  isBound: boolean;
}

/** provider → 中文名（仅用于展示） */
export const THIRD_PARTY_PROVIDER_LABELS: Record<string, string> = {
  wechat: '微信',
  baidu: '百度',
  aiqiyi: '爱奇艺',
  baidutieba: '百度贴吧',
  bilibili: '哔哩哔哩',
  dingding: '钉钉',
  doubanwang: '豆瓣网站',
  elemo: '饿了么',
  facebook: 'Facebook',
  gongzhonghao: '公众号',
  google: '谷歌',
  huabanwang: '花瓣网',
  kuaishou: '快手',
  kugouyinle: '酷狗音乐',
  linkedin: 'LinkedIn',
  meituan: '美团',
  momo: '陌陌',
  qiyeweixin: '企业微信',
  QQyinle: 'QQ音乐',
  taobao: '淘宝',
  tengxunhuiyi: '腾讯会议',
  tengxunQQ: '腾讯QQ',
  tengxunshipin: '腾讯视频',
  tengxunweishi: '腾讯微视',
  twitter: '推特',
  wangyiyunyinle: '网易云音乐',
  xiaohongshu: '小红书',
  xinlang: '新浪微博',
  youtube: 'YouTube',
  zhifubao: '支付宝',
  zhihu: '知乎',
};

/** 取渠道中文名；未知渠道直接回退成 provider 本身 */
export function getThirdPartyProviderLabel(provider: string): string {
  return THIRD_PARTY_PROVIDER_LABELS[provider] || provider;
}

/**
 * 兼容三种返回形态：直接数组 / `{ bindings }` / `{ Bindings }`，
 * 并过滤掉 provider 缺失的非法项，保证页面拿到的永远是数组。
 */
export function normalizeThirdPartyBindings(raw: unknown): ThirdPartyBindingItem[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as any).bindings ?? (raw as any).Bindings)
      : null;

  if (!Array.isArray(source)) return [];

  return source
    .filter((item: any) => item && typeof item.provider === 'string' && item.provider)
    .map((item: any) => ({
      provider: item.provider,
      boundAt: item.boundAt ?? item.BoundAt ?? '',
      isBound: item.isBound ?? item.IsBound ?? true,
    }));
}

/** 已绑定的渠道列表（isBound 明确为 false 的视为未绑定） */
export function getBoundThirdPartyBindings(raw: unknown): ThirdPartyBindingItem[] {
  return normalizeThirdPartyBindings(raw).filter((item) => item.isBound !== false);
}

/** 已绑定渠道的中文名列表，例如 ['微信'] */
export function getBoundThirdPartyLabels(raw: unknown): string[] {
  return getBoundThirdPartyBindings(raw).map((item) => getThirdPartyProviderLabel(item.provider));
}

/** 把 boundAt 的完整时间戳格式化成「YYYY-MM-DD」，避免出现 NaN-NaN-NaN */
export function formatThirdPartyBoundAt(boundAt?: string | null): string {
  return toLocalDateOnlyStringFromDateTime(boundAt);
}
