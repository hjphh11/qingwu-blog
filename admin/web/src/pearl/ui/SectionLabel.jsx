// 区块标题：横带分层与仪器化面板的中文小标题（不再使用英文眉标与编号）。
// 逐字搬自 scaffold-vue 的 ui/SectionLabel.vue。
//
// 与 Vue 的差异：`<component :is="as ?? 'h2'">` 在 React 里取变量当组件类型即可；
// cls 是局部变量名，所以先算好标签名再渲染，避免与 cls() 工具函数重名。
import { cls } from '../cls.js';

/**
 * `status` 是本项目为「状态灯」加的（Vue 版没有）：
 * 'ok' | 'info' | 'danger' —— 只有传了才在标题前亮一个点，颜色对应真实状态；
 * 不传就没有点（scaffold 原本是无条件画一个青柠点，属纯装饰）。
 */
export default function SectionLabel({ title, as = 'h2', status }) {
  const Tag = as ?? 'h2';

  return (
    <div className="section-mark">
      {title ? <Tag className={cls('section-mark-title', status && `is-${status}`)}>{title}</Tag> : null}
    </div>
  );
}
