// 分享 / 语录管理（方案 §4.6 + 第 38 条）
//   · link（标题+URL+说明）与 quote（文字+作者）两类统一列表
//   · 增 / 删 / 改 / 排序（上下移动 + 保存）；id 自动生成
//   · 加标签，前台可按标签筛选
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import TagInput from '../components/TagInput.jsx';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CircleAlert,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Save,
  Sparkles,
  Trash,
} from '../icons.js';

const emptyLink = () => ({ type: 'link', id: '', title: '', url: '', note: '', tags: [] });
const emptyQuote = () => ({ type: 'quote', id: '', text: '', author: '', tags: [] });

/**
 * 一类条目的输入区（收藏：标题/链接/说明；语录：内容/作者），两类都带标签输入。
 *
 * ⚠️ 必须放在**组件外面**（模块作用域）。
 * 写在 `Shares()` 里面的话，每次 re-render 都会生成一个新的组件类型，
 * React 会认为「换了一个组件」→ 把整棵子树卸载重建 → **输入框每打一个字就丢焦点**
 * （表现就是「一次只能输入一个字母」）。2026-09-12 用户实测报的正是这个问题。
 */
function TypeFields({ item, onChange, knownTags }) {
  return (
    <div className="form-grid">
      {item.type === 'link' ? (
        <>
          <label className="field">
            <span>标题</span>
            <input className="input" value={item.title} onChange={(e) => onChange({ ...item, title: e.target.value })} placeholder="收藏的东西" />
          </label>
          <label className="field">
            <span>链接</span>
            <input className="input" value={item.url} onChange={(e) => onChange({ ...item, url: e.target.value })} placeholder="https://…" />
          </label>
          <label className="field full">
            <span>说明</span>
            <input className="input" value={item.note} onChange={(e) => onChange({ ...item, note: e.target.value })} placeholder="一句话推荐" />
          </label>
        </>
      ) : (
        <>
          <label className="field full">
            <span>内容</span>
            <textarea className="textarea" rows={2} value={item.text} onChange={(e) => onChange({ ...item, text: e.target.value })} placeholder="一句想留下来的话" />
          </label>
          <label className="field">
            <span>作者 / 出处</span>
            <input className="input" value={item.author ?? ''} onChange={(e) => onChange({ ...item, author: e.target.value })} placeholder="可留空" />
          </label>
        </>
      )}
      <div className="field full">
        <span>标签（前台可按标签筛选）</span>
        <TagInput
          value={item.tags ?? []}
          onChange={(tags) => onChange({ ...item, tags })}
          suggestions={knownTags}
          placeholder="输入后回车，会从用过的标签里提示"
        />
      </div>
    </div>
  );
}

export default function Shares() {
  const [list, setList] = useState([]);
  const [knownTags, setKnownTags] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState('');
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null); // { index, ...item }

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [d, t] = await Promise.all([api.get('/api/shares'), api.get('/api/shares/tags')]);
      setList(d.shares ?? []);
      setKnownTags(t.tags ?? []);
      setDirty(false);
    } catch (err) {
      setError(err.message || '读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mark = (next) => {
    setList(next);
    setDirty(true);
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    mark(next);
  };

  const saveAll = async (nextList = list, okText = '已保存') => {
    setError('');
    setNotice('');
    try {
      const r = await api.put('/api/shares', { shares: nextList });
      setList(r.shares ?? []);
      setKnownTags(r.tags ?? []);
      setDirty(false);
      setNotice(okText);
    } catch (err) {
      setError(err.message || '保存失败');
    }
  };

  const add = async () => {
    const item = draft;
    if (!item) return;
    if (item.type === 'link' && (!item.title.trim() || !item.url.trim())) {
      setError('收藏要填标题和链接');
      return;
    }
    if (item.type === 'quote' && !item.text.trim()) {
      setError('语录要填内容');
      return;
    }
    await saveAll([...list, item], '已添加（id 自动分配）');
    setDraft(null);
    setNewType('');
  };

  const saveEdit = async () => {
    const next = [...list];
    next[editing.index] = { ...editing };
    delete next[editing.index].index;
    await saveAll(next);
    setEditing(null);
  };

  const remove = async (item) => {
    const label = item.type === 'link' ? item.title : item.text.slice(0, 12);
    if (!window.confirm(`把「${label}」移进回收站？（可以恢复）`)) return;
    setError('');
    try {
      const r = await api.post('/api/shares/delete', { id: item.id });
      setList(r.shares ?? []);
      setDirty(false);
      setNotice('已移进回收站');
    } catch (err) {
      setError(err.message || '删除失败');
    }
  };

  return (
    <>
      {error && (
        <div className="alert alert-error" role="alert">
          <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="alert" style={{ background: 'rgba(47,122,85,.12)', border: '1px solid rgba(47,122,85,.3)', color: '#2f7a55' }}>
          <MorphIcon icon={Sparkles} size={15} color="currentColor" />
          <span>{notice}</span>
        </div>
      )}

      <section className="card panel">
        <div className="panel-head">
          <h2>分享 · 语录</h2>
          <div className="spacer" />
          {dirty && <span className="hint"><span className="dirty-dot" />有改动没保存</span>}
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn" onClick={() => { setDraft(emptyLink()); setNewType('link'); }}>
            <MorphIcon icon={Plus} size={15} color="#fff" />
            加收藏
          </button>
          <button type="button" className="btn" onClick={() => { setDraft(emptyQuote()); setNewType('quote'); }}>
            <MorphIcon icon={Plus} size={15} color="#fff" />
            加语录
          </button>
          <button type="button" className="btn" onClick={() => saveAll()} disabled={!dirty}>
            <MorphIcon icon={Save} size={15} color="#fff" />
            保存
          </button>
        </div>

        <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
          顺序就是前台 /share 的展示顺序。带标签的条目在前台可以按标签筛选。
        </p>

        {draft && (
          <div className="inline-box">
            <div className="panel-head" style={{ marginBottom: 10 }}>
              <h2 style={{ fontSize: 15 }}>{draft.type === 'link' ? '加一条收藏' : '加一句语录'}</h2>
            </div>
            <TypeFields item={draft} onChange={setDraft} knownTags={knownTags} />
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={add}>添加</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setDraft(null); setNewType(''); }}>取消</button>
            </div>
          </div>
        )}

        {list.length === 0 ? (
          <div className="empty">还没有内容</div>
        ) : (
          <div className="post-list">
            {list.map((it, i) => (
              <div key={it.id || i} className="post-item" style={{ flexWrap: 'wrap' }}>
                <div className="post-acts">
                  <button type="button" className="iconbtn" title="上移" onClick={() => move(i, -1)} disabled={i === 0}>
                    <MorphIcon icon={ArrowUp} size={15} color="currentColor" />
                  </button>
                  <button type="button" className="iconbtn" title="下移" onClick={() => move(i, 1)} disabled={i === list.length - 1}>
                    <MorphIcon icon={ArrowDown} size={15} color="currentColor" />
                  </button>
                </div>

                <span className="cat-icon">
                  <MorphIcon icon={it.type === 'link' ? BookOpen : Quote} size={16} color="currentColor" spring="snappy" reducedMotion="user" />
                </span>

                <div className="post-main">
                  <div className="post-title">{it.type === 'link' ? it.title : `「${it.text}」`}</div>
                  <div className="post-meta">
                    <span className="mono">{it.id}</span>
                    <span className="sep">·</span>
                    {it.type === 'link' ? it.url : it.author || '佚名'}
                    {(it.tags ?? []).length > 0 && (
                      <>
                        <span className="sep">·</span>
                        {(it.tags ?? []).map((t) => `#${t}`).join(' ')}
                      </>
                    )}
                  </div>
                </div>

                <div className="post-pills">
                  <span className={it.type === 'link' ? 'tag tag-soft' : 'tag tag-rose'}>
                    {it.type === 'link' ? '收藏' : '语录'}
                  </span>
                </div>

                <div className="post-acts">
                  <button
                    type="button"
                    className="iconbtn"
                    title="编辑"
                    onClick={() => setEditing(editing?.index === i ? null : { index: i, ...it })}
                  >
                    <MorphIcon icon={Pencil} size={16} color="currentColor" />
                  </button>
                  <button type="button" className="iconbtn danger" title="删除（进回收站）" onClick={() => remove(it)}>
                    <MorphIcon icon={Trash} size={16} color="currentColor" />
                  </button>
                </div>

                {editing?.index === i && (
                  <div className="inline-box" style={{ flexBasis: '100%' }}>
                    <TypeFields item={editing} onChange={(v) => setEditing({ ...v, index: i })} knownTags={knownTags} />
                    <div className="form-actions" style={{ marginTop: 10 }}>
                      <button type="button" className="btn" onClick={saveEdit}>保存</button>
                      <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button>
                      <div className="spacer" />
                      <span className="hint">类型（收藏/语录）与 id 不给改：换类型请删掉重建</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {dirty && (
          <div className="pager">
            <span>有改动还没保存</span>
            <button type="button" className="btn" onClick={() => saveAll()}>保存</button>
          </div>
        )}
      </section>
    </>
  );
}
