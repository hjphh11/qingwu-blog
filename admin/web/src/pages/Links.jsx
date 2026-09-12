// 友链管理（方案 §4.4 + 第 34 条）
//   · 增 / 删 / 改：name / avatar（远程 URL）/ intro / url
//   · 「是否显示」开关 + 「添加时间」**只在后台可见，前台不受影响**（第 34 条）
//   · 排序用「上下移动按钮 + 保存」（决策 29），不做拖拽
//   · 删除走回收站；不做备注（第 33 条，避免私人信息进公开仓库）
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash,
} from '../icons.js';

const EMPTY = { name: '', avatar: '', intro: '', url: '', visible: true };

/**
 * 表单里的一行输入框。
 *
 * ⚠️ 必须放在**组件外面**（模块作用域）：写在 `Links()` 里面的话，每次 re-render
 * 都会生成一个新的组件类型 → React 把整棵子树卸载重建 → **输入框每打一个字就丢焦点**。
 * （2026-09-12 用户实测：语录/友链的输入框「一次只能输入一个字母」。）
 */
function Field({ label, value, onChange, placeholder, hint }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <span style={{ opacity: 0.6 }}>（{hint}）</span>}
      </span>
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function Links() {
  const [list, setList] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { index, ...item }
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.get('/api/links');
      setList(d.friends ?? []);
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
      const r = await api.put('/api/links', { friends: nextList });
      setList(r.friends ?? []);
      setDirty(false);
      setNotice(okText);
    } catch (err) {
      setError(err.message || '保存失败');
    }
  };

  const addItem = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      setError('名字和链接都要填');
      return;
    }
    // 新增也要经过服务端（会自动补添加时间）
    await saveAll([...list, { ...form }], `已添加「${form.name.trim()}」`);
    setForm(EMPTY);
    setAdding(false);
  };

  const saveEdit = async () => {
    const next = [...list];
    next[editing.index] = {
      name: editing.name,
      avatar: editing.avatar,
      intro: editing.intro,
      url: editing.url,
      visible: editing.visible,
    };
    await saveAll(next, '已保存');
    setEditing(null);
  };

  const remove = async (item) => {
    if (!window.confirm(`把「${item.name}」移进回收站？（可以恢复）`)) return;
    setError('');
    try {
      const r = await api.post('/api/links/delete', { url: item.url });
      setList(r.friends ?? []);
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
          <h2>友链</h2>
          <div className="spacer" />
          {dirty && <span className="hint"><span className="dirty-dot" />有改动没保存</span>}
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn" onClick={() => setAdding((v) => !v)}>
            <MorphIcon icon={Plus} size={15} color="#fff" />
            加友链
          </button>
          <button type="button" className="btn" onClick={() => saveAll()} disabled={!dirty}>
            <MorphIcon icon={Save} size={15} color="#fff" />
            保存
          </button>
        </div>

        <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
          顺序就是前台 /links 的展示顺序。用上下箭头调整后点「保存」。
          「是否显示」与「添加时间」只在后台用，**不影响前台**。
        </p>

        {adding && (
          <div className="inline-box">
            <div className="panel-head" style={{ marginBottom: 10 }}>
              <h2 style={{ fontSize: 15 }}>加一条友链</h2>
            </div>
            <div className="form-grid">
              <Field label="名字" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="对方的站名" />
              <Field label="链接" value={form.url} onChange={(v) => setForm((f) => ({ ...f, url: v }))} placeholder="https://…" />
              <Field label="头像链接" value={form.avatar} onChange={(v) => setForm((f) => ({ ...f, avatar: v }))} hint="远程 URL，不落地" placeholder="https://…/avatar.png" />
              <Field label="一句介绍" value={form.intro} onChange={(v) => setForm((f) => ({ ...f, intro: v }))} placeholder="对方的一句话" />
            </div>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={addItem}>添加</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setAdding(false); setForm(EMPTY); }}>取消</button>
            </div>
          </div>
        )}

        {list.length === 0 ? (
          <div className="empty">还没有友链，点右上角「加友链」</div>
        ) : (
          <div className="post-list">
            {list.map((it, i) => (
              <div key={`${it.url}-${i}`} className="post-item" style={{ flexWrap: 'wrap' }}>
                <div className="post-acts">
                  <button type="button" className="iconbtn" title="上移" onClick={() => move(i, -1)} disabled={i === 0}>
                    <MorphIcon icon={ArrowUp} size={15} color="currentColor" />
                  </button>
                  <button type="button" className="iconbtn" title="下移" onClick={() => move(i, 1)} disabled={i === list.length - 1}>
                    <MorphIcon icon={ArrowDown} size={15} color="currentColor" />
                  </button>
                </div>

                {it.avatar && (
                  <img
                    src={it.avatar}
                    alt=""
                    className="cat-icon"
                    style={{ objectFit: 'cover' }}
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                  />
                )}

                <div className="post-main">
                  <div className="post-title">{it.name}</div>
                  <div className="post-meta">
                    {it.intro || '（没有介绍）'}
                    <span className="sep">·</span>
                    <span className="mono">{it.url}</span>
                    <span className="sep">·</span>
                    {it.addedAt ? `添加于 ${it.addedAt}` : '添加时间未记录'}
                  </div>
                </div>

                <div className="post-pills">
                  {it.visible === false ? (
                    <span className="tag tag-soft">后台隐藏</span>
                  ) : (
                    <span className="tag tag-ok">显示中</span>
                  )}
                </div>

                <div className="post-acts">
                  <button
                    type="button"
                    className="iconbtn"
                    title={it.visible === false ? '恢复显示' : '标记为不显示（只影响后台）'}
                    onClick={() => {
                      const next = [...list];
                      next[i] = { ...it, visible: it.visible === false };
                      mark(next);
                    }}
                  >
                    <MorphIcon icon={it.visible === false ? EyeOff : Eye} size={16} color="currentColor" />
                  </button>
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
                    <div className="form-grid">
                      <Field label="名字" value={editing.name} onChange={(v) => setEditing((s) => ({ ...s, name: v }))} />
                      <Field label="链接" value={editing.url} onChange={(v) => setEditing((s) => ({ ...s, url: v }))} />
                      <Field label="头像链接" value={editing.avatar} onChange={(v) => setEditing((s) => ({ ...s, avatar: v }))} />
                      <Field label="一句介绍" value={editing.intro} onChange={(v) => setEditing((s) => ({ ...s, intro: v }))} />
                    </div>
                    <div className="form-actions" style={{ marginTop: 10 }}>
                      <button type="button" className="btn" onClick={saveEdit}>保存</button>
                      <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button>
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
