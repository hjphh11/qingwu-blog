// 空态。逐字搬自 scaffold-vue 的 ui/EmptyState.vue。
//
// 与 Vue 的差异：Vue 的 `icon` 是图标名字符串（默认 'search'）；React 这边收 IconNode，
// 默认值是 icons.js 里的 Search 节点本身。要换成别的图形，直接传 icon={SomeIconNode}。
import { MorphIcon } from 'morphicons/react';
import { cls } from '../cls.js';
import { Search } from '../../icons.js';

export default function EmptyState({ title = '暂无数据', desc, icon = Search, children }) {
  return (
    <div className={cls('empty')}>
      <span className="empty-ico m-groove">
        <MorphIcon icon={icon} size={20} color="currentColor" reducedMotion="user" />
      </span>
      <div className="empty-title">{title}</div>
      {desc ? <div>{desc}</div> : null}
      {children}
    </div>
  );
}
