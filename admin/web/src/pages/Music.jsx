// 音乐管理（方案 §4.8 + 第 40 条）
//   · 只改现有 13 首的 title / artist / note / cover（不做新增歌曲、不做音频上传）
//   · 歌词用**时间轴列表**编辑：每行「时间 + 文字」，可改时间/改文字/插行/删行
//   · 排序 = 前台歌单顺序（上下移动 + 保存）
//   · 保存后服务端会**自动重跑 scripts/gen.mjs** 重新生成 src/data/music.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  CircleAlert,
  Eye,
  ListOrdered,
  Music as MusicIcon,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash,
} from '../icons.js';

/** 时间字符串 → 秒（用于「按时间排序」按钮）*/
const toSec = (t) => {
  const m = String(t).match(/^(\d{1,3}):(\d{2}(?:\.\d{1,3})?)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export default function Music() {
  const [songs, setSongs] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null); // 展开哪首歌的编辑器

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.get('/api/music');
      setSongs(d.songs ?? []);
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

  const patch = (id, change) => {
    setSongs((list) => list.map((s) => (s.id === id ? { ...s, ...change } : s)));
    setDirty(true);
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= songs.length) return;
    const next = [...songs];
    [next[i], next[j]] = [next[j], next[i]];
    setSongs(next);
    setDirty(true);
  };

  const save = async () => {
    setError('');
    setNotice('');
    try {
      const r = await api.put('/api/music', { songs });
      setDirty(false);
      setNotice(`已保存 · ${r.regenerated || 'music.ts 已重新生成'}`);
      await load();
    } catch (err) {
      setError(err.message || '保存失败');
    }
  };

  const editing = useMemo(() => songs?.find((s) => s.id === openId) ?? null, [songs, openId]);

  if (!songs) {
    return <div className="card panel" style={{ textAlign: 'center', color: 'rgba(74,55,40,.55)' }}>{error || '正在读取…'}</div>;
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

      <section className="card panel">
        <div className="panel-head">
          <h2>音乐</h2>
          <div className="spacer" />
          {dirty && <span className="hint"><span className="dirty-dot" />有改动没保存</span>}
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn" onClick={save} disabled={!dirty}>
            <MorphIcon icon={Save} size={15} color="#fff" />
            保存并重新生成
          </button>
        </div>

        <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
          顺序就是前台歌单顺序（上下箭头调整）。保存时会<strong>自动重跑 <span className="mono">scripts/gen.mjs</span>
          重新生成 music.ts</strong>。按方案只改现有 {songs.length} 首 —— 不做新增歌曲、不做音频上传。
        </p>

        <div className="post-list">
          {songs.map((s, i) => (
            <div key={s.id} className="post-item" style={{ flexWrap: 'wrap' }}>
              <div className="post-acts">
                <button type="button" className="iconbtn" title="上移" onClick={() => move(i, -1)} disabled={i === 0}>
                  <MorphIcon icon={ListOrdered} size={15} color="currentColor" />
                  <span style={{ fontSize: 10 }}>↑</span>
                </button>
                <button type="button" className="iconbtn" title="下移" onClick={() => move(i, 1)} disabled={i === songs.length - 1}>
                  <span style={{ fontSize: 14 }}>↓</span>
                </button>
              </div>

              {s.cover && (
                <img src={s.cover} alt="" className="cat-icon" style={{ objectFit: 'cover' }}
                     onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              )}

              <div className="post-main">
                <div className="post-title">{s.title}</div>
                <div className="post-meta">
                  <span className="mono">#{i + 1}</span>
                  <span className="sep">·</span>
                  {s.artist || '未知歌手'}
                  {s.note && (<><span className="sep">·</span>{s.note}</>)}
                  <span className="sep">·</span>
                  歌词 {s.lyrics.length} 行
                  {s.extraLines > 0 && `（另有 ${s.extraLines} 行元信息，原样保留不动）`}
                </div>
              </div>

              <div className="post-acts">
                <button
                  type="button"
                  className="iconbtn"
                  title={openId === s.id ? '收起' : '编辑这首歌'}
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}
                >
                  <MorphIcon icon={openId === s.id ? Eye : MusicIcon} size={16} color="currentColor" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {editing && (
        <section className="card panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 17 }}>编辑「{editing.title}」</h2>
            <div className="spacer" />
            <span className="hint mono">{editing.lrcFile || '（没有歌词文件）'}</span>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>标题</span>
              <input className="input" value={editing.title}
                     onChange={(e) => patch(editing.id, { title: e.target.value })} />
            </label>
            <label className="field">
              <span>歌手</span>
              <input className="input" value={editing.artist}
                     onChange={(e) => patch(editing.id, { artist: e.target.value })} />
            </label>
            <label className="field">
              <span>封面路径</span>
              <input className="input" value={editing.cover}
                     onChange={(e) => patch(editing.id, { cover: e.target.value })} />
            </label>
            <label className="field">
              <span>说明</span>
              <input className="input" value={editing.note}
                     onChange={(e) => patch(editing.id, { note: e.target.value })} />
            </label>
          </div>

          <div className="panel-head" style={{ marginTop: 16, marginBottom: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 15 }}>歌词时间轴</h2>
            <div className="spacer" />
            <span className="hint">时间写成 00:28.561；改完点右上角「保存并重新生成」</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                patch(editing.id, {
                  lyrics: [...editing.lyrics].sort((a, b) => toSec(a.time) - toSec(b.time)),
                })
              }
            >
              按时间排序
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => patch(editing.id, { lyrics: [] })}>
              清空歌词
            </button>
          </div>

          <div className="lrc-rows">
            <div className="lrc-row lrc-head">
              <span>时间</span>
              <span>文字</span>
              <span />
            </div>
            {editing.lyrics.map((ln, i) => (
              <div className="lrc-row" key={i}>
                <input
                  className="input"
                  value={ln.time}
                  onChange={(e) => {
                    const next = [...editing.lyrics];
                    next[i] = { ...ln, time: e.target.value };
                    patch(editing.id, { lyrics: next });
                  }}
                />
                <input
                  className="input"
                  value={ln.text}
                  onChange={(e) => {
                    const next = [...editing.lyrics];
                    next[i] = { ...ln, text: e.target.value };
                    patch(editing.id, { lyrics: next });
                  }}
                />
                <div className="lrc-acts">
                  <button
                    type="button"
                    className="iconbtn"
                    title="在这一行下面插一行"
                    onClick={() => {
                      const next = [...editing.lyrics];
                      next.splice(i + 1, 0, { time: ln.time, text: '' });
                      patch(editing.id, { lyrics: next });
                    }}
                  >
                    <MorphIcon icon={Plus} size={15} color="currentColor" />
                  </button>
                  <button
                    type="button"
                    className="iconbtn danger"
                    title="删掉这一行"
                    onClick={() => patch(editing.id, { lyrics: editing.lyrics.filter((_, k) => k !== i) })}
                  >
                    <MorphIcon icon={Trash} size={15} color="currentColor" />
                  </button>
                </div>
              </div>
            ))}
            <div className="form-actions" style={{ marginTop: 10, borderTop: 'none', paddingTop: 0 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  const last = editing.lyrics[editing.lyrics.length - 1];
                  patch(editing.id, { lyrics: [...editing.lyrics, { time: last?.time ?? '00:00.000', text: '' }] });
                }}
              >
                <MorphIcon icon={Plus} size={15} color="currentColor" />
                在末尾加一行
              </button>
              <div className="spacer" />
              <span className="hint">
                共 {editing.lyrics.length} 行
                {editing.extraLines > 0 && ` · 另有 ${editing.extraLines} 行元信息会被原样保留（前台不显示它们）`}
              </span>
            </div>
          </div>
        </section>
      )}

      {dirty && (
        <div className="pager">
          <span>有改动还没保存</span>
          <button type="button" className="btn" onClick={save}>保存并重新生成</button>
        </div>
      )}
    </>
  );
}
