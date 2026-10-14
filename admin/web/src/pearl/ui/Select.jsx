// 下拉选择（Select）：端口自 scaffold 的 ui/Select.vue。
//
// 触发器 + 弹出列表 + 过滤 + 键盘操作全部照抄，DOM 层级与类名逐字一致。
// 与本后台环境有关的四处差异（只在这里说明，代码里不再重复）：
//   1. GSAP 的 overlayEnter/overlayLeave 不可用 → 省略浮层进出场动画。
//      .select-menu 自身没有 CSS 过渡，动画只发生在浮层出现那一帧，终态完全一致。
//   2. floatingLayerFor(trigger) 不可用 → 不写内联 z-index，沿用 CSS 里 .select-menu 的
//      z-index: 120（与 .menu-pop 同一层级）。浮层挂到 document.body 末尾，
//      同级时靠文档顺序压住页面内的浮层。
//   3. Teleport → createPortal(…, document.body)，语义相同（都在 body 上、都逃出
//      .p-content 的 overflow 裁剪）。
//   4. options[].icon：scaffold 传字符串图标名（Icon.vue 查表），本后台图标是 lucide 的
//      IconNode 数据，所以这里收图标节点（或已经建好的元素），字符串会被忽略。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import { ChevronDown, Search, X } from '../../icons.js';
import { cls } from '../cls.js';

/**
 * options[].icon 的渲染：数组（lucide IconNode）交给 MorphIcon；
 * 已经是 React 元素（有 $$typeof）就原样渲染。
 */
function OptionIcon({ node, size, style }) {
  if (!node) return null;
  if (typeof node === 'string') return null; // scaffold 的字符串图标名在本后台没有对应表
  if (node.$$typeof) return node;
  return <MorphIcon icon={node} size={size} color="currentColor" style={style} />;
}

/** icons.js 里没有 Check，勾选标记按 scaffold Icon.vue 的 check 路径内联（stroke 用默认 1.6） */
function CheckMark({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export default function Select({
  value,
  onChange,
  options = [],
  placeholder = '请选择',
  filterable = false,
  clearable = false,
  disabled = false,
  invalid = false,
  emptyText = '无匹配项',
  className,
  style,
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  // hide() 在事件监听里被调用，读 state 会拿到旧闭包值，所以用 ref 记开关
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  // 与 Vue 一样在挂载时定死一个 id（aria-controls 用），不用 useId 是为了保持 sel-xxx 的形状
  const [listId] = useState(() => `sel-${Math.random().toString(36).slice(2, 8)}`);

  // 裸字符串 / 数字选项补成 {label, value}
  const normalized = useMemo(
    () => options.map((o) => (typeof o === 'object' && o !== null ? o : { label: String(o), value: o })),
    [options],
  );
  const current = useMemo(() => normalized.find((o) => o.value === value), [normalized, value]);

  const filter = useCallback(
    (kw) => {
      const key = kw.trim().toLowerCase();
      return key ? normalized.filter((o) => String(o.label).toLowerCase().includes(key)) : normalized;
    },
    [normalized],
  );
  const visible = useMemo(() => filter(keyword), [filter, keyword]);

  // 菜单摆位：翻上/翻下与宽度计算与 Vue 的 place() 一字不差
  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = menuRef.current?.offsetHeight ?? 260;
    const below = window.innerHeight - rect.bottom;
    const top = below < menuHeight + 12 && rect.top > menuHeight + 12 ? rect.top - menuHeight - 6 : rect.bottom + 6;
    const width = Math.max(rect.width, 160);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    setPos({ top, left, width });
  }, []);

  const hide = useCallback((refocus = false) => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const onOutside = useCallback(
    (event) => {
      const target = event.target;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      hide();
    },
    [hide],
  );

  function show() {
    if (disabled || openRef.current) return;
    openRef.current = true;
    setKeyword('');
    setOpen(true);
    // 此时菜单还没挂载，先按默认高度 260 摆一次，等 DOM 出来再摆一次（对应 Vue 的 nextTick 后再 place()）
    setActiveIndex(Math.max(0, normalized.findIndex((o) => o.value === value)));
    place();
  }

  function pick(option) {
    if (option.disabled) return;
    onChange?.(option.value);
    hide(true);
  }

  function move(step) {
    const list = visible;
    if (!list.length) return;
    setActiveIndex((prev) => {
      let index = prev;
      for (let i = 0; i < list.length; i += 1) {
        index = (index + step + list.length) % list.length;
        if (!list[index].disabled) break;
      }
      return index;
    });
  }

  function onKey(event) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = visible[activeIndex];
      if (option) pick(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hide(true);
    } else if (event.key === 'Tab') hide(true);
  }

  // 过滤词变化后把高亮挪回第一项（对应 Vue 里 watch(keyword)）
  function onKeyword(event) {
    const next = event.target.value;
    setKeyword(next);
    setActiveIndex(filter(next).length ? 0 : -1);
  }

  // 打开后：拿到真实菜单高度再摆一次、聚焦搜索框
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    if (filterable) searchRef.current?.focus();
    return undefined;
  }, [open, place, filterable]);

  // 高亮项滚进可视区：Vue 是 nextTick 后 querySelector + scrollIntoView，这里用 layout effect 等价
  useLayoutEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector('.select-option.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, keyword]);

  // outside-click / 滚动 / 缩放：只在打开期间挂，关闭即由清理函数摘掉（Vue 是 hide() 里手动摘）
  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, onOutside, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cls(
          'input-shell',
          'select-trigger',
          invalid && 'is-invalid',
          disabled && 'is-disabled',
          className,
        )}
        style={style}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onKey}
      >
        <OptionIcon node={current?.icon} size={15} />
        <span className={cls('select-value', !current && 'is-placeholder')}>
          {current ? current.label : placeholder}
        </span>
        {clearable && current && !disabled ? (
          <span
            className={cls('input-clear')}
            role="button"
            aria-label="清空"
            onClick={(event) => {
              // 清空按钮在触发器内部，不阻止冒泡会顺手把菜单打开
              event.stopPropagation();
              onChange?.(typeof value === 'number' ? null : '');
            }}
          >
            <MorphIcon icon={X} size={14} color="currentColor" />
          </span>
        ) : (
          <MorphIcon icon={ChevronDown} size={15} color="currentColor" className={cls('select-caret')} />
        )}
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={cls('select-menu', 'm-float')}
              style={{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }}
              onKeyDown={onKey}
            >
              {filterable ? (
                <div className={cls('select-search')}>
                  <span className={cls('input-shell')}>
                    <MorphIcon icon={Search} size={14} color="currentColor" />
                    <input
                      ref={searchRef}
                      value={keyword}
                      onChange={onKeyword}
                      placeholder="搜索"
                      aria-label="搜索选项"
                    />
                  </span>
                </div>
              ) : null}
              <div id={listId} className={cls('select-options')} role="listbox">
                {visible.map((o, i) => (
                  <div
                    key={String(o.value)}
                    role="option"
                    aria-selected={o.value === value}
                    aria-disabled={o.disabled || undefined}
                    className={cls(
                      'select-option',
                      i === activeIndex && 'is-active',
                      o.value === value && 'is-selected',
                      o.disabled && 'is-disabled',
                    )}
                    style={o.depth ? { paddingLeft: `${10 + o.depth * 16}px` } : undefined}
                    onPointerEnter={() => setActiveIndex(i)}
                    onClick={() => pick(o)}
                  >
                    {o.icon ? <OptionIcon node={o.icon} size={15} style={{ color: 'var(--ink-soft)' }} /> : null}
                    <span className={cls('opt-label')}>{o.label}</span>
                    {o.hint ? (
                      <span className={cls('faint')} style={{ fontSize: '11px' }}>
                        {o.hint}
                      </span>
                    ) : null}
                    {o.value === value ? <CheckMark /> : null}
                  </div>
                ))}
                {!visible.length ? <div className={cls('select-empty')}>{emptyText}</div> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
