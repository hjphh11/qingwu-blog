// 按钮。逐字搬自 scaffold-vue 的 ui/Button.vue。
//
// 与 Vue 的差异：
//   1. Vue 的 `icon` 是图标名字符串，靠全局 Icon 组件按名注册表渲染；React 这边
//      直接收 lucide 的 IconNode，交给 MorphIcon —— 少一层名字映射，也就不需要注册表。
//   2. 类名必须走 cls()：`.btn` / `.btn-block` / `.btn-ghost` 三个名字与后台老暖色
//      app.css 重名，pearl 样式里已改成 `.p-btn` 等，cls() 负责补前缀。
//      注意 `.btn-primary` / `.btn-sm` / `.btn-secondary` 这些**没有被改名**
//      （sync 脚本的正则要求类名后面不能跟 `-`），所以它们原样透传。
import { MorphIcon } from 'morphicons/react';
import { cls } from '../cls.js';

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  danger = false,
  block = false,
  type = 'button',
  className,
  style,
  onClick,
  children,
  // 其余属性（title / autoFocus / aria-* / data-* …）原样透传给 <button>：
  // 提示（title）与无障碍属性要能加上，否则 Vue 里能用、React 里会被静默吞掉。
  ...rest
}) {
  return (
    <button
      type={type}
      className={cls(
        'btn',
        `btn-${variant}`,
        size === 'sm' && 'btn-sm',
        block && 'btn-block',
        danger && 'is-danger',
        // 次级按钮在珍珠玻璃里是「胶囊」材质，Vue 用 m-pill 标记；非重名，cls() 原样透传
        variant === 'secondary' && 'm-pill',
        className,
      )}
      style={style}
      {...rest}
      disabled={disabled || loading}
      // Vue 里 `:aria-busy="loading || undefined"` —— 假值时整个属性消失；
      // React 19 对布尔 false 也是删除属性，语义一致
      aria-busy={loading || undefined}
      onClick={onClick}
    >
      {loading ? (
        <span className="spinner" aria-hidden="true" />
      ) : icon ? (
        <MorphIcon icon={icon} size={size === 'sm' ? 14 : 16} color="currentColor" reducedMotion="user" />
      ) : null}
      {children}
    </button>
  );
}
