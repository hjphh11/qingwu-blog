import { useEffect, useRef } from 'react';

/**
 * 弹层的焦点契约：开的时候把焦点挪进盒子，关的时候还给原来那个元素。
 *
 * 约定（三个弹层共用：举报、成员名单、以后的别的）：
 *   · Esc 关闭（preventDefault：别让 Esc 顺带退出全屏之类）
 *   · Tab / Shift+Tab 在盒子内循环，不会跑到背后的页面上
 *   · 关闭时焦点回到打开它的按钮上，键盘用户不会「掉到 body」
 *
 * 用法：`const boxRef = useDialogFocus(open, onClose)`，把 `boxRef` 挂到弹层的根节点。
 * 根节点里必须至少有一个可聚焦元素 —— 否则开的时候焦点没地方去。
 */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const boxRef = useRef<T | null>(null);
  const backRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    backRef.current = document.activeElement as HTMLElement | null;

    const SEL =
      'button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';
    const box = boxRef.current;
    box?.querySelector<HTMLElement>(SEL)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(SEL)).filter(
        (el) => el.offsetParent !== null,
      );
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      backRef.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  return boxRef;
}
