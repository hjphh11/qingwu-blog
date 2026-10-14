// 规格铭牌：深色玻璃小板，等宽键值行。只读读数，不带可点的样子。
// 逐字搬自 scaffold-vue 的 ui/SpecPlate.vue。
//
// 与 Vue 的差异：`v-for` 的 `:key="r.label"` 照搬成 React key。
// Vue 模板里 value 用 `?? '—'`，所以 0 与 '' 都照原样显示，只有 null/undefined 落成破折号。
import { cls } from '../cls.js';

export default function SpecPlate({ rows = [], title }) {
  return (
    <dl className={cls('spec-plate')} aria-label={title}>
      {title ? <div className="spec-title">{title}</div> : null}
      {rows.map((r) => (
        <div key={r.label} className="spec-row">
          <dt>{r.label}</dt>
          <dd className={cls('tnum', r.tone && `is-${r.tone}`)}>{r.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
