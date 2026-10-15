// 图标按钮。逐字搬自 scaffold-vue 的 ui/IconButton.vue。
//
// 与 Vue 的差异：Vue 的 prop 叫 `name`（图标名字符串），React 这边按任务约定改叫
// `icon`，直接收 lucide 的 IconNode。`title` 与 `aria-label` 都取 label，与 Vue 一致。
import { MorphIcon } from 'morphicons/react';
import { cls } from '../cls.js';

export default function IconButton({
  icon,
  label,
  size = 17,
  bordered = false,
  danger = false,
  small = false,
  disabled = false,
  onClick,
  className,
  style,
  // 其余属性（aria-* / data-* …）原样透传；title 与 aria-label 由 label 统一给
  ...rest
}) {
  return (
    <button
      type="button"
      className={cls(
        'icon-btn',
        bordered && 'is-bordered',
        danger && 'is-danger',
        small && 'icon-btn-sm',
        className,
      )}
      style={style}
      {...rest}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <MorphIcon icon={icon} size={size} color="currentColor" reducedMotion="user" />
    </button>
  );
}
