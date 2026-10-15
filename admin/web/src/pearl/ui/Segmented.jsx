// 分段控件（端口自 scaffold 的 ui/Segmented.vue）。
//
// 结构与类名逐字一致；Vue 版用 GSAP 的 slideThumb 让高亮块滑过去，
// 这里改成「量位置 + CSS 过渡」（.seg-thumb 的过渡写在 styles/pearl-local.css）。
// ⚠️ 与侧栏胶囊同样的坑：不能用 offsetLeft 直接算，要相对胶囊自己的 offsetParent 用 rect 计算。
import { useEffect, useRef } from 'react';

export default function Segmented({ value, options = [], onChange, label }) {
  const rootRef = useRef(null);
  const thumbRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const thumb = thumbRef.current;
    if (!root || !thumb) return undefined;

    const sync = () => {
      const index = options.findIndex((o) => o.value === value);
      const btn = root.querySelectorAll('button')[index];
      if (!btn) {
        thumb.style.opacity = '0';
        return;
      }
      const host = thumb.offsetParent || root;
      const br = btn.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      thumb.style.opacity = '1';
      thumb.style.transform = `translateX(${br.left - hr.left + host.scrollLeft}px)`;
      thumb.style.width = `${br.width}px`;
    };

    sync();
    // 字体加载完成、容器拉伸都会改选项宽度 → 用 ResizeObserver 重新对位（Vue 版也是这么做的）
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    root.querySelectorAll('button').forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  }, [value, options]);

  function onKey(event) {
    const index = options.findIndex((o) => o.value === value);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || !options.length) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    onChange?.(next.value);
    const root = rootRef.current;
    const btn = root?.querySelectorAll('button')[(index + step + options.length) % options.length];
    btn?.focus();
  }

  return (
    <div ref={rootRef} className="segmented m-groove" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      <span ref={thumbRef} className="seg-thumb m-pill" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={o.value === value ? 'is-active' : undefined}
          onClick={() => onChange?.(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
