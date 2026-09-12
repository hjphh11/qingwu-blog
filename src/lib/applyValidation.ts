// 友链申请的字段定义与校验 —— **前后端共用同一套规则**。
// 前端(LinkApply.tsx)用它做即时校验，服务端(/api/links/apply)用它做最终校验。
// 只写一份的目的：避免出现「前端放过去了、后端拒了」这种不一致。

export type ApplyFieldKey = 'name' | 'url' | 'avatar' | 'intro' | 'email';

export type ApplyValues = Record<ApplyFieldKey, string>;

export type ApplyErrors = Partial<Record<ApplyFieldKey, string>>;

export const APPLY_FIELD_KEYS: ApplyFieldKey[] = ['name', 'url', 'avatar', 'intro', 'email'];

export const APPLY_EMPTY: ApplyValues = {
  name: '',
  url: '',
  avatar: '',
  intro: '',
  email: '',
};

/** 长度上限：前端用 maxLength 拦，服务端也要拦(防直接打接口) */
export const APPLY_LIMITS = {
  name: 30,
  intro: 60,
  url: 300,
  avatar: 300,
  email: 254, // RFC 5321
} as const;

const URL_RE = /^https?:\/\/[^\s/]+\.[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 补全协议头：访客填 example.com 也能用 */
export function normalizeUrl(raw: string): string {
  const t = (raw || '').trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** 把任意输入收敛成干净的字段值(trim 掉首尾空白) */
export function normalizeValues(input: Partial<ApplyValues>): ApplyValues {
  return {
    name: (input.name || '').trim(),
    url: normalizeUrl(input.url || ''),
    avatar: normalizeUrl(input.avatar || ''),
    intro: (input.intro || '').trim(),
    email: (input.email || '').trim(),
  };
}

export function validateApply(v: ApplyValues): ApplyErrors {
  const e: ApplyErrors = {};

  if (!v.name) e.name = '请填写站点名称';
  else if (v.name.length > APPLY_LIMITS.name)
    e.name = `站点名称请控制在 ${APPLY_LIMITS.name} 字以内`;

  if (!v.url) e.url = '请填写站点网址';
  else if (v.url.length > APPLY_LIMITS.url) e.url = '网址太长了';
  else if (!URL_RE.test(v.url)) e.url = '网址看起来不太对，例如 https://example.com';

  if (!v.avatar) e.avatar = '请填写头像链接';
  else if (v.avatar.length > APPLY_LIMITS.avatar) e.avatar = '头像链接太长了';
  else if (!URL_RE.test(v.avatar)) e.avatar = '头像链接看起来不太对，需要是一个图片直链';

  if (!v.intro) e.intro = '请写一句介绍';
  else if (v.intro.length > APPLY_LIMITS.intro)
    e.intro = `介绍请控制在 ${APPLY_LIMITS.intro} 字以内`;

  if (!v.email) e.email = '请填写联系邮箱';
  else if (v.email.length > APPLY_LIMITS.email) e.email = '邮箱太长了';
  else if (!EMAIL_RE.test(v.email)) e.email = '邮箱格式看起来不太对';

  return e;
}

/** 给前端做「已填/未填」判断用 */
export function isApplyValuesComplete(v: ApplyValues): boolean {
  return APPLY_FIELD_KEYS.every((k) => Boolean(v[k]));
}
