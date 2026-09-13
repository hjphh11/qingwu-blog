// 分类管理（方案 §4.3 + 决策 17 / 29）
//   · 增 / 删 / 改 / 排序（排序用「上下移动按钮 + 保存」，不做拖拽）
//   · 新建**只填中文名**，内部标识自动转拼音
//   · 删分类有**归属保护**：有文章时必须选一个分类转移过去
// 写入 categories.json 后，前台 /blog 的筛选按钮与文章 schema 都会自动跟着变。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  ArrowDown,
  ArrowUp,
  CATEGORY_ICONS,
  CircleAlert,
  DEFAULT_CATEGORY_ICON,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash,
} from '../icons.js';

const IconOf = ({ name, size = 16 }) => (
  <MorphIcon icon={CATEGORY_ICONS[name] ?? DEFAULT_CATEGORY_ICON} size={size} color="currentColor" reducedMotion="user" />
);

/**
 * 图标选择器（一排可点的小方块）。
 *
 * ⚠️ 放在**组件外面**（模块作用域）：写在 `Categories()` 里的话，每次 re-render 都会
 * 生成一个新的组件类型 → React 把整棵子树卸载重建（这里是按钮，不会丢焦点，
 * 但重建本身是浪费，而且以后往里加输入框就会踩「一次只能输入一个字母」那个坑）。
 */
function IconPicker({ value, onChange }) {
  return (
    <div className="icon-picker">
      {Object.keys(CATEGORY_ICONS).map((name) => (
        <button
          type="button"
          key={name}
          className={`chip${value === name ? ' on' : ''}`}
          onClick={() => onChange(name)}
          title={name}
        >
          <IconOf name={name} size={15} />
        </button>
      ))}
    </div>
  );
}

export default function Categories() {
  const [data, setData] = useState(null);
  const [order, setOrder] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: '', icon: 'sparkles' });
  const [idPreview, setIdPreview] = useState('');
  const [editing, setEditing] = useState(null); // {id, label, icon}
  const [deleting, setDeleting] = useState(null); // {id, label, count, moveTo}

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.get('/api/categories');
      setData(d);
      setOrder((d.categories ?? []).map((c) => c.id));
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

  const byId = useMemo(
    () => Object.fromEntries((data?.categories ?? []).map((c) => [c.id, c])),
    [data],
  );
  const total = data?.categories?.length ?? 0;

  const act = async (fn, okText) => {
    setError('');
    setNotice('');
    try {
      await fn();
      if (okText) setNotice(okText);
      await load();
      return true;
    } catch (err) {
      setError(err.message || '操作失败');
      return false;
    }
  };

  // 新建时给个 id 预览（复用 slug 接口的拼音逻辑，只是不带日期前缀）
  useEffect(() => {
    if (!creating) return;
    const t = form.label.trim();
    if (!t) {
      setIdPreview('');
      return;
    }
    const timer = setTimeout(() => {
      api
        .get(`/api/slug?title=${encodeURIComponent(t)}&date=`)
        .then((r) => setIdPreview(r.slug))
        .catch(() => setIdPreview(''));
    }, 300);
    return () => clearTimeout(timer);
  }, [form.label, creating]);

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setDirty(true);
  };

  const saveOrder = () =>
    act(async () => {
      await api.post('/api/categories/reorder', { ids: order });
      setDirty(false);
    }, '顺序已保存，前台筛选按钮会跟着变');

  const create = () =>
    act(async () => {
      const r = await api.post('/api/categories', { label: form.label.trim(), icon: form.icon });
      setForm({ label: '', icon: 'sparkles' });
      setCreating(false);
      return r;
    }, `已新建分类「${form.label.trim()}」`);

  const saveEdit = () =>
    act(async () => {
      await api.put(`/api/categories/${encodeURIComponent(editing.id)}`, {
        label: editing.label.trim(),
        icon: editing.icon,
      });
      setEditing(null);
    }, '已保存');

  const doDelete = () =>
    act(async () => {
      const r = await api.post(`/api/categories/${encodeURIComponent(deleting.id)}/delete`, {
        ...(deleting.count > 0 ? { moveTo: deleting.moveTo } : {}),
      });
      const moved = r.moved ?? 0;
      setDeleting(null);
      return moved;
    }, deleting.count > 0 ? `已把 ${deleting.count} 篇文章转到「${byId[deleting.moveTo]?.label ?? deleting.moveTo}」并删掉分类` : '分类已删除');

  // 删除时「可以转移到哪些分类」= 除了自己以外的全部
  // （⚠️ 不能复用编辑态的变量 —— 删除时它一定是空的，下拉会没选项）
  const deleteTargets = deleting ? order.filter((id) => id !== deleting.id) : [];

  return (
    <>
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
          <h2>分类</h2>
          <div className="spacer" />
          {dirty && <span className="hint"><span className="dirty-dot" />顺序改了还没保存</span>}
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn" onClick={() => setCreating((v) => !v)}>
            <MorphIcon icon={Plus} size={15} color="#fff" />
            新建分类
          </button>
          <button type="button" className="btn" onClick={saveOrder} disabled={!dirty}>
            保存顺序
          </button>
        </div>

        <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
          上下箭头调整顺序，改完点「保存顺序」。
        </p>

        {creating && (
          <div className="inline-box">
            <div className="panel-head" style={{ marginBottom: 10 }}>
              <h2 style={{ fontSize: 15 }}>新建分类（只填中文名，内部标识自动生成）</h2>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>分类名</span>
                <input
                  className="input"
                  value={form.label}
                  placeholder="比如：读书笔记"
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && form.label.trim()) create();
                  }}
                  autoFocus
                />
              </label>
              <div className="field">
                <span>图标</span>
                <IconPicker value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} />
              </div>
              <div className="field">
                <span>内部标识（自动）</span>
                <div className="mono" style={{ padding: '10px 0' }}>
                  {idPreview || <span style={{ opacity: 0.5 }}>按拼音生成</span>}
                </div>
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={create} disabled={!form.label.trim()}>
                创建
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
                取消
              </button>
              <div className="spacer" />
              <span className="hint">标识会写进文章的 frontmatter，建议一眼能认出来</span>
            </div>
          </div>
        )}

        {!data ? (
          <div className="empty">{error ? `读取失败：${error}` : '正在读取…'}</div>
        ) : total === 0 ? (
          <div className="empty">还没有分类，先新建一个</div>
        ) : (
          <div className="post-list">
            {order.map((id, i) => {
              const c = byId[id];
              if (!c) return null;
              const isEditing = editing?.id === id;
              const isDeleting = deleting?.id === id;
              return (
                <div key={id} className="post-item" style={{ flexWrap: 'wrap' }}>
                  <div className="post-acts">
                    <button
                      type="button"
                      className="iconbtn"
                      title="上移"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                    >
                      <MorphIcon icon={ArrowUp} size={15} color="currentColor" />
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      title="下移"
                      onClick={() => move(i, 1)}
                      disabled={i === order.length - 1}
                    >
                      <MorphIcon icon={ArrowDown} size={15} color="currentColor" />
                    </button>
                  </div>

                  <span className="cat-icon" title={c.icon ?? '默认图标'}>
                    <IconOf name={c.icon} />
                  </span>

                  <div className="post-main">
                    <div className="post-title">{c.label}</div>
                    <div className="post-meta">
                      <span className="mono">{c.id}</span>
                      <span className="sep">·</span>
                      {c.count} 篇文章
                      <span className="sep">·</span>
                      顺序 {i + 1}
                    </div>
                  </div>

                  <div className="post-pills">
                    {c.count === 0 && <span className="tag tag-soft">空分类</span>}
                  </div>

                  <div className="post-acts">
                    <button
                      type="button"
                      className="iconbtn"
                      title="改名 / 换图标"
                      onClick={() => {
                        setDeleting(null);
                        setEditing(isEditing ? null : { id, label: c.label, icon: c.icon ?? 'sparkles' });
                      }}
                    >
                      <MorphIcon icon={Pencil} size={16} color="currentColor" />
                    </button>
                    <button
                      type="button"
                      className="iconbtn danger"
                      title="删除"
                      onClick={() => {
                        setEditing(null);
                        if (isDeleting) {
                          setDeleting(null);
                          return;
                        }
                        const targets = order.filter((oid) => oid !== id);
                        setDeleting({
                          id,
                          label: c.label,
                          count: c.count,
                          moveTo: targets[0] ?? '',
                        });
                      }}
                    >
                      <MorphIcon icon={Trash} size={16} color="currentColor" />
                    </button>
                  </div>

                  {isEditing && (
                    <div className="inline-box" style={{ flexBasis: '100%' }}>
                      <div className="form-grid">
                        <label className="field">
                          <span>分类名</span>
                          <input
                            className="input"
                            value={editing.label}
                            onChange={(e) => setEditing((s) => ({ ...s, label: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && editing.label.trim()) saveEdit();
                            }}
                            autoFocus
                          />
                        </label>
                        <div className="field">
                          <span>图标</span>
                          <IconPicker
                            value={editing.icon}
                            onChange={(icon) => setEditing((s) => ({ ...s, icon }))}
                          />
                        </div>
                      </div>
                      <div className="form-actions" style={{ marginTop: 10 }}>
                        <button type="button" className="btn" onClick={saveEdit} disabled={!editing.label.trim()}>
                          保存
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                          取消
                        </button>
                        <div className="spacer" />
                        <span className="hint">
                          内部标识 <span className="mono">{id}</span> 不给改 ——
                          它写在每篇文章的 frontmatter 里，改了要连带重写所有文章
                        </span>
                      </div>
                    </div>
                  )}

                  {isDeleting && (
                    <div className="inline-box danger" style={{ flexBasis: '100%' }}>
                      {deleting.count > 0 ? (
                        <>
                          <div className="alert alert-warn" style={{ marginTop: 0 }}>
                            <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
                            <span>
                              「{deleting.label}」下面还有 <b>{deleting.count}</b> 篇文章 ——
                              请先把它们转到别的分类，再删这个分类。
                            </span>
                          </div>
                          <div className="form-actions" style={{ marginTop: 10, borderTop: 'none', paddingTop: 0 }}>
                            <label className="check" style={{ gap: 8 }}>
                              转到
                              <select
                                className="select"
                                style={{ width: 'auto' }}
                                value={deleting.moveTo}
                                onChange={(e) =>
                                  setDeleting((s) => ({ ...s, moveTo: e.target.value }))
                                }
                              >
                                {deleteTargets.map((oid) => (
                                  <option key={oid} value={oid}>
                                    {byId[oid]?.label ?? oid}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="btn"
                              onClick={doDelete}
                              disabled={!deleting.moveTo}
                            >
                              转移并删除
                            </button>
                            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>
                              取消
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="form-actions" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                          <span>
                            确定删除分类「{deleting.label}」？它下面没有文章，删掉不影响内容。
                          </span>
                          <div className="spacer" />
                          <button type="button" className="btn" onClick={doDelete}>
                            删除
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>
                            取消
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {dirty && (
          <div className="pager">
            <span>顺序改动还没保存</span>
            <button type="button" className="btn" onClick={saveOrder}>
              保存顺序
            </button>
          </div>
        )}
      </section>
    </>
  );
}
