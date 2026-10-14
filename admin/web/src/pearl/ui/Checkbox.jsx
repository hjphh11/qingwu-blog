// 勾选框。逐字搬自 scaffold-vue 的 ui/Checkbox.vue。
//
// 与 Vue 的差异（三处，都不影响 DOM 结构与语义）：
//   1. `modelValue` → `checked`，`onChange` 收到 boolean。Vue 用 @click.stop 阻止冒泡，
//      React 的合成事件同理用 stopPropagation —— 表格行点击选中时靠它避免连带触发。
//   2. Vue 在 `watch(modelValue)` 里调 settlePop()（GSAP 结 Crystallize）。
//      本项目不引 GSAP，改成用 `popSeq` 递增的 key 重挂载勾选标记：勾上新一次时
//      标记重新挂载，CSS 里已有的入场过渡会接手。key 变化对 DOM 结构无影响。
//   3. scaffold 有 `check` 图标，icons.js 里没有，所以勾选标记用内联 SVG（形状照抄）。
import { useEffect, useRef, useState } from 'react';
import { cls } from '../cls.js';

export default function Checkbox({
  checked = false,
  indeterminate = false,
  disabled = false,
  label,
  onChange,
  onClick,
  children,
}) {
  // 每次由「未勾」变「已勾」自增一次，作为勾选标记的 key，触发一次入场动画
  const [popSeq, setPopSeq] = useState(0);
  const prevChecked = useRef(checked);

  useEffect(() => {
    if (checked && !prevChecked.current) setPopSeq((n) => n + 1);
    prevChecked.current = checked;
  }, [checked]);

  // 半选只在未勾选时成立（照抄 Vue 的 `indeterminate && !modelValue`）
  const partial = indeterminate && !checked;

  return (
    <label
      className={cls(
        'checkbox',
        checked && 'is-on',
        partial && 'is-partial',
        disabled && 'is-disabled',
      )}
      // 表格里整行可点时，勾选框自身不能把点击冒泡出去
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-checked={partial ? 'mixed' : checked}
        aria-label={label ? undefined : '选择'}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="checkbox-box">
        <span key={popSeq} style={{ display: 'inline-flex' }}>
          {checked ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : indeterminate ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 5h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : null}
        </span>
      </span>
      {label ? <span>{label}</span> : null}
      {/* Vue 的默认插槽（页面会塞说明文字/链接） */}
      {children}
    </label>
  );
}
