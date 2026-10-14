// 悬停名片 / 轻量提示（端口自 scaffold 的 ui/HoverCard.vue）。
//
// 用途：指针停留 300ms（或键盘聚焦）出现的只读预览卡 —— 本项目用它做
// 「悬停看文章摘要/字数/日期」这类提示，替代一屏塞不下的信息。
// 离开触发区后留 120ms 宽限，允许指针移进卡片里（卡片可放链接）。
//
// 差异：GSAP 的进出场省略；定位改用 fixed + rect 计算，与 Vue 版一致。
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cls } from '../cls.js';

export default function HoverCard({
  children,
  content,
  delay = 300,
  placement = 'bottom',
  width = 260,
}) {
  const triggerRef = useRef(null);
  const cardRef = useRef(null);
  const timerRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const id = useId();

  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect();
    if (!t) return;
    const h = cardRef.current?.offsetHeight ?? 120;
    const below = placement === 'bottom' ? t.bottom + h + 12 < window.innerHeight : t.top - h - 12 < 0;
    const left = Math.min(Math.max(t.left + t.width / 2 - width / 2, 12), window.innerWidth - width - 12);
    setPos({ left, top: below ? t.bottom + 8 : t.top - h - 8 });
  }, [placement, width]);

  const show = useCallback(
    (now = false) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(
        () => {
          setOpen(true);
          requestAnimationFrame(place);
        },
        now ? 0 : delay,
      );
    },
    [delay, place],
  );

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    // 留 120ms 宽限，指针可以从触发区移进卡片
    timerRef.current = setTimeout(() => setOpen(false), 120);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <>
      <span
        ref={triggerRef}
        className={cls('hovercard-trigger')}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => show()}
        onPointerLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              id={id}
              ref={cardRef}
              role="tooltip"
              className={cls('hovercard', 'm-float')}
              style={{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${width}px` }}
              onPointerEnter={() => show(true)}
              onPointerLeave={hide}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
