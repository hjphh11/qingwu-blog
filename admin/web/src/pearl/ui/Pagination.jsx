// 分页（Pagination）：端口自 scaffold 的 ui/Pagination.vue。
//
// 页码省略号算法、类名、aria-current 全部照抄；唯一的框架差异是
// v-model:page / v-model:page-size 在 React 里拆成 page + onPage、pageSize + onPageSize。
import { useMemo } from 'react';
import { MorphIcon } from 'morphicons/react';
import { ChevronLeft, ChevronRight } from '../../icons.js';
import { cls } from '../cls.js';
import Select from './Select.jsx';

/** 每页条数下拉的默认档位（与 Vue 的 withDefaults 一致） */
const DEFAULT_SIZES = [10, 20, 50, 100];

export default function Pagination({
  total = 0,
  page = 1,
  pageSize = 10,
  sizes = DEFAULT_SIZES,
  onPage,
  onPageSize,
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const sizeOptions = useMemo(() => sizes.map((size) => ({ label: `${size} 条/页`, value: size })), [sizes]);

  const nums = useMemo(() => {
    const list = [];
    for (let i = 1; i <= pages; i += 1) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 1) list.push(i);
      else if (list[list.length - 1] !== '…') list.push('…');
    }
    return list;
  }, [pages, page]);

  function go(value) {
    const next = Math.min(pages, Math.max(1, value));
    if (next !== page) onPage?.(next);
  }

  return (
    <nav className={cls('pager')} aria-label="分页">
      <div className={cls('pager-info')}>
        共 <b className={cls('tnum')}>{total}</b> 条
        {total ? (
          <>
            ，当前{' '}
            <b className={cls('tnum')}>
              {start}–{end}
            </b>
          </>
        ) : null}
      </div>
      <div className={cls('pager-ctrl')}>
        <div style={{ width: '112px', marginRight: '6px' }}>
          <Select
            value={pageSize}
            options={sizeOptions}
            onChange={(next) => onPageSize?.(Number(next))}
          />
        </div>
        <button
          type="button"
          className={cls('pg-btn')}
          disabled={page <= 1}
          aria-label="上一页"
          onClick={() => go(page - 1)}
        >
          <MorphIcon icon={ChevronLeft} size={15} color="currentColor" />
        </button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`d${i}`} className={cls('pg-dots')}>
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              className={cls('pg-btn', 'tnum', n === page && 'is-active m-pill')}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => go(n)}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          className={cls('pg-btn')}
          disabled={page >= pages}
          aria-label="下一页"
          onClick={() => go(page + 1)}
        >
          <MorphIcon icon={ChevronRight} size={15} color="currentColor" />
        </button>
      </div>
    </nav>
  );
}
