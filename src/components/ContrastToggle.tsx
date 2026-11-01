/**
 * 高对比阅读开关（v6 §7.2：用户已确认要，默认关，放导航右侧）。
 *
 * 为什么需要：站点的正文对比度本来就达标（crimson #c23a55、muted 都在 AA 以上），
 * 但「**次要文字 + 半透明玻璃卡**」是最先撑不住的一档 —— 玻璃会透出背后的极光，
 * 浅色区域叠浅色文字时余量很小。视力不好或在强光下看的人需要一档更硬的版本。
 *
 * 实现只做两件事，都靠 `html.q-contrast` 一个类：
 *   1. 把 `--color-muted` / `--color-subtle` 提到接近纯色；
 *   2. 把玻璃卡底色加实（不再让背景透上来）。
 * 不碰字号、不碰布局 —— 开关只该改变对比，不该改变版式。
 *
 * 首帧必须与 SSR 一致：class 由 Layout 的 is:inline 脚本在读 localStorage 后**先**加上，
 * 这里只读取既成事实（不在这里写 class），所以不会闪一下低对比再变。
 */

import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Contrast } from '../lib/icons';

const KEY = 'qingwu:contrast';

export default function ContrastToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    // 只读不写：真正的初始状态由 Layout 的首帧前脚本决定
    setOn(document.documentElement.classList.contains('q-contrast'));
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    document.documentElement.classList.toggle('q-contrast', next);
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* 隐私模式下记不住，本次会话仍然生效 */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? '关闭高对比阅读' : '开启高对比阅读'}
      title={on ? '关闭高对比阅读' : '开启高对比阅读'}
      className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors active:scale-95 ${
        on ? 'bg-rose/30 text-crimson' : 'text-muted hover:bg-rose/15 hover:text-crimson'
      }`}
    >
      <MorphIcon icon={Contrast} size={18} color="currentColor" />
    </button>
  );
}
