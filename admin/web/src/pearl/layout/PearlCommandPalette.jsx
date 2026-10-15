// 全局搜索面板（珍珠玻璃版）。
//
// 与旧版（components/CommandPalette.jsx，暖色类名）的差别只在**外观层**：
// 类名换成 scaffold 的 cmd-* 一套，并自己量出高亮胶囊的位置。
// 功能原样保留：输入即搜 /api/search、↑↓ 选择、Enter 打开、Esc 关闭、
// 结果里既有内容也有页面与动作（下载备份）。输入为空时列出「页面」入口 ——
// 这样 Cmd+K 本身就是一等导航（调研里的结论）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../../api.js';
import {
  ChartNoAxesColumn,
  FileText,
  Search,
  ScrollText,
  Settings,
  Sparkles,
  Trash,
} from '../../icons.js';
import { cls } from '../cls.js';

/** 输入为空时的页面入口（与侧栏模块一致） */
const PAGES = [
  { title: '概览', sub: '内容与发布', route: { name: 'dash' }, icon: ChartNoAxesColumn },
  { title: '文章', sub: '管理文章', route: { name: 'posts' }, icon: FileText },
  { title: '分类', sub: '前台筛选按钮跟着它变', route: { name: 'cats' }, icon: Settings },
  { title: '操作日志', sub: '发布 / 回滚 / 审批记录', route: { name: 'logs' }, icon: ScrollText },
  { title: '访问统计', sub: '访问量 · 阅读数 · 来源', route: { name: 'stats' }, icon: ChartNoAxesColumn },
  { title: '回收站', sub: '可恢复的已删除内容', route: { name: 'trash' }, icon: Trash },
];

/** 把服务端返回的分组拍平成一行行，方便 ↑↓ 上下选 */
function flatten(groups) {
  const rows = [];
  for (const g of groups) {
    for (const item of g.items) rows.push({ ...item, group: g.label });
  }
  return rows;
}

export default function PearlCommandPalette({ open, onClose, go, onDownload }) {
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const thumbRef = useRef(null);

  const keyword = q.trim();
  // 没输入关键词时展示静态页面入口
  const shown = useMemo(() => {
    if (keyword) return groups;
    return [{ kind: 'page', label: '页面', items: PAGES }];
  }, [keyword, groups]);
  const rows = useMemo(() => flatten(shown), [shown]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
    setQ('');
    setGroups([]);
    setActive(0);
    setErr('');
    return undefined;
  }, [open]);

  // 输入即搜（防抖 150ms：打字够快就不会每个字母都打一次接口）
  useEffect(() => {
    if (!open) return undefined;
    if (!keyword) {
      setGroups([]);
      setErr('');
      return undefined;
    }
    let alive = true;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api.get(`/api/search?q=${encodeURIComponent(keyword)}`);
        if (!alive) return;
        setGroups(r.groups ?? []);
        setActive(0);
        setErr('');
      } catch (e) {
        if (alive) setErr(e.message || '搜索失败');
      } finally {
        if (alive) setBusy(false);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
      setBusy(false);
    };
  }, [keyword, open]);

  // 高亮胶囊：量出当前项的位置（scaffold 用 GSAP slideThumb，这里量位置交给 CSS 过渡）。
  // 用 rect 相对胶囊自己的 offsetParent 算，避免 offsetTop 基准不一致导致的错位。
  useEffect(() => {
    if (!open) return;
    const box = listRef.current;
    const thumb = thumbRef.current;
    if (!box || !thumb) return;
    const el = box.querySelector('.cmd-item.is-active');
    if (!el) {
      thumb.style.opacity = '0';
      return;
    }
    const host = thumb.offsetParent || box;
    const itemRect = el.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    thumb.style.opacity = '1';
    thumb.style.transform = `translateY(${itemRect.top - hostRect.top + host.scrollTop}px)`;
    thumb.style.height = `${itemRect.height}px`;
  }, [open, active, rows.length, keyword]);

  // 键盘上下选时把选中项滚进可视区
  useEffect(() => {
    const el = listRef.current?.querySelector('.cmd-item.is-active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = useCallback(
    (row) => {
      if (!row) return;
      onClose?.();
      if (row.download) {
        onDownload?.(row.download);
        return;
      }
      if (row.route) go?.(row.route.name, row.route.params ?? {});
    },
    [go, onClose, onDownload],
  );

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(rows[active]);
    }
  };

  if (!open) return null;

  let index = -1; // 全局序号，与 flatten 的顺序一致

  return (
    <div className={cls('overlay', 'cmd-overlay')} onClick={onClose}>
      <div
        className={cls('modal', 'cmd-panel', 'm-float')}
        role="dialog"
        aria-label="全局搜索"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmd-input">
          <MorphIcon icon={Search} size={17} color="currentColor" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜文章 / 友链 / 语录 / 歌曲 / 页面 / 动作…"
            aria-label="搜索内容"
          />
          {busy && <span className="faint">搜索中…</span>}
          <span className={cls('kbd')}>Esc</span>
        </div>

        <div className="cmd-results" ref={listRef}>
          <span ref={thumbRef} className={cls('cmd-thumb', 'm-pill')} aria-hidden="true" style={{ opacity: 0 }} />

          {err && <div className="select-empty">{err}</div>}
          {!err && keyword && rows.length === 0 && !busy && (
            <div className="select-empty">没有找到「{keyword}」相关的内容</div>
          )}

          {shown.map((g) => (
            <div key={g.kind}>
              <span className={cls('cmd-group', 'eyebrow')}>{g.label}</span>
              {g.items.map((item) => {
                index += 1;
                const on = index === active;
                const Ico = item.icon;
                return (
                  <button
                    key={`${g.kind}-${item.title}-${index}`}
                    type="button"
                    className={cls('cmd-item', on && 'is-active')}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(item)}
                  >
                    <span className={cls('cmd-ico', 'm-groove')}>
                      {Ico ? <MorphIcon icon={Ico} size={16} color="currentColor" /> : <MorphIcon icon={Sparkles} size={16} color="currentColor" />}
                    </span>
                    <span className="cmd-label">{item.title}</span>
                    <span className="cmd-sub">{item.subtitle || item.sub || item.group || ''}</span>
                    <span className="cmd-go">↵</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="cmd-foot">
          <span>
            <span className={cls('kbd')}>↑</span>
            <span className={cls('kbd')}>↓</span> 选择
          </span>
          <span>
            <span className={cls('kbd')}>↵</span> 打开
          </span>
          <span className={cls('kbd')}>Esc</span> 关闭
          <span className={cls('spacer')} />
          <span className={cls('mono')}>{rows.length} 条结果</span>
        </div>
      </div>
    </div>
  );
}
