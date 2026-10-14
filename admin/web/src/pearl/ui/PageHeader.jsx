// 页面头：大标题 + 说明；右侧放规格铭牌（spec）与主操作（actions）。
// 位置信息由顶栏面包屑承担，不再放英文眉标。
// 逐字搬自 scaffold-vue 的 ui/PageHeader.vue。
//
// 与 Vue 的差异：`$slots.default` 在 React 里是 `children`，`$slots.spec` 是 spec prop。
// `reveal` 类保留 —— 它在 Vue 源码里就写在 header 上，外壳的 useEntrance 会负责补
// `is-entrance-ready`；组件自己绝不能加那个类。children 显式判空，避免渲染出空的 .page-actions。
import { cls } from '../cls.js';

export default function PageHeader({ title, desc, spec, actions, children }) {
  // Vue 默认插槽与显式 actions 是同一位置；两者都接受，actions 优先
  const actionsNode = actions ?? children;

  return (
    <header className="page-head reveal">
      <div className="page-head-main">
        <h1 className="page-title">{title}</h1>
        {desc ? <p className="page-desc">{desc}</p> : null}
      </div>
      {spec || actionsNode ? (
        <div className="page-head-side">
          {spec}
          {actionsNode ? <div className="page-actions">{actionsNode}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
