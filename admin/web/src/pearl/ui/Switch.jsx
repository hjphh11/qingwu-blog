// 开关（端口自 scaffold 的 ui/Switch.vue）。DOM 与类名逐字一致。
// 多一个 ariaLabel：表格里用「只有开关、不显示文字」的紧凑形态时，
// 仍要有可读的无障碍名称（Vue 版没有这个 prop，是本项目为表格加的）。
export default function Switch({ checked = false, onChange, disabled = false, label, ariaLabel, children }) {
  return (
    <label className={['switch', checked && 'is-on', disabled && 'is-disabled'].filter(Boolean).join(' ')}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        aria-label={ariaLabel ?? (label ? undefined : '开关')}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="switch-track">
        <span className="switch-knob" />
      </span>
      {/* 文字标签单独给个类：紧凑档只隐藏它，绝不能连 `.switch-track` 一起隐藏（会变空白） */}
      {label ? <span className="switch-label">{label}</span> : null}
      {children}
    </label>
  );
}
