// 逐位滚动读数（结 Crystallize）：每一位是一条 0–9 的竖带，只有变化的位会滚。
// 位次按「从右往左」编号作为 key，位数变化时个位、十位不会错位重排。
// 逐字搬自 scaffold-vue 的 ui/Odometer.vue。
//
// 与 Vue 的差异：Vue 用 onMounted + ref(false)，React 用 useState + useEffect。
// 副作用清理必须做 —— StrictMode 下 effect 会跑两次，不清定时器会留下悬空回调。
// 后台标签页里 rAF 不触发，用 setTimeout 兜底：这条 Vue 就踩过，照抄保留。
import { useEffect, useState } from 'react';
import { cls } from '../cls.js';

export default function Odometer({ value, decimals = 0, group = true }) {
  // 首帧显示 0，挂载后翻到目标位（CSS 里的 transform 过渡负责滚动）
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (document.hidden) {
      setMounted(true);
      return undefined;
    }
    const raf = requestAnimationFrame(() => setMounted(true));
    const timer = window.setTimeout(() => setMounted(true), 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);

  const text =
    value === null || value === undefined || Number.isNaN(value)
      ? '—'
      : Number(value).toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: group,
        });

  const list = [...text];
  const dotIndex = list.indexOf('.');

  return (
    <span className={cls('odometer', 'tnum')} aria-label={text} role="img">
      {list.map((ch, i) => {
        const digit = /\d/.test(ch) ? Number(ch) : null;
        // key 用「从右往左的位次」，位数变化时个位仍是 1，不会整体重排
        const key = list.length - i;
        const fraction = dotIndex !== -1 && i > dotIndex;

        return (
          <span
            key={key}
            className={cls('odo-cell', fraction && 'is-fraction', digit === null && 'is-sep')}
            aria-hidden="true"
          >
            {digit !== null ? (
              <span
                className="odo-strip"
                style={{
                  transform: `translateY(${-(mounted ? digit : 0) * 10}%)`,
                  // 相邻位错开 40ms，来回最多 6 档，避免长数字拖出长尾
                  transitionDelay: `${(key % 6) * 40}ms`,
                }}
              >
                {Array.from({ length: 10 }, (_, n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            ) : (
              ch
            )}
          </span>
        );
      })}
    </span>
  );
}
