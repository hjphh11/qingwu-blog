import { MorphIcon } from 'morphicons/react';
import { LoaderCircle, MapPin, Trash2 } from '../../lib/icons';
import { renderRich } from '../../lib/richText';
import type { MyComment } from '../../lib/auth';

/**
 * 「我的留言」列表 —— 留言板顶部的抽屉和 /account 页共用同一份。
 *
 * 两处唯一的差别是「定位」怎么走：
 *   · 抽屉里在同一个页面上 → 传 `onLocate`，就地滚过去并关掉抽屉
 *   · 账号页在另一条路由 → 不传，渲染成 `<a href="/links/#c-12">`，
 *     留言板那边读 hash 自己滚（两个页面各自管各自的事，不用共享状态）
 *
 * 日期只取前 10 位（yyyy-mm-dd）：这里看的是「哪天的」，精确到分钟没意义，
 * 反而让每一行都长一截。
 */
export default function MyCommentList({
  items,
  busyId,
  onDelete,
  onLocate,
}: {
  items: MyComment[] | null;
  busyId: string;
  onDelete: (id: string) => void;
  onLocate?: (id: string) => void;
}) {
  if (items === null) {
    return (
      <p className="flex items-center gap-2 py-6 text-xs text-subtle">
        <span className="animate-spin">
          <MorphIcon icon={LoaderCircle} size={13} color="currentColor" />
        </span>
        正在找…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-xs leading-relaxed text-subtle">
        还没有用这个邮箱留过言。
        <br />
        去留言板写一句试试 ~
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((c) => (
        <li key={c.id} className="rounded-xl border border-rose/20 bg-white/70 p-3">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] ${
                c.status === 'approved'
                  ? 'bg-crimson/10 text-crimson'
                  : 'border border-amber/45 bg-amber/10 text-brown'
              }`}
            >
              {c.status === 'approved' ? '已是友链' : '等我看看'}
            </span>
            {/* 回复也列在这里 —— 不标一下会让人以为是条独立留言 */}
            {c.parentId && (
              <span className="rounded-full bg-rose/15 px-1.5 py-px text-[10px] text-muted">回复</span>
            )}
            <span className="text-[10.5px] tabular-nums text-subtle">{c.at.slice(0, 10)}</span>

            <div className="ml-auto flex items-center gap-2.5">
              {/* 回复在页面上默认折着，所以定位到它所在的主楼，不硬指到回复本身 */}
              {onLocate ? (
                <button
                  type="button"
                  onClick={() => onLocate(c.parentId || c.id)}
                  className="inline-flex items-center gap-1 text-[10.5px] text-subtle transition-colors hover:text-crimson"
                >
                  <MorphIcon icon={MapPin} size={10} color="currentColor" />
                  定位
                </button>
              ) : (
                <a
                  href={`/links/#${c.parentId || c.id}`}
                  className="inline-flex items-center gap-1 text-[10.5px] text-subtle transition-colors hover:text-crimson"
                >
                  <MorphIcon icon={MapPin} size={10} color="currentColor" />
                  定位
                </a>
              )}
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                disabled={busyId === c.id}
                className="inline-flex items-center gap-1 text-[10.5px] text-subtle transition-colors hover:text-crimson disabled:opacity-60"
              >
                <MorphIcon icon={Trash2} size={10} color="currentColor" />
                {busyId === c.id ? '删除中' : '删除'}
              </button>
            </div>
          </div>

          <div
            className="q-rich mt-1.5 line-clamp-3 text-[12px] text-muted"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderRich(c.intro) }}
          />
        </li>
      ))}
    </ul>
  );
}
