// 面板。逐字搬自 scaffold-vue 的 ui/Panel.vue。
//
// 与 Vue 的差异：
//   1. Vue 的 `$slots.tools` / `$slots.head` 是「插槽有没有被传」的编译期信息；
//      React 的 children 只是普通 prop，所以判定改成 props 是否为 null/undefined。
//      （传了空数组或空 Fragment 时仍会渲染出空的 .panel-tools —— 和 Vue 传空插槽的行为一致。）
// 差异说明（续）：`panel-head` 与老暖色 app.css 重名，pearl 样式里是 `.p-panel-head`，
// 所以**必须走 cls()** —— 早先这行写成了字面量 "panel-head"，结果面板头一直在吃
// app.css 的旧规则（padding 0 / min-height 0 / 标题 17px），珍珠玻璃的
// `min-height: 60px; padding: 14px 20px` 完全没生效（真机验收时靠量 DOM 才发现）。
import { cls } from '../cls.js';

export default function Panel({ title, meta, tools, head, children, className, style, status }) {
  const hasHead = Boolean(head || title || meta || tools);

  return (
    <section className={cls('panel', 'm-surface', className)} style={style}>
      {hasHead ? (
        <header className={cls('panel-head')}>
          {head ?? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', minWidth: 0 }}>
              {/* status：'ok' 青柠 / 'info' 蓝 / 'danger' 红 —— 不传就不亮灯（见 pearl-local.css §8） */}
              <h2 className={cls('section-label', status && `is-${status}`)}>{title}</h2>
              {meta ? <span className="panel-meta">{meta}</span> : null}
            </div>
          )}
          {tools ? <div className="panel-tools">{tools}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
