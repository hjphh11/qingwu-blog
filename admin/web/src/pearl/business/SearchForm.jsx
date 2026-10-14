// 查询区（SearchForm）：端口自 scaffold 的 business/SearchForm.vue。
//
// 字段放 children（任意 React 节点，本组件不假设结构），回车即查询，
// 查询 / 重置按钮统一在右侧。Vue 的 @submit.prevent 在 React 里是 preventDefault()。
import { RefreshCw, Search } from '../../icons.js';
import { cls } from '../cls.js';
import Button from '../ui/Button.jsx';

export default function SearchForm({ loading = false, onSearch, onReset, children, className }) {
  return (
    <form
      className={cls('search-form', 'm-surface', 'reveal', className)}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch?.();
      }}
    >
      {children}
      <div className={cls('search-actions')}>
        {/* Vue 里 icon="refresh"，本后台图标是组件，取最接近的 RefreshCw */}
        <Button variant="ghost" icon={RefreshCw} onClick={onReset}>
          重置
        </Button>
        <Button variant="primary" icon={Search} type="submit" loading={loading}>
          查询
        </Button>
      </div>
    </form>
  );
}
