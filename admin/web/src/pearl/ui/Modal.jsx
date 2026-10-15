// 模态框（端口自 scaffold 的 ui/Modal.vue）。
//
// 差异说明（没有 GSAP / 没有它的 focus 组合式函数之后怎么办）：
//   1. 进出场动画省略（Vue 用 overlayEnter/overlayLeave 补间），终态一致；
//   2. 焦点管理自己实现：打开时把焦点移进面板，Tab 在面板内循环，Escape 关闭，
//      关闭后把焦点还给触发元素（scaffold 的 createFocusTrap 做的就是这些）。
//      关键约束：这套「只在开合时跑一次」——onClose 必须经 ref 取用，不能放进依赖数组，
//      否则每次键入引起的 re-render 都会重跑一遍聚焦，输入框会被抢回第一个（见下面的注释）。
import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import { X } from '../../icons.js';
import { cls } from '../cls.js';
import IconButton from './IconButton.jsx';

const FOCUSABLE = 'a[href], button:not(:disabled), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function Modal({
  open,
  onClose,
  title,
  sub,
  width = 560,
  /** 点遮罩是否关闭（表单弹窗默认不关，避免误触丢输入） */
  closeOnOverlay = false,
  footer,
  children,
}) {
  const panelRef = useRef(null);
  const titleId = useId();

  // 焦点锁只认「开着还是关了」，所以回调与焦点落点都放 ref 里：
  // onClose 是页面的内联箭头函数（每次渲染都是新引用），若直接进依赖数组，
  // 下面那个「聚焦第一个可聚焦元素」的 effect 会在**每次 re-render 时重跑** ——
  // 表现就是「在弹窗第 2 个输入框里打字，打一个字焦点就被抢回第 1 个」
  // （比 pearl/PORTING.md 里那条"组件写在组件里"的坑更隐蔽，两边都别再踩）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const previousRef = useRef(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    previousRef.current = document.activeElement;
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const onKey = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      // 简单焦点环：Tab / Shift+Tab 在面板内部循环
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    // 只依赖 ref（永不变化）：回调换引用不再重装焦点环
    [],
  );

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener('keydown', onKey);
    // 下一帧再聚焦：等 portal 真正挂上
    const id = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector(FOCUSABLE);
      (first ?? panel).focus?.();
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('keydown', onKey);
      // 关闭后焦点还给触发元素
      const previous = previousRef.current;
      if (previous instanceof HTMLElement) previous.focus?.();
    };
  }, [open, onKey]);

  if (!open) return null;

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        style={{ maxWidth: `${width}px` }}
      >
        <header className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {sub ? <p className="modal-sub">{sub}</p> : null}
          </div>
          <IconButton icon={X} label="关闭" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
