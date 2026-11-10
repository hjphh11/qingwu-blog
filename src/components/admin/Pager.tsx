/*
 * 后台 · 翻页条
 *
 * 2026-11-10 深夜加的。站长对着三张长列表（最近自动回复 / 拦截记录 / 评论收件箱）
 * 说「这个限制一下一页显示多少条信息」—— 原来后两处是「一次给 N 条到头」，
 * 第一处干脆写死 20 条，都没有翻页。
 *
 * 一处写完三处共用，是因为这三张表的翻页行为必须一样：同样的页长选项、
 * 同样的位置、同样的「共几条」。各写一份迟早出现一个能选 50、一个只能 20。
 *
 * 页长由后端白名单校验（worker 的 PAGE_SIZES），这里只是给选项 ——
 * 前端改得动 select 的 value 也没用，多出来的值会被回落成默认。
 */
export const PAGE_SIZES = [10, 20, 50];

export default function Pager({
  total,
  page,
  pages,
  pageSize,
  onPage,
  onSize,
  loading = false,
  unit = '条',
}: {
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  onPage: (p: number) => void;
  onSize: (n: number) => void;
  loading?: boolean;
  unit?: string;
}) {
  const btn = 'q-admin-btn q-admin-btn--ghost q-admin-btn--sm';
  return (
    <div className="q-admin-pager">
      <span className="q-admin-pager__count">
        共 {total} {unit}
      </span>

      <div className="q-admin-pager__nav">
        <button
          className={btn}
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => onPage(Math.max(1, page - 1))}
        >
          上一页
        </button>
        <span className="q-admin-pager__at">
          {page} / {pages}
        </span>
        <button
          className={btn}
          type="button"
          disabled={page >= pages || loading}
          onClick={() => onPage(Math.min(pages, page + 1))}
        >
          下一页
        </button>
      </div>

      <label className="q-admin-pager__size">
        每页
        <select
          value={pageSize}
          aria-label="每页显示条数"
          disabled={loading}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        条
      </label>
    </div>
  );
}
