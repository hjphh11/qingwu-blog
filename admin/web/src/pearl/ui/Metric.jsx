// 显示级读数：等宽大数字 + 上标单位。size 对应 --fs-display-xl / l / m / s 四档。
// 逐字搬自 scaffold-vue 的 ui/Metric.vue。
//
// 与 Vue 的差异：`<slot />` → children；其余一一对应。注意 Odometer 的 group 用默认值 true，
// 与 Vue 模板里没显式传 :group 一致。
import { cls } from '../cls.js';
import Odometer from './Odometer.jsx';

export default function Metric({ value, unit, decimals = 0, size = 'm', label, children }) {
  return (
    <div className={cls('metric', `metric-${size}`)}>
      {label ? <span className="metric-label">{label}</span> : null}
      <span className="metric-figure">
        <Odometer value={value} decimals={decimals} />
        {unit ? <sup className="metric-unit">{unit}</sup> : null}
      </span>
      {children}
    </div>
  );
}
