// 表单字段。逐字搬自 scaffold-vue 的 ui/Field.vue。
//
// 默认根节点是 <label>，点标题即可聚焦输入；内部放开关、勾选组这类自带 label 的控件时
// 传 group，改用 role="group" 避免 label 嵌套。
//
// 与 Vue 的差异：`<component :is>` 的动态标签在 React 里就是取变量当组件类型；
// labelId 用 useId() 而不是 Math.random() —— React 的 SSR/hydration 要求 id 稳定，
// useId 是官方为此设计的钩子，顺带省掉了每次渲染重算的随机串。
import { useId } from 'react';
import { cls } from '../cls.js';

export default function Field({
  label,
  required = false,
  error,
  hint,
  wide = false,
  span = false,
  group = false,
  children,
}) {
  const labelId = `fl-${useId()}`;
  const Root = group ? 'div' : 'label';

  return (
    <Root
      className={cls('field', wide && 'is-wide', span && 'span-2')}
      role={group ? 'group' : undefined}
      aria-labelledby={group && label ? labelId : undefined}
    >
      {label ? (
        <span id={labelId} className="field-label">
          {label}
          {required ? (
            <span className="req" aria-hidden="true">
              *
            </span>
          ) : null}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </Root>
  );
}
