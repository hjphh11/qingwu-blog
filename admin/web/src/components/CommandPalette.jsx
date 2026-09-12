// 全局搜索面板（阶段 K · 方案 §4.14 + 第 44 条）
//
// 电脑上按 **Cmd/Ctrl + K** 唤起（手机上点顶栏那个放大镜按钮）。
// 输入即搜（服务端 /api/search），↑↓ 选、Enter 跳转、Esc 关掉。
// 结果里既有内容（文章/分类/友链/语录/音乐/申请），也有页面和动作（下载备份…）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { Search, Sparkles, X } from '../icons.js';

/** 把结果拍平成一个数组，方便 ↑↓ 上下选（同时记住它属于哪一组） */
function flatten(groups) {
  const rows = [];
  for (const g of groups) {
    for (const item of g.items) rows.push({ ...item, group: g.label });
  }
  return rows;
}

export default function CommandPalette({ open, onClose, go, onDownload }) {
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const rows = useMemo(() => flatten(groups), [groups]);

  // 打开时聚焦输入框；关掉时清空
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQ('');
      setGroups([]);
      setActive(0);
      setErr('');
    }
  }, [open]);

  // 输入即搜（防抖 150ms —— 打字够快就不会每个字母都打一次接口）
  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    if (!text) {
      setGroups([]);
      setErr('');
      return;
    }
    let alive = true;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api.get(`/api/search?q=${encodeURIComponent(text)}`);
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
  }, [q, open]);

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

  // 键盘上下选的时候，把选中项滚进可视区
  useEffect(() => {
    const el = listRef.current?.querySelector('.palette-row.on');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let index = -1; // 全局序号（和 flatten 的顺序一致）

  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="全局搜索">
        <div className="palette-input">
          <MorphIcon icon={Search} size={17} color="currentColor" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜文章 / 友链 / 语录 / 歌曲 / 页面 / 动作…"
            aria-label="搜索内容"
          />
          {busy && <span className="hint">搜索中…</span>}
          <button type="button" className="iconbtn" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
            <MorphIcon icon={X} size={15} color="currentColor" />
          </button>
        </div>

        <div className="palette-list" ref={listRef}>
          {err && <div className="palette-empty">{err}</div>}
          {!err && q.trim() === '' && (
            <div className="palette-empty">
              <MorphIcon icon={Sparkles} size={15} color="currentColor" /> 输入关键词开始搜；↑↓ 选择、Enter 打开、Esc 关闭
            </div>
          )}
          {!err && q.trim() !== '' && rows.length === 0 && !busy && (
            <div className="palette-empty">没有找到「{q.trim()}」相关的内容</div>
          )}

          {groups.map((g) => (
            <div key={g.kind} className="palette-group">
              <div className="palette-group-title">{g.label}</div>
              {g.items.map((item) => {
                index += 1;
                const on = index === active;
                return (
                  <button
                    key={`${g.kind}-${item.title}-${index}`}
                    type="button"
                    className={`palette-row${on ? ' on' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(item)}
                  >
                    <span className="palette-title">
                      {item.title}
                      {item.badge && <span className="tag tag-soft" style={{ marginLeft: 8 }}>{item.badge}</span>}
                    </span>
                    {item.subtitle && <span className="palette-sub">{item.subtitle}</span>}
                    <span className="palette-go">↵</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="palette-foot">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
          <div className="spacer" />
          <span className="mono">{rows.length} 条结果</span>
        </div>
      </div>
    </div>
  );
}
