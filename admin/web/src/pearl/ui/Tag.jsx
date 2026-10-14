// 语义标签。逐字搬自 scaffold-vue 的 ui/Tag.vue。
//
// 语义色只有四种；字典里的历史色值就近归档。
// 与 Vue 的差异：Vue 用 computed 缓存 toneClass，React 每次渲染直接算 —— 一张常量表加一次
// 查表，成本可以忽略，不需要 useMemo（反而多一层依赖数组要维护）。
import { cls } from '../cls.js';

const TONE_MAP = {
  ok: 'ok',
  success: 'ok',
  primary: 'info',
  info: 'info',
  purple: 'info',
  danger: 'danger',
  error: 'danger',
  warn: 'danger',
  warning: 'danger',
  neutral: 'neutral',
  default: 'neutral',
};

export default function Tag({ tone, dot = false, children }) {
  // `tone-*` 不是重名类，cls() 只做透传；走 cls 是为了统一拼装口径
  const toneClass = `tone-${TONE_MAP[tone ?? 'neutral'] ?? 'neutral'}`;

  return (
    <span className={cls('tag', toneClass)}>
      {dot ? <span className="tag-dot" /> : null}
      {children}
    </span>
  );
}
