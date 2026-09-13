// 关于页管理（方案 §4.7）
// 四块：profile（主页信息）/ info（信息条目）/ emis（爱弥斯）/ contacts（联系方式）
// 每块**独立保存**（后台接口是「部分保存」，没传的块不动）。
// info 与 contacts 的图标用图形化选择器点着选（第 39 条）。
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  ABOUT_ICONS,
  ArrowDown,
  ArrowUp,
  CircleAlert,
  DEFAULT_ABOUT_ICON,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash,
} from '../icons.js';

const IconOf = ({ name, size = 16 }) => (
  <MorphIcon icon={ABOUT_ICONS[name] ?? DEFAULT_ABOUT_ICON} size={size} color="currentColor" reducedMotion="user" />
);

/**
 * 每个区块的标题行（标题 + 提示 + 「有改动」点 + 保存按钮）。
 *
 * ⚠️ 放在**组件外面**（模块作用域）：写在 `About()` 里的话，每次 re-render 都会生成
 * 一个新的组件类型 → React 把整棵子树卸载重建（以后往里加输入框就会踩
 * 「一次只能输入一个字母」那个坑）。
 */
function Head({ title, hint, isDirty, onSave }) {
  return (
    <div className="panel-head">
      <h2>{title}</h2>
      <div className="spacer" />
      {hint && <span className="hint">{hint}</span>}
      {isDirty && (
        <span className="hint">
          <span className="dirty-dot" />
          有改动
        </span>
      )}
      <button type="button" className="btn" onClick={onSave} disabled={!isDirty}>
        <MorphIcon icon={Save} size={15} color="#fff" />
        保存
      </button>
    </div>
  );
}

function IconPicker({ value, onChange }) {
  return (
    <div className="icon-picker">
      {Object.keys(ABOUT_ICONS).map((name) => (
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

export default function About() {
  const [about, setAbout] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState({}); // { profile: true, info: true, ... }
  const [editInfo, setEditInfo] = useState(null);
  const [editContact, setEditContact] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setAbout(await api.get('/api/about'));
      setDirty({});
    } catch (err) {
      setError(err.message || '读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setBlock = (key, value) => {
    setAbout((a) => ({ ...a, [key]: value }));
    setDirty((d) => ({ ...d, [key]: true }));
  };

  const saveBlock = async (key, okText) => {
    setError('');
    setNotice('');
    try {
      const r = await api.put('/api/about', { [key]: about[key] });
      setAbout(r.about);
      setDirty((d) => ({ ...d, [key]: false }));
      setNotice(okText);
    } catch (err) {
      setError(err.message || '保存失败');
    }
  };

  const moveIn = (key, i, dir) => {
    const arr = [...about[key]];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setBlock(key, arr);
  };

  /** 人设段落是嵌在 emis 里的数组，单独一个搬移函数 */
  const movePersona = (i, dir) => {
    const arr = [...about.emis.persona];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setBlock('emis', { ...about.emis, persona: arr });
  };

  if (!about) {
    return (
      <div className="card panel" style={{ textAlign: 'center', color: 'rgba(74,55,40,.55)' }}>
        {error || '正在读取…'}
      </div>
    );
  }

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

      <div className="panel-head" style={{ marginBottom: 0 }}>
        <span className="hint">
          改完每块点它自己的「保存」，之后到「发布」才会上线。
        </span>
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
          <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
          {busy ? '刷新中…' : '重新读取'}
        </button>
      </div>

      {/* ① 主页信息 */}
      <section className="card panel">
        <Head
          title="主页信息"
          isDirty={dirty.profile}
          onSave={() => saveBlock('profile', '「主页信息」已保存')}
        />
        <div className="form-grid">
          <label className="field">
            <span>名字</span>
            <input className="input" value={about.profile.name} onChange={(e) => setBlock('profile', { ...about.profile, name: e.target.value })} />
          </label>
          <label className="field">
            <span>标语</span>
            <input className="input" value={about.profile.tagline} onChange={(e) => setBlock('profile', { ...about.profile, tagline: e.target.value })} />
          </label>
          <label className="field full">
            <span>名字由来</span>
            <textarea className="textarea" rows={2} value={about.profile.whyName} onChange={(e) => setBlock('profile', { ...about.profile, whyName: e.target.value })} />
          </label>
          <label className="field full">
            <span>为什么做博客</span>
            <textarea className="textarea" rows={3} value={about.profile.whyBlog} onChange={(e) => setBlock('profile', { ...about.profile, whyBlog: e.target.value })} />
          </label>
          <label className="field full">
            <span>写什么</span>
            <textarea className="textarea" rows={2} value={about.profile.whatWrite} onChange={(e) => setBlock('profile', { ...about.profile, whatWrite: e.target.value })} />
          </label>
        </div>
      </section>

      {/* ② 信息条目 */}
      <section className="card panel">
        <Head
          title="信息条目"
          hint="图标 / 标签 / 值，可增删排序"
          isDirty={dirty.info}
          onSave={() => saveBlock('info', '「信息条目」已保存')}
        />
        <div className="post-list">
          {about.info.map((it, i) => (
            <div key={i} className="post-item" style={{ flexWrap: 'wrap' }}>
              <div className="post-acts">
                <button type="button" className="iconbtn" title="上移" onClick={() => moveIn('info', i, -1)} disabled={i === 0}>
                  <MorphIcon icon={ArrowUp} size={15} color="currentColor" />
                </button>
                <button type="button" className="iconbtn" title="下移" onClick={() => moveIn('info', i, 1)} disabled={i === about.info.length - 1}>
                  <MorphIcon icon={ArrowDown} size={15} color="currentColor" />
                </button>
              </div>
              <span className="cat-icon"><IconOf name={it.icon} /></span>
              <div className="post-main">
                <div className="post-title">{it.label}</div>
                <div className="post-meta">{it.value}</div>
              </div>
              <div className="post-acts">
                <button type="button" className="iconbtn" title="编辑" onClick={() => setEditInfo(editInfo === i ? null : { index: i, ...it })}>
                  <MorphIcon icon={Pencil} size={16} color="currentColor" />
                </button>
                <button
                  type="button"
                  className="iconbtn danger"
                  title="删除"
                  onClick={() => setBlock('info', about.info.filter((_, k) => k !== i))}
                >
                  <MorphIcon icon={Trash} size={16} color="currentColor" />
                </button>
              </div>
              {editInfo?.index === i && (
                <div className="inline-box" style={{ flexBasis: '100%' }}>
                  <div className="form-grid">
                    <label className="field">
                      <span>标签</span>
                      <input className="input" value={editInfo.label} onChange={(e) => setEditInfo({ ...editInfo, label: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>值</span>
                      <input className="input" value={editInfo.value} onChange={(e) => setEditInfo({ ...editInfo, value: e.target.value })} />
                    </label>
                    <div className="field full">
                      <span>图标</span>
                      <IconPicker value={editInfo.icon} onChange={(icon) => setEditInfo({ ...editInfo, icon })} />
                    </div>
                  </div>
                  <div className="form-actions" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const next = [...about.info];
                        next[i] = { icon: editInfo.icon, label: editInfo.label, value: editInfo.value };
                        setBlock('info', next);
                        setEditInfo(null);
                      }}
                    >
                      应用
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditInfo(null)}>取消</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="form-actions" style={{ marginTop: 12, borderTop: 'none', paddingTop: 0 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setBlock('info', [...about.info, { icon: 'info', label: '新条目', value: '' }]);
              setEditInfo({ index: about.info.length, icon: 'info', label: '新条目', value: '' });
            }}
          >
            <MorphIcon icon={Plus} size={15} color="currentColor" />
            加一条
          </button>
        </div>
      </section>

      {/* ③ 爱弥斯 */}
      <section className="card panel">
        <Head
          title="爱弥斯"
          hint="头像路径 + 人设段落（每段一段）"
          isDirty={dirty.emis}
          onSave={() => saveBlock('emis', '「爱弥斯」已保存')}
        />
        <label className="field">
          <span>头像路径</span>
          <input className="input" value={about.emis.img} onChange={(e) => setBlock('emis', { ...about.emis, img: e.target.value })} placeholder="/images/emis/portrait.png" />
        </label>
        <div className="post-list" style={{ marginTop: 10 }}>
          {about.emis.persona.map((p, i) => (
            <div key={i} className="post-item" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div className="post-acts">
                <button type="button" className="iconbtn" title="上移" onClick={() => movePersona(i, -1)} disabled={i === 0}>
                  <MorphIcon icon={ArrowUp} size={15} color="currentColor" />
                </button>
                <button type="button" className="iconbtn" title="下移" onClick={() => movePersona(i, 1)} disabled={i === about.emis.persona.length - 1}>
                  <MorphIcon icon={ArrowDown} size={15} color="currentColor" />
                </button>
              </div>
              <div className="post-main">
                <textarea
                  className="textarea"
                  rows={3}
                  value={p}
                  onChange={(e) => {
                    const arr = [...about.emis.persona];
                    arr[i] = e.target.value;
                    setBlock('emis', { ...about.emis, persona: arr });
                  }}
                />
              </div>
              <div className="post-acts">
                <button
                  type="button"
                  className="iconbtn danger"
                  title="删除这段"
                  onClick={() => setBlock('emis', { ...about.emis, persona: about.emis.persona.filter((_, k) => k !== i) })}
                >
                  <MorphIcon icon={Trash} size={16} color="currentColor" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="form-actions" style={{ marginTop: 12, borderTop: 'none', paddingTop: 0 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setBlock('emis', { ...about.emis, persona: [...about.emis.persona, ''] })}
          >
            <MorphIcon icon={Plus} size={15} color="currentColor" />
            加一段
          </button>
        </div>
      </section>

      {/* ④ 联系方式 */}
      <section className="card panel">
        <Head
          title="联系方式"
          hint="前台「联系我们」按钮展开的就是这些"
          isDirty={dirty.contacts}
          onSave={() => saveBlock('contacts', '「联系方式」已保存')}
        />
        <div className="post-list">
          {about.contacts.map((c, i) => (
            <div key={i} className="post-item" style={{ flexWrap: 'wrap' }}>
              <div className="post-acts">
                <button type="button" className="iconbtn" title="上移" onClick={() => moveIn('contacts', i, -1)} disabled={i === 0}>
                  <MorphIcon icon={ArrowUp} size={15} color="currentColor" />
                </button>
                <button type="button" className="iconbtn" title="下移" onClick={() => moveIn('contacts', i, 1)} disabled={i === about.contacts.length - 1}>
                  <MorphIcon icon={ArrowDown} size={15} color="currentColor" />
                </button>
              </div>
              <span className="cat-icon"><IconOf name={c.icon} /></span>
              <div className="post-main">
                <div className="post-title">{c.label}</div>
                <div className="post-meta">
                  <span className="tag tag-soft">{c.action === 'copy' ? '点击复制' : '打开链接'}</span>
                  <span className="sep">·</span>
                  {c.value}
                </div>
              </div>
              <div className="post-acts">
                <button type="button" className="iconbtn" title="编辑" onClick={() => setEditContact(editContact === i ? null : { index: i, ...c })}>
                  <MorphIcon icon={Pencil} size={16} color="currentColor" />
                </button>
                <button
                  type="button"
                  className="iconbtn danger"
                  title="删除"
                  onClick={() => setBlock('contacts', about.contacts.filter((_, k) => k !== i))}
                >
                  <MorphIcon icon={Trash} size={16} color="currentColor" />
                </button>
              </div>
              {editContact?.index === i && (
                <div className="inline-box" style={{ flexBasis: '100%' }}>
                  <div className="form-grid">
                    <label className="field">
                      <span>标签</span>
                      <input className="input" value={editContact.label} onChange={(e) => setEditContact({ ...editContact, label: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>点击后</span>
                      <select className="select" value={editContact.action} onChange={(e) => setEditContact({ ...editContact, action: e.target.value })}>
                        <option value="copy">复制内容</option>
                        <option value="link">打开链接</option>
                      </select>
                    </label>
                    <label className="field full">
                      <span>内容</span>
                      <input className="input" value={editContact.value} onChange={(e) => setEditContact({ ...editContact, value: e.target.value })} placeholder={editContact.action === 'copy' ? '要复制的内容' : 'https://…'} />
                    </label>
                    <div className="field full">
                      <span>图标</span>
                      <IconPicker value={editContact.icon} onChange={(icon) => setEditContact({ ...editContact, icon })} />
                    </div>
                  </div>
                  <div className="form-actions" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const next = [...about.contacts];
                        next[i] = { icon: editContact.icon, label: editContact.label, action: editContact.action, value: editContact.value };
                        setBlock('contacts', next);
                        setEditContact(null);
                      }}
                    >
                      应用
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditContact(null)}>取消</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="form-actions" style={{ marginTop: 12, borderTop: 'none', paddingTop: 0 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setBlock('contacts', [...about.contacts, { icon: 'link', label: '新方式', action: 'link', value: '' }]);
              setEditContact({ index: about.contacts.length, icon: 'link', label: '新方式', action: 'link', value: '' });
            }}
          >
            <MorphIcon icon={Plus} size={15} color="currentColor" />
            加一条
          </button>
        </div>
      </section>
    </>
  );
}
