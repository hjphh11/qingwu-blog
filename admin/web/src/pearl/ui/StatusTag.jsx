// 状态标签：1 / true 视为「开」，其余一律「关」。逐字搬自 scaffold-vue 的 ui/StatusTag.vue。
//
// 与 Vue 的差异：Vue 传下来的是 `status === 1 || status === true` 这个布尔表达式的结果，
// 组件本身只接一个布尔 prop，没有行为差异。
import Tag from './Tag.jsx';

export default function StatusTag({ status, on = '正常', off = '停用' }) {
  const isOn = status === 1 || status === true;

  return (
    <Tag tone={isOn ? 'ok' : 'neutral'} dot>
      {isOn ? on : off}
    </Tag>
  );
}
