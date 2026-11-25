import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import { CircleAlert, LoaderCircle, Search, X } from '../../lib/icons';
import { search, type SearchHit } from '../../lib/chat';

/**
 * 长亭 · 搜索聊天记录
 *
 * 为什么用 portal 挂在 body 上：聊天卡片是 `overflow: hidden`，
 * 任何在它内部 absolute 定位的浮层都会被裁掉一角（表情面板已经踩过一次）。
 *
 * 输入 300ms 防抖：每敲一个字都打接口的话，一次搜索会发十几个请求，
 * 而人打字的速度远快于一次往返。
 */
export default function ChatSearch({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  /** 搜过一次之后才显示「没找到」—— 一进来就说「没有」很怪 */
  const [asked, setAsked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setHits([]);
      setAsked(false);
      return;
    }
    let alive = true;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      const rows = await search(text);
      if (!alive) return;
      setHits(rows);
      setBusy(false);
      setAsked(true);
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      setBusy(false);
    };
  }, [q]);

  return createPortal(
    <div className="q-chatsearch" role="dialog" aria-modal="true" aria-label="搜索聊天记录">
      {/* 点空白处收起（Esc 也行）。遮罩是按钮，键盘用户才点得到 */}
      <button
        type="button"
        className="q-chatsearch__mask"
        aria-label="关掉搜索"
        onClick={onClose}
      />
      <div className="q-chatsearch__panel">
        <div className="q-chatsearch__head">
          <MorphIcon icon={Search} size={14} color="currentColor" />
          <input
            ref={inputRef}
            className="q-chatsearch__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜聊天记录，至少两个字"
            aria-label="搜索关键词"
          />
          {busy && <MorphIcon icon={LoaderCircle} size={14} color="currentColor" />}
          <button type="button" onClick={onClose} aria-label="关闭搜索">
            <MorphIcon icon={X} size={14} color="currentColor" />
          </button>
        </div>

        <div className="q-chatsearch__body">
          {q.trim().length > 0 && q.trim().length < 2 && (
            <p className="q-chatsearch__hint">再打一个字</p>
          )}

          {asked && hits.length === 0 && !busy && (
            <p className="q-chatsearch__hint">
              <MorphIcon icon={CircleAlert} size={13} color="currentColor" />
              没找到「{q.trim()}」
            </p>
          )}

          {hits.length > 0 && (
            <ul className="q-chatsearch__list">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => onPick(h)}>
                    <span
                      className="q-chatsearch__av"
                      style={h.avatar ? { backgroundImage: `url("${h.avatar}")` } : undefined}
                      aria-hidden="true"
                    >
                      {h.name.slice(0, 1)}
                    </span>
                    <span className="q-chatsearch__main">
                      <span className="q-chatsearch__meta">
                        {h.name}
                        <time dateTime={h.at}>{new Date(h.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                        {h.recalled && <em>已撤回</em>}
                      </span>
                      <span className="q-chatsearch__text">{h.body.replace(/\s+/g, ' ').slice(0, 90)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
