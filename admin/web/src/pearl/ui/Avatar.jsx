// 头像缩写块（对应 scaffold 的 ui/Avatar.vue）。
//
// 差异说明（两处，都是必要修正）：
//   1. scaffold 的配色取自它的 `data/index.ts` 里的 AVATAR_TINTS（与本项目无关的一组色），
//      这里改用珍珠玻璃的分类色令牌 `--cat-N-bg`，既保持"同一个名字永远同一个底色"，
//      又不引入外部数据表。
//   2. scaffold 的 `.avatar { color: #fff }` 在白字压在浅色底上只有 1.3:1（实测），
//      远达不到项目要求的 4.5:1；这里同时给出配对的 `--cat-N-ink` 作字色。
import { cls } from '../cls.js';

const AVATAR_TINTS = [
  ['var(--cat-1-bg)', 'var(--cat-1-ink)'],
  ['var(--cat-2-bg)', 'var(--cat-2-ink)'],
  ['var(--cat-3-bg)', 'var(--cat-3-ink)'],
  ['var(--cat-4-bg)', 'var(--cat-4-ink)'],
  ['var(--cat-5-bg)', 'var(--cat-5-ink)'],
];

export default function Avatar({ name = '', size = 32, className, style }) {
  const text = (name || '?').trim();
  // 中文名取后两字，英文名取首字母
  const label = /^[\x00-\x7f]+$/.test(text) ? text.charAt(0).toUpperCase() : text.slice(-2);
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [tint, ink] = AVATAR_TINTS[hash % AVATAR_TINTS.length];

  return (
    <span
      className={cls('avatar', className)}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size * 0.36)}px`,
        background: tint,
        color: ink,
        ...style,
      }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}
