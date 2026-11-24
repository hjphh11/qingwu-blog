/**
 * 站内搜索（Ctrl / ⌘ + K）
 *
 * 数据来源是构建期生成的 `/search-index.json`（见 src/pages/search-index.json.ts）：
 * 一次静态请求拿到全部文章，之后的匹配、排序、摘要全在本地算 —— 不碰数据库、
 * 不走接口、断网时只要索引已经在缓存里就还能搜。
 *
 * 为什么自己写而不引 Fuse.js：
 *   中文没有空格分词，Fuse 的位序/编辑距离打分对中文几乎不起作用，
 *   反而会把「歌词」这种两字词拆得乱七八糟。这里直接用子串命中 + 字段权重，
 *   二十来篇文章的规模，过滤一次不到 1ms。
 *
 * 交互（都按原生习惯来，不发明新操作）：
 *   Ctrl/⌘ + K 打开 · Esc 关闭 · ↑↓ 选择 · ↵ 打开 · 点遮罩关闭
 *
 * ⚠️ 弹层用 createPortal 挂到 body：导航栏和页面容器上有 backdrop-filter /
 *    transform，fixed 定位会在这些祖先里「相对祖先」而不是视口（站内弹层踩过）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import { Search } from '../lib/icons';

interface Doc {
  url: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  date: string;
  text: string;
}

interface Hit {
  doc: Doc;
  score: number;
  snippet: string;
}

/** 索引请求（模块级缓存：切页重挂载时不再请求第二遍） */
let indexPromise: Promise<Doc[] | null> | null = null;

function loadIndex(): Promise<Doc[] | null> {
  if (!indexPromise) {
    indexPromise = fetch('/search-index.json', { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: unknown) => (Array.isArray(data) ? (data as Doc[]) : null))
      .catch(() => {
        // 失败时把缓存清掉：下次打开搜索框会重试，而不是永远停在「加载失败」
        indexPromise = null;
        return null;
      });
  }
  return indexPromise;
}

const lower = (s: string) => s.toLowerCase();

/**
 * 打分：标题 > 标签 > 摘要 > 正文。
 *
 * **多个词之间是 AND**（每个词都得在某处出现）—— 搜「Nginx 403」的人要的是
 * 同时讲这两件事的文章，不是随便命中一个词的十二篇。
 * 命中不了的直接返回 0，调用方据此过滤。
 */
function scoreDoc(doc: Doc, terms: string[]): number {
  const title = lower(doc.title);
  const tags = lower(doc.tags.join(' '));
  const desc = lower(doc.description);
  const body = lower(doc.text);

  let score = 0;
  for (const term of terms) {
    let hit = false;

    if (title.includes(term)) {
      score += 140;
      // 标题开头命中再加一档：搜「403」时《403 不是 404》该排在前面
      if (title.startsWith(term)) score += 60;
      hit = true;
    }
    if (tags.includes(term)) {
      score += 60;
      hit = true;
    }
    if (desc.includes(term)) {
      score += 30;
      hit = true;
    }

    const at = body.indexOf(term);
    if (at >= 0) {
      hit = true;
      // 正文里出现次数加分，但最多算 5 次 —— 否则一篇长文会仅凭「词多」压过主题更准的
      let count = 0;
      let from = 0;
      while (count < 5) {
        const i = body.indexOf(term, from);
        if (i < 0) break;
        count += 1;
        from = i + term.length;
      }
      score += count * 6;
    }

    if (!hit) return 0;
  }
  return score;
}

/** 摘要：取正文里**第一个命中词**前后一小段，命中处由 <Highlight> 标出来 */
function makeSnippet(doc: Doc, terms: string[]): string {
  const text = doc.text.replace(/\s+/g, ' ').trim();
  if (!text) return doc.description;

  let at = -1;
  let len = 0;
  for (const term of terms) {
    const i = text.toLowerCase().indexOf(term);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      len = term.length;
    }
  }
  if (at < 0) return text.length > 96 ? `${text.slice(0, 96)}…` : text;

  const start = Math.max(0, at - 28);
  const end = Math.min(text.length, at + len + 52);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 把命中的词包成 <mark>。split 带捕获组时，奇数位就是命中的片段 */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    if (!terms.length) return [text];
    const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
    return text.split(re);
  }, [text, terms]);

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-rose/35 px-0.5 text-ink">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export default function SiteSearch() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const resultRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => setOpen(false), []);

  /** 关闭后清空输入与高亮项（快捷键关掉时也要清，否则下次打开还留着上次的词） */
  useEffect(() => {
    if (open) return;
    setQuery('');
    setActive(0);
  }, [open]);

  /** 打开搜索框的唯一入口：导航栏按钮与 Ctrl+K 都发这个事件 */
  useEffect(() => {
    const openSearch = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('qingwu:search', openSearch);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('qingwu:search', openSearch);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // 第一次打开时才拉索引：这条 100KB 左右的请求不该压在首屏上
  useEffect(() => {
    if (!open || docs) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    loadIndex().then((data) => {
      if (!alive) return;
      setLoading(false);
      if (data) setDocs(data);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [open, docs]);

  // 打开时锁住页面滚动；关闭 / 卸载（换页）时一定还原
  useEffect(() => {
    if (!open) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = 'hidden';
    return () => {
      el.style.overflow = prev;
    };
  }, [open]);

  // 打开后把焦点放进输入框 —— 少一次「还要点一下才能打字」
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  // 换页时组件会被卸载，portal 的 DOM 由 React 一起收走；
  // 滚动锁的清理在上面的 effect 里 —— 卸载时 return 的回调一定会跑。

  const terms = useMemo(
    () =>
      query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        // 长词优先：先匹配「nginx」再匹配「ng」，高亮才不会碎成一片
        .sort((a, b) => b.length - a.length),
    [query],
  );

  const results = useMemo<Hit[]>(() => {
    if (!docs || terms.length === 0) return [];
    const hits: Hit[] = [];
    for (const doc of docs) {
      const score = scoreDoc(doc, terms);
      if (score > 0) hits.push({ doc, score, snippet: makeSnippet(doc, terms) });
    }
    // 分数相同时新的在前 —— 同一主题的系列文，读者多半想先看近的
    hits.sort((a, b) => b.score - a.score || (a.doc.date < b.doc.date ? 1 : -1));
    return hits.slice(0, 12);
  }, [docs, terms]);

  // 结果变了就把高亮项拉回第一条（否则按 ↓ 会从上一轮的位置开始）
  useEffect(() => setActive(0), [query]);

  /** 索引没到之前先不显示标签云，避免「先空一下再冒出来」 */
  const topTags = useMemo(() => {
    if (!docs) return [];
    const counts = new Map<string, number>();
    for (const doc of docs) {
      for (const tag of doc.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag]) => tag);
  }, [docs]);

  // 键盘选择时让当前项始终可见
  useEffect(() => {
    if (!open) return;
    const el = resultRefs.current[active];
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length) setActive((i) => (i + 1) % results.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) setActive((i) => (i - 1 + results.length) % results.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // 走真实 <a> 的 click：ClientRouter 会接管成同站无刷新跳转，
      // 不用在这里再引一次 navigate()，也不会丢掉「中键新标签页」这类原生行为。
      if (results[active]) resultRefs.current[active]?.click();
    }
  };

  const hint =
    terms.length > 0 && !loading && !failed
      ? `共 ${results.length} 篇`
      : loading
        ? '正在翻书架…'
        : '';

  if (!mounted) return null;

  return (
    <>
      {createPortal(
        open ? (
          <div
            className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[10vh] sm:pt-[12vh]"
            role="dialog"
            aria-modal="true"
            aria-label="站内搜索"
            onKeyDown={onKeyDown}
          >
            {/* 遮罩：点它关闭。颜色取深暖棕而不是黑 —— 黑遮罩会把整页压成灰的 */}
            <div
              className="absolute inset-0 bg-[rgba(58,42,32,0.32)] backdrop-blur-[3px]"
              onClick={close}
              aria-hidden="true"
            />

            <div
              ref={panelRef}
              className="relative w-full max-w-[38rem] overflow-hidden rounded-[var(--radius-card)]"
              style={{
                background: 'rgba(255, 252, 247, 0.97)',
                backdropFilter: 'blur(22px) saturate(170%)',
                WebkitBackdropFilter: 'blur(22px) saturate(170%)',
                border: '1px solid rgba(246, 165, 184, 0.45)',
                boxShadow: '0 26px 70px rgba(120, 70, 60, 0.26)',
              }}
            >
              <div className="flex items-center gap-2.5 border-b border-rose/20 px-4">
                <span className="shrink-0 text-crimson/80" aria-hidden="true">
                  <MorphIcon icon={Search} size={18} color="currentColor" />
                </span>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="搜标题、标签或正文…"
                  aria-label="搜索文章"
                  aria-controls="q-search-results"
                  className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
                />
                <kbd className="hidden shrink-0 rounded-md border border-rose/30 bg-rose/10 px-1.5 py-0.5 text-[0.6875rem] text-subtle sm:block">
                  Esc
                </kbd>
              </div>

              <div
                id="q-search-results"
                ref={listRef}
                className="max-h-[min(58vh,24rem)] overflow-y-auto overscroll-contain p-2"
                role="listbox"
                aria-label="搜索结果"
              >
                {/* 空查询：给标签云。没有引导的空框只会让人打一个词再关掉 */}
                {terms.length === 0 &&
                  (loading ? (
                    <p className="px-3 py-8 text-center text-sm text-subtle">正在翻书架…</p>
                  ) : failed ? (
                    <p className="px-3 py-8 text-center text-sm text-subtle">
                      索引没加载出来，稍后再试一次 ~
                    </p>
                  ) : (
                    <div className="px-2 py-3">
                      <p className="px-1 text-xs text-subtle">搜点什么？这些都是站里真有的词</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {topTags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setQuery(tag)}
                            className="rounded-full border border-rose/30 bg-white/60 px-2.5 py-1 text-xs text-muted transition-colors hover:border-rose/60 hover:text-crimson"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                      <p className="mt-4 px-1 text-[0.6875rem] leading-relaxed text-subtle">
                        支持多个词（空格分开，全部命中才算）：试试
                        <span className="mx-1 text-muted">Nginx 403</span>
                      </p>
                    </div>
                  ))}

                {/* 有查询：结果列表 */}
                {terms.length > 0 &&
                  (results.length > 0 ? (
                    results.map((hit, i) => (
                      <a
                        key={hit.doc.url}
                        href={hit.doc.url}
                        ref={(el) => {
                          resultRefs.current[i] = el;
                        }}
                        role="option"
                        aria-selected={i === active}
                        onClick={close}
                        onPointerEnter={() => setActive(i)}
                        className={`block rounded-xl px-3 py-2.5 transition-colors ${
                          i === active ? 'bg-rose/18' : ''
                        }`}
                      >
                        <span className="block text-sm font-medium text-ink">
                          <Highlight text={hit.doc.title} terms={terms} />
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted">
                          <Highlight text={hit.snippet} terms={terms} />
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-subtle">
                          <span className="tabular-nums">{hit.doc.date}</span>
                          <span aria-hidden="true">·</span>
                          <span>{hit.doc.category}</span>
                          {hit.doc.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded bg-rose/12 px-1.5 py-0.5">
                              #{tag}
                            </span>
                          ))}
                        </span>
                      </a>
                    ))
                  ) : loading ? (
                    <p className="px-3 py-8 text-center text-sm text-subtle">正在翻书架…</p>
                  ) : failed ? (
                    <p className="px-3 py-8 text-center text-sm text-subtle">
                      索引没加载出来，稍后再试一次 ~
                    </p>
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-muted">
                        没有找到「<span className="text-ink">{query.trim()}</span>」
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-subtle">
                        换个短一点的词试试，或者只留关键词（比如把「403 的原因是」换成「403」）
                      </p>
                    </div>
                  ))}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-rose/20 px-4 py-2 text-[0.6875rem] text-subtle">
                <span className="flex items-center gap-2.5">
                  <span className="hidden sm:inline">↑↓ 选择 · ↵ 打开 · Esc 关闭</span>
                  <span className="sm:hidden">点一条打开</span>
                </span>
                <span className="tabular-nums">{hint}</span>
              </div>
            </div>
          </div>
        ) : null,
        document.body,
      )}
    </>
  );
}
