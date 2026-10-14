// 文章编辑器（新建 / 编辑）—— 珍珠玻璃版（方案 §4.2）。
//
// 数据链路与逻辑**与旧暖色版逐行一致**（只换呈现层）：
//   GET  /api/categories · GET /api/tags（分类下拉 + 历史标签建议）
//   GET  /api/articles/:id（编辑时读文章）· GET /api/slug?title&date（新建时按标题生成 slug）
//   POST /api/articles（新建）· PUT /api/articles/:id（保存）
//   「保存」只写进仓库文件；真正上线（git push + Deploy Hook）是发布页的事。
//   另外保留：加载态、错误与成功提示、未保存改动提示（含 beforeunload）、
//   Markdown 工具栏（含包选 / 行首前缀两组逻辑）、实时预览、视图三态、字数统计、
//   Cmd/Ctrl+S / B / I / 1 / 2 快捷键（不抢全局的 Cmd+K）。
//
// 呈现层（组件级）：
//   · 页根 .page + useEntrance()（入场类只能由 state 拼，见 pearl/useEntrance.js）；
//   · 页头 PageHeader —— 「保存 / 返回列表」挪到页头右侧主操作位（与发布页一致）；
//   · 两块 Panel：① 文章信息（Field + TextInput / Select / Switch）② 正文（工具栏 + 两栏）；
//   · 工具栏 10 个 IconButton（原 .toolbar button 的暖色样式弃用）+ 珍珠 Segmented（旧版 3 个 button.on）；
//   · 两栏用 scaffold 现成的 12 栅格 .bento-grid + .bento-half 对半（栏间 18px，见 pearl-local.css §6），
//     单栏态由 .edit-area.is-only-* 收起另一栏（对应旧版 .editwrap.only-edit / .only-view）；
//   · 预览换 MarkdownPreview 的 .md-preview（旧 .md 是暖色排版：14.5 / 22 / 19px + 玫瑰引用块 + 绯红链接）；
//   · 标签输入不再用 components/TagInput.jsx（那套是暖色类名 .tag .tag-rose .input .suggest），
//     改成珍珠的 .perm-chips / .perm-chip + TextInput + .edit-suggest 建议浮层，键盘行为逐条照抄旧组件。
//   · 离开确认走 pearl/ui/confirm.js（不再用 window.confirm）。
// 页面独有的补丁样式（两栏玻璃槽 / 编辑用 textarea / Markdown 预览排版 / 标签建议浮层）都在
// styles/pearl-local.css 第 14 节，并在那里写明「为什么 scaffold 缺这几件」。
// 类名一律走 cls()；页内不再出现 .card / .panel / .btn / .tag / .hint / .alert / .spacer /
// .form-grid / .toolbar / .editor-pane / .preview 这类旧暖色类名。
import { useEffect, useMemo, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import MarkdownPreview from '../components/MarkdownPreview.jsx';
import {
  ArrowLeft,
  Bold,
  CircleAlert,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from '../icons.js';
import { cls } from '../pearl/cls.js';
import { useEntrance } from '../pearl/useEntrance.js';
import Button from '../pearl/ui/Button.jsx';
import { confirm } from '../pearl/ui/confirm.js';
import EmptyState from '../pearl/ui/EmptyState.jsx';
import Field from '../pearl/ui/Field.jsx';
import IconButton from '../pearl/ui/IconButton.jsx';
import PageHeader from '../pearl/ui/PageHeader.jsx';
import Panel from '../pearl/ui/Panel.jsx';
import Segmented from '../pearl/ui/Segmented.jsx';
import Select from '../pearl/ui/Select.jsx';
import Switch from '../pearl/ui/Switch.jsx';
import TextInput from '../pearl/ui/TextInput.jsx';

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

/** 视图三态（旧版是工具栏里 3 个带 .on 的按钮，文案照旧：编辑 / 分栏 / 预览） */
const VIEW_OPTIONS = [
  { label: '编辑', value: 'edit' },
  { label: '分栏', value: 'split' },
  { label: '预览', value: 'view' },
];

export default function ArticleEditor({ id, go }) {
  const ready = useEntrance();

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
  // 标签输入自己的三个状态（对应旧 TagInput 内部的 text / open / active）
  const [tagText, setTagText] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [tagActive, setTagActive] = useState(0);
  const taRef = useRef(null);

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

  // ——— 标签（行为逐条照抄旧 TagInput：回车/逗号加、退格删一个、上下键选建议、Esc 收建议）———
  const tagSuggestions = useMemo(() => {
    const q = tagText.trim().toLowerCase();
    return tags
      .filter((s) => !form.tags.includes(s.name))
      .filter((s) => (q ? String(s.name).toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [tags, form.tags, tagText]);

  const addTag = (raw) => {
    const t = String(raw ?? '').trim();
    if (t && !form.tags.includes(t)) set({ tags: [...form.tags, t] });
    setTagText('');
    setTagActive(0);
  };

  const removeTag = (t) => set({ tags: form.tags.filter((x) => x !== t) });

  const onTagKeyDown = (e) => {
    // 逗号也当分隔符（中文逗号一起收）
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      if (tagOpen && tagSuggestions[tagActive] && (e.key === 'Enter' || !tagText.trim())) {
        addTag(tagSuggestions[tagActive].name);
      } else {
        addTag(tagText);
      }
      return;
    }
    if (e.key === 'Backspace' && !tagText && form.tags.length > 0) {
      e.preventDefault();
      set({ tags: form.tags.slice(0, -1) });
      return;
    }
    if (!tagOpen || tagSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setTagActive((i) => (i + 1) % tagSuggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setTagActive((i) => (i - 1 + tagSuggestions.length) % tagSuggestions.length);
    } else if (e.key === 'Escape') {
      setTagOpen(false);
    }
  };

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

  // 旧版是 window.confirm；珍珠玻璃走统一的确认浮层（文案照旧）
  const backToList = async () => {
    if (dirty) {
      const ok = await confirm({
        title: '离开编辑页',
        message: '有改动还没保存，确定离开吗？',
        confirmText: '离开',
        danger: true,
      });
      if (!ok) return;
    }
    go('posts');
  };

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
  const summaryHint = useMemo(
    () => (form.description.trim() ? '' : '留空会自动取正文开头约 80 字'),
    [form.description],
  );
  // 正文字数（去掉所有空白，与旧版同一个算法）
  const bodyChars = form.body.replace(/\s/g, '').length;
  const categoryOptions = [
    { label: '请选择…', value: '' },
    ...cats.map((c) => ({ label: `${c.id} · ${c.label}`, value: c.id })),
  ];

  if (loading) {
    return (
      <div className={cls('page', ready && 'is-entrance-ready')}>
        <PageHeader title={title} desc="标题 · 分类 · 标签 · 摘要 · 正文（Markdown 实时预览）" />
        <Panel>
          <EmptyState title="正在读取文章…" desc="从仓库里读这篇的 frontmatter 与正文" icon={RefreshCw} />
        </Panel>
      </div>
    );
  }

  return (
    <form className={cls('page', ready && 'is-entrance-ready')} onSubmit={submit}>
      <PageHeader
        title={title}
        desc="标题 · 分类 · 标签 · 摘要 · 正文（Markdown 实时预览）· 保存只写进仓库"
        actions={
          <>
            <Button variant="ghost" icon={ArrowLeft} onClick={backToList}>
              返回列表
            </Button>
            {/* 主操作原来是信息卡底部那排按钮，现在跟发布页一样放在页头右侧 */}
            <Button variant="primary" type="submit" icon={Save} disabled={saving}>
              {saving ? '保存中…' : id ? '保存修改' : '创建文章'}
            </Button>
          </>
        }
      />

      {/* 错误提示：旧版是页面最上方那条 alert-error，文案与 role="alert" 都照旧 */}
      {error && (
        <div
          className={cls('alert-calm', 'reveal')}
          role="alert"
          style={{ background: 'var(--red-soft)', color: 'var(--red-text)', marginBottom: 18 }}
        >
          <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className={cls('alert-calm', 'reveal')} style={{ marginBottom: 18 }}>
          <MorphIcon icon={Sparkles} size={15} color="currentColor" />
          <span>{notice}</span>
        </div>
      )}

      <div className={cls('stack')}>
        {/* ① 文章信息：原来那张 card.panel（标题 / 分类 / 日期 / slug / 标签 / 摘要 / 草稿 / 置顶） */}
        <Panel
          className={cls('reveal')}
          title="文章信息"
          meta={dirty ? '有未保存的改动' : undefined}
          status={dirty ? 'info' : undefined}
        >
          <div className={cls('panel-body')}>
            <div className={cls('form-grid')}>
              <Field label="标题" span>
                <TextInput
                  value={form.title}
                  onChange={(v) => set({ title: v })}
                  placeholder="文章标题"
                  // 阶段 L：新文章直接把光标放到标题上（少点一下，写作更顺）
                  autoFocus={!id}
                />
              </Field>

              <Field label="分类">
                <Select
                  value={form.category}
                  options={categoryOptions}
                  onChange={(v) => set({ category: v })}
                />
              </Field>

              <Field label="发布日期">
                <TextInput type="date" value={form.pubDate} onChange={(v) => set({ pubDate: v })} />
              </Field>

              <Field label="文章地址（slug）">
                <TextInput
                  value={form.slug}
                  onChange={(v) => {
                    setSlugTouched(true);
                    set({ slug: v });
                  }}
                  placeholder="留空会按标题自动生成"
                />
              </Field>

              <Field label="标签" span hint="回车或逗号添加，会从用过的标签里提示（退格删最后一个）">
                <div className={cls('edit-tags')}>
                  {form.tags.length > 0 && (
                    <div className={cls('perm-chips')}>
                      {form.tags.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={cls('perm-chip')}
                          title={`删除标签「${t}」`}
                          aria-label={`删除标签 ${t}`}
                          onClick={() => removeTag(t)}
                        >
                          {t}
                          <MorphIcon icon={X} size={12} color="currentColor" reducedMotion="user" />
                        </button>
                      ))}
                    </div>
                  )}
                  <TextInput
                    value={tagText}
                    onChange={(v) => {
                      setTagText(v);
                      setTagOpen(true);
                      setTagActive(0);
                    }}
                    placeholder="输入标签后回车，会从用过的标签里提示"
                    onKeyDown={onTagKeyDown}
                    onFocus={() => setTagOpen(true)}
                    onBlur={() => setTimeout(() => setTagOpen(false), 150)}
                  />
                  {tagOpen && tagSuggestions.length > 0 && (
                    <div className={cls('edit-suggest', 'm-float')} role="listbox" aria-label="用过的标签">
                      {tagSuggestions.map((s, i) => (
                        <div
                          key={s.name}
                          role="option"
                          aria-selected={i === tagActive}
                          className={cls('select-option', i === tagActive && 'is-active')}
                          onMouseEnter={() => setTagActive(i)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addTag(s.name);
                          }}
                        >
                          <span className={cls('opt-label')}>{s.name}</span>
                          <span className={cls('faint')}>用过 {s.count} 次</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              <Field label="摘要" span hint={summaryHint || undefined}>
                <TextInput
                  multiline
                  rows={2}
                  value={form.description}
                  onChange={(v) => set({ description: v })}
                  placeholder="一句话介绍，会显示在列表和分享卡片上"
                />
              </Field>

              <Field span group>
                <div className={cls('band-tools')}>
                  <Switch
                    checked={form.draft}
                    label="草稿（不展示）"
                    onChange={(v) => set({ draft: v })}
                  />
                  <Switch checked={form.pinned} label="置顶" onChange={(v) => set({ pinned: v })} />
                </div>
              </Field>

              {form.pinned && (
                <Field label="置顶顺序" hint="也可以用列表页的置顶区上下移动">
                  <TextInput
                    type="number"
                    value={form.pinOrder}
                    onChange={(v) => set({ pinOrder: v })}
                    // 只占一小格：顺序是个位数，铺满半栏反而看不清（旧版是 76px 宽的输入框）
                    style={{ maxWidth: 140 }}
                  />
                </Field>
              )}
            </div>
          </div>
        </Panel>

        {/* ② 正文：工具栏 + 两栏（左 Markdown 编辑 / 右实时预览） */}
        <Panel
          className={cls('reveal')}
          title="正文"
          meta={`${bodyChars} 字 · 保存只写进仓库，要「发布」才上线`}
        >
          <div className={cls('panel-body')}>
            {/* 工具栏：左 10 个标记按钮（IconButton），右视图切换（Segmented）。
                旧版是 .toolbar button（玫瑰底 + 暖棕字），已整体弃用。 */}
            <div className={cls('drawer-toolbar')}>
              <div className={cls('band-tools')}>
                {TOOLS.map((t) => (
                  <IconButton key={t.title} icon={t.icon} label={t.title} size={16} onClick={t.fn} />
                ))}
              </div>
              <Segmented
                label="显示方式"
                value={view}
                options={VIEW_OPTIONS}
                onChange={setView}
              />
            </div>

            {/* 两栏：scaffold 的 12 栅格对半（栏间 18px）；单栏态把另一栏 display:none，
                与旧版 .editwrap.only-edit / .only-view 的行为一致 */}
            <div
              className={cls(
                'bento-grid',
                'edit-area',
                view === 'edit' && 'is-only-edit',
                view === 'view' && 'is-only-view',
              )}
            >
              <div className={cls('edit-pane', 'bento-half', 'm-groove')}>
                {/* 编辑框复用珍珠输入外壳（.input-shell.is-multiline），里面是裸 textarea ——
                    工具栏要读写 selectionStart/End，必须拿得到真实 DOM 节点 */}
                <div className={cls('input-shell', 'is-multiline', 'edit-shell')}>
                  <textarea
                    ref={taRef}
                    className={cls('edit-input')}
                    value={form.body}
                    onChange={(e) => set({ body: e.target.value })}
                    placeholder={'正文（Markdown）\n\n## 小标题\n\n写点什么…'}
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className={cls('edit-pane', 'is-preview', 'bento-half', 'm-groove')}>
                <MarkdownPreview source={form.body} className={cls('md-preview')} />
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </form>
  );
}
