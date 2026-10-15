// 文本输入。逐字搬自 scaffold-vue 的 ui/TextInput.vue。
//
// 与 Vue 的差异：
//   1. `modelValue` → `value`（React 约定），`onChange` 收到的是**值**而不是事件 ——
//      页面写起来和 Vue 的 update:modelValue 一样直。
//   2. Vue 里靠 `defineExpose({ focus })` 暴露聚焦；React 不用 ref 也能满足现在的用法，
//      所以没加 useImperativeHandle（没人依赖它，加了反而多一处需要维护的契约）。
//   3. `readonly` 不能整体透传：React 的 DOM 属性是 readOnly，且 readOnly 会与 value
//      同时出现时的受控告警纠缠，所以这里显式解构、显式赋 readOnly。
import { useEffect, useRef } from 'react';
import { MorphIcon } from 'morphicons/react';
import { cls } from '../cls.js';
import { X } from '../../icons.js';

export default function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  icon,
  invalid = false,
  disabled = false,
  readonly = false,
  clearable = false,
  multiline = false,
  rows = 3,
  maxlength,
  autocomplete,
  onEnter,
  // 本项目补充的三个口子（scaffold 的 Vue 版没有，性质同 Switch 的 ariaLabel）：
  // 文章编辑器的「标签」要自己处理按键（上下键选建议、退格删一个、逗号分隔）与焦点开合，
  // 「标题」在新建文章时要自动聚焦。都是可选透传，不传时行为与以前完全一致。
  onKeyDown,
  onFocus,
  onBlur,
  autoFocus = false,
  className,
  style,
}) {
  const el = useRef(null);

  // Vue 模板里 `:value="modelValue ?? ''"` —— null / undefined 一律显示空串
  const shown = value ?? '';

  function handleInput(event) {
    const raw = event.target.value;
    // number 类型空串回 null，别把 NaN 传出去（照抄 Vue 的 onInput）
    if (type === 'number') onChange?.(raw === '' ? null : Number(raw));
    else onChange?.(raw);
  }

  function clear() {
    onChange?.(type === 'number' ? null : '');
    el.current?.focus();
  }

  // 只有非空、非 disabled 才显示清空按钮；`''`（空串）与 null 都不算「有内容」
  const canClear = clearable && shown !== '' && shown !== null && shown !== undefined && !disabled;

  return (
    <span
      className={cls(
        'input-shell',
        invalid && 'is-invalid',
        disabled && 'is-disabled',
        multiline && 'is-multiline',
        className,
      )}
      style={style}
    >
      {icon ? <MorphIcon icon={icon} size={15} color="currentColor" reducedMotion="user" /> : null}
      {multiline ? (
        <textarea
          ref={el}
          value={shown}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readonly}
          rows={rows}
          maxLength={maxlength}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          onChange={handleInput}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      ) : (
        <input
          ref={el}
          type={type}
          value={shown}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readonly}
          maxLength={maxlength}
          autoComplete={autocomplete}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          onChange={handleInput}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={(event) => {
            // 页面自己的按键处理先跑（可以 preventDefault），再走 Vue 的 @keydown.enter
            onKeyDown?.(event);
            if (event.key === 'Enter') onEnter?.();
          }}
        />
      )}
      {canClear ? (
        <button type="button" className="input-clear" aria-label="清空" onClick={clear}>
          <MorphIcon icon={X} size={14} color="currentColor" reducedMotion="user" />
        </button>
      ) : null}
    </span>
  );
}
