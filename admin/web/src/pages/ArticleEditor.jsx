// 文章编辑器：表单 + Markdown 工具栏 + 实时预览（方案 §4.2）
// 「保存」= 写进仓库文件；真正上线（git push + Deploy Hook）是阶段 I 的事。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import MarkdownPreview from '../components/MarkdownPreview.jsx';
import TagInput from '../components/TagInput.jsx';
import {
  ArrowLeft,
  Bold,
  CircleAlert,
  Code,
  Eye,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  Save,
  Sparkles,
} from '../icons.js';

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  title: '',
  slug: '',
  category: '',
  pubDate: today(),
  tags: [],
  description: '',
  draft: true,
  pinned: false,
  pinOrder: null,
  body: '',
};

export default function ArticleEditor({ id, go }) {
  const [form, setForm] = useState(EMPTY);
  const [cats, setCats] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('split'); // split | edit | view
  const [slugTouched, setSlugTouched] = useState(Boolean(id));
  const [dirty, setDirty] = useState(false);
  const taRef = useRef(null);
  const titleRef = useRef(null);

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  // 载入分类 / 历史标签 / 文章
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, t] = await Promise.all([api.get('/api/categories'), api.get('/api/tags')]);
        if (!alive) return;
        setCats(c.categories ?? []);
        setTags(t.tags ?? []);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!id) {
      setForm({ ...EMPTY, category: cats[0]?.id ?? '' });
      setLoading(false);
      setDirty(false);
      setSlugTouched(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .get(`/api/articles/${encodeURIComponent(id)}`)
      .then((a) => {
        if (!alive) return;
        setForm({
          title: a.title,
          slug: a.id,
          category: a.category,
          pubDate: a.pubDateText || today(),
          tags: a.tags,
          description: a.description,
          draft: a.draft,
          pinned: a.pinned,
          pinOrder: a.pinOrder,
          body: a.body,
        });
        setDirty(false);
        setSlugTouched(true);
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 新建时：标题/日期变了自动生成 slug（用户手动改过就不再自动覆盖）
  useEffect(() => {
    if (id || slugTouched) return;
    const t = form.title.trim();
    if (!t) return;
    const timer = setTimeout(async () => {
      try {
        const r = await api.get(
          `/api/slug?title=${encodeURIComponent(t)}&date=${encodeURIComponent(form.pubDate)}`,
        );
        setForm((f) => ({ ...f, slug: r.slug }));
      } catch {
        /* 生成失败就不填，用户自己写 */
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [form.title, form.pubDate, id, slugTouched]);

  // 离开前提醒（只在真的改过时）
  useEffect(() => {
    const handler = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ——— Markdown 工具栏 ———
  const wrapSel = (before, after, placeholder) => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = form.body.slice(s, e) || placeholder;
    const next = `${form.body.slice(0, s)}${before}${sel}${after}${form.body.slice(e)}`;
    set({ body: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };

  const prefixLine = (prefix) => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const lineStart = form.body.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = form.body.indexOf('\n', e);
    if (lineEnd === -1) lineEnd = form.body.length;
    const block = form.body.slice(lineStart, lineEnd) || '内容';
    const prefixed = block
      .split('\n')
      .map((l) => `${prefix}${l}`)
      .join('\n');
    const next = `${form.body.slice(0, lineStart)}${prefixed}${form.body.slice(lineEnd)}`;
    set({ body: next });
    requestAnimationFrame(() => {
      ta.focus();
      // 光标落到这段的**末尾**（不要把整段选起来 —— 否则接着打字会把内容替换掉）
      const caret = lineStart + prefixed.length;
      ta.setSelectionRange(caret, caret);
    });
  };

  const TOOLS = [
    { icon: Bold, title: '加粗', fn: () => wrapSel('**', '**', '加粗文字') },
    { icon: Italic, title: '斜体', fn: () => wrapSel('*', '*', '斜体文字') },
    { icon: Heading1, title: '一级标题', fn: () => prefixLine('# ') },
    { icon: Heading2, title: '二级标题', fn: () => prefixLine('## ') },
    { icon: Quote, title: '引用', fn: () => prefixLine('> ') },
    { icon: List, title: '无序列表', fn: () => prefixLine('- ') },
    { icon: ListOrdered, title: '有序列表', fn: () => prefixLine('1. ') },
    { icon: Code, title: '代码块', fn: () => wrapSel('\n```\n', '\n```\n', '代码') },
    { icon: Link, title: '链接', fn: () => wrapSel('[', '](https://)', '链接文字') },
    { icon: Minus, title: '分割线', fn: () => wrapSel('\n\n---\n\n', '', '') },
  ];

  const submit = async (e) => {
    e?.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    const payload = {
      title: form.title,
      slug: form.slug,
      category: form.category,
      pubDate: form.pubDate,
      tags: form.tags,
      description: form.description,
      draft: form.draft,
      pinned: form.pinned,
      ...(form.pinned && typeof form.pinOrder === 'number' ? { pinOrder: form.pinOrder } : {}),
      body: form.body,
    };
    try {
      if (id) {
        const r = await api.put(`/api/articles/${encodeURIComponent(id)}`, payload);
        setDirty(false);
        setNotice('已保存到仓库（还没发布）');
        if (r.article?.id && r.article.id !== id) go('edit', { id: r.article.id });
      } else {
        const r = await api.post('/api/articles', payload);
        setDirty(false);
        setNotice('已创建（还没发布）');
        go('edit', { id: r.article.id });
      }
    } catch (err) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const backToList = () => {
    if (dirty && !window.confirm('有改动还没保存，确定离开吗？')) return;
    go('posts');
  };

  // 阶段 L：新文章直接把光标放到标题上（少点一下，写作更顺）
  useEffect(() => {
    if (!id) titleRef.current?.focus();
  }, [id]);

  // 阶段 L：写作时的键盘手感（编辑器里最常用的几下）
  //   Cmd/Ctrl+S 保存 · Cmd/Ctrl+B 加粗 · Cmd/Ctrl+I 斜体 · Cmd/Ctrl+1/2 标题
  //   注意：全局的 Cmd+K 是搜索（第 44 条），这里**不抢**它。
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key?.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        submit();
      } else if (k === 'b') {
        e.preventDefault();
        wrapSel('**', '**', '加粗文字');
      } else if (k === 'i') {
        e.preventDefault();
        wrapSel('*', '*', '斜体文字');
      } else if (k === '1' || k === '2') {
        e.preventDefault();
        prefixLine('#'.repeat(Number(k)) + ' ');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = id ? '编辑文章' : '新建文章';
  const excerptHint = useMemo(
    () => (form.description.trim() ? '' : '留空会自动取正文开头约 80 字'),
    [form.description],
  );

  if (loading) {
    return (
      <div className="card panel" style={{ textAlign: 'center', color: 'rgba(74,55,40,.55)' }}>
        正在读取文章…
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {error && (
        <div className="alert alert-error" role="alert">
          <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div
          className="alert"
          style={{ background: 'rgba(47,122,85,.12)', border: '1px solid rgba(47,122,85,.3)', color: '#2f7a55' }}
        >
          <MorphIcon icon={Sparkles} size={15} color="currentColor" />
          <span>{notice}</span>
        </div>
      )}

      <section className="card panel">
        <div className="panel-head">
          <h2>{title}</h2>
          <div className="spacer" />
          {dirty && (
            <span className="hint">
              <span className="dirty-dot" />
              有未保存的改动
            </span>
          )}
        </div>

        <div className="form-grid">
          <label className="field full">
            <span>标题</span>
            <input
              className="input"
              ref={titleRef}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="文章标题"
            />
          </label>

          <label className="field">
            <span>分类</span>
            <select
              className="select"
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
            >
              <option value="">请选择…</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>发布日期</span>
            <input
              className="input"
              type="date"
              value={form.pubDate}
              onChange={(e) => set({ pubDate: e.target.value })}
            />
          </label>

          <label className="field">
            <span>文章地址（slug）</span>
            <input
              className="input"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set({ slug: e.target.value });
              }}
              placeholder="留空会按标题自动生成"
            />
          </label>

          <div className="field full">
            <span>标签</span>
            <TagInput
              value={form.tags}
              onChange={(v) => set({ tags: v })}
              suggestions={tags}
              placeholder="输入标签后回车，会从用过的标签里提示"
            />
          </div>

          <label className="field full">
            <span>
              摘要 {excerptHint && <span style={{ opacity: 0.6 }}>（{excerptHint}）</span>}
            </span>
            <textarea
              className="textarea"
              rows={2}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="一句话介绍，会显示在列表和分享卡片上"
            />
          </label>

          <div className="field full">
            <div className="checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.draft}
                  onChange={(e) => set({ draft: e.target.checked })}
                />
                草稿（不展示）
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(e) => set({ pinned: e.target.checked })}
                />
                置顶
              </label>
              {form.pinned && (
                <label className="check">
                  置顶顺序
                  <input
                    className="input"
                    style={{ width: 76, padding: '5px 10px' }}
                    type="number"
                    min="0"
                    value={form.pinOrder ?? ''}
                    onChange={(e) =>
                      set({ pinOrder: e.target.value === '' ? null : Number(e.target.value) })
                    }
                  />
                  <span className="hint">（也可以用列表页的置顶区上下移动）</span>
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn" disabled={saving}>
            <MorphIcon icon={Save} size={16} color="#fff" />
            {saving ? '保存中…' : id ? '保存修改' : '创建文章'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={backToList}>
            <MorphIcon icon={ArrowLeft} size={16} color="currentColor" />
            返回列表
          </button>
          <div className="spacer" />
          <span className="hint">
            {form.body.replace(/\s/g, '').length} 字 · 保存只写进仓库，要「发布」才上线
          </span>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="toolbar">
          {TOOLS.map((t) => (
            <button type="button" key={t.title} title={t.title} onClick={t.fn}>
              <MorphIcon icon={t.icon} size={16} color="currentColor" />
            </button>
          ))}
          <span className="spacer" />
          <button
            type="button"
            className={view === 'edit' ? 'on' : ''}
            onClick={() => setView('edit')}
            title="只显示编辑"
          >
            编辑
          </button>
          <button
            type="button"
            className={view === 'split' ? 'on' : ''}
            onClick={() => setView('split')}
            title="左右分栏"
          >
            分栏
          </button>
          <button
            type="button"
            className={view === 'view' ? 'on' : ''}
            onClick={() => setView('view')}
            title="只显示预览"
          >
            <MorphIcon icon={Eye} size={15} color="currentColor" /> 预览
          </button>
        </div>
        <div className={`editwrap${view === 'edit' ? ' only-edit' : ''}${view === 'view' ? ' only-view' : ''}`}>
          <div className="editor-pane">
            <textarea
              ref={taRef}
              value={form.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder={'正文（Markdown）\n\n## 小标题\n\n写点什么…'}
              spellCheck={false}
            />
          </div>
          <div className="preview">
            <MarkdownPreview source={form.body} />
          </div>
        </div>
      </section>
    </form>
  );
}
