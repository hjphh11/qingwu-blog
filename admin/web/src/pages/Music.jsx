// 音乐管理（方案 §4.8 + 第 40 条）—— 珍珠玻璃版（侧栏最后一个 key）。
//
// 数据链路与逻辑**与旧暖色版逐行一致**（admin/server 一行都没动）：
//   GET /api/music —— 歌曲元数据 + 服务端解析好的歌词行（时间 / 文字 / 原文行 raw）
//   PUT /api/music —— 整表保存（元数据 + 歌词 + 顺序），服务端随后**自动重跑
//   scripts/gen.mjs** 重新生成 src/data/music.ts，把它那次运行的输出原文放在
//   `regenerated` 里回来（成功失败都在里面，旧版就是这么显示的）
//   以及：只改现有歌曲的 title / artist / note / cover（不做新增歌曲、不做音频上传）、
//   上下移动＝前台歌单顺序（点「保存并重新生成」才落盘）、歌词按「时间 + 文字」逐行编辑
//   （改时间 / 改文字 / 在这一行下面插一行 / 删掉这一行 / 按时间排序 / 清空 / 末尾加一行）、
//   行数与「另有 N 行元信息会被原样保留」的读数、错误与提示文案、保存后重新读取。
//
// ⚠️ 歌词行上的 `raw` 不能丢：服务端用 `raw === [时间]文字` 判断这一行改没改过，
//    没改过的行按**原字节**回写（做到「不改就不产生 diff」）。所以改时间 / 改文字
//    一律用 `{ ...ln, time }` 这种展开写法，不要重建行对象。
//
// 呈现层（组件级）：
//   · 页根 .page + useEntrance()（入场类只能由 state 拼，见 pearl/useEntrance.js）；
//   · 页头 PageHeader ——「刷新 / 保存并重新生成」放在页头右侧主操作位；
//   · 一块 Panel「音乐」：正文层放旧版那句顺序说明，列表走 DataTable
//     （顺序 / 歌曲 / 操作三列，**不开表头排序** —— 顺序就是数组顺序）；
//     封面复用概览页那枚 .quick-ico 玻璃小槽 + .quick-img（与友链申请页的头像同一写法），
//     图挂了就露出底下的音符图标；
//   · 「编辑这首歌 + 歌词时间轴」仍是上一轮改好的**居中 Modal**（宽 880），
//     内容全部换成珍珠组件（Field / TextInput / IconButton / Button + SectionLabel），
//     歌词行换成 .lyric-rows / .lyric-head / .lyric-row / .lyric-acts
//     （styles/pearl-local.css 第 22 节），不再依赖兼容皮肤为旧歌词行类名写的那套镜像；
//   · 「清空歌词」是这页唯一的破坏性动作（一次点掉几十行）→ 走珍珠的统一确认浮层
//     （pearl/ui/confirm.js），确认文案里写明「还没保存、点刷新可以还原」；
//   · 提示：成功 pushToast + 页内横条，失败 toastError + 页内横条。两边都留一份的理由：
//     失败要留在屏幕上看得见，而 gen.mjs 的输出可能是多行，toast 是定高的装不下。
// 类名一律走 cls()；页内不再出现旧暖色那一整套类名（卡片 / 面板头 / 暖色按钮 / 提示行 /
// 标签 / 告警横条 / 撑开块 / 表单栅格 / 帖子列表行 / 旧歌词行 / 图标按钮 / 底部分页条 /
// 输入框外壳 / 空态）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Music as MusicIcon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash,
} from '../icons.js';
import { cls } from '../pearl/cls.js';
import { pushToast, toastError } from '../pearl/toast.js';
import { useEntrance } from '../pearl/useEntrance.js';
import Button from '../pearl/ui/Button.jsx';
import { confirm } from '../pearl/ui/confirm.js';
import DataTable from '../pearl/ui/DataTable.jsx';
import EmptyState from '../pearl/ui/EmptyState.jsx';
import Field from '../pearl/ui/Field.jsx';
import IconButton from '../pearl/ui/IconButton.jsx';
import Modal from '../pearl/ui/Modal.jsx';
import PageHeader from '../pearl/ui/PageHeader.jsx';
import Panel from '../pearl/ui/Panel.jsx';
import SectionLabel from '../pearl/ui/SectionLabel.jsx';
import TextInput from '../pearl/ui/TextInput.jsx';

/** 时间字符串 → 秒（用于「按时间排序」按钮）*/
const toSec = (t) => {
  const m = String(t).match(/^(\d{1,3}):(\d{2}(?:\.\d{1,3})?)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** 页头说明：与侧栏里这一页的说明同一句（旧版没有页头，这句原来挂在导航上） */
const PAGE_DESC = '改歌曲信息与歌词时间轴 · 保存后自动重生成 music.ts';

/** 表格列：顺序（上下移动）/ 歌曲（封面 + 标题 + 元信息）/ 操作 */
const COLUMNS = [
  { key: 'order', title: '顺序', width: 84, align: 'center' },
  { key: 'song', title: '歌曲', minWidth: 320 },
  { key: 'actions', title: '操作', width: 72, className: 'col-actions' },
];

/**
 * 歌曲封面：盖在那枚音符图标上（图挂了就藏掉它、露出图标兜底）。
 * 旧版是 onError 里直接改 img 的 visibility，这里换成一份「加载失败」state —— 同一效果，
 * 但不手改 DOM。类名与友链申请页的头像完全相同（.quick-ico / .quick-img，
 * 见 styles/pearl-local.css 第 18 节）。
 *
 * ⚠️ 与下面几个小组件一样必须放在**组件外面**（模块作用域）：写在 `Music()` 里的话，
 * 每次 re-render 都会生成一个新的组件类型 → React 卸载重建整棵子树
 * （输入框会「每打一个字就丢焦点」）。
 */
function SongCover({ url }) {
  const [broken, setBroken] = useState(false);
  const show = Boolean(url) && !broken;

  return (
    <span className={cls('quick-ico', 'm-groove')}>
      <MorphIcon icon={MusicIcon} size={16} color="currentColor" reducedMotion="user" />
      {show && <img className={cls('quick-img')} src={url} alt="" loading="lazy" onError={() => setBroken(true)} />}
    </span>
  );
}

export default function Music() {
  const ready = useEntrance();

  const [songs, setSongs] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null); // 开着哪首歌的编辑弹窗

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.get('/api/music');
      setSongs(d.songs ?? []);
      setDirty(false);
    } catch (err) {
      setError(err.message || '读取失败');
      toastError(err, '读取失败');
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
      // gen.mjs 的输出原文留在页内横条里（可能多行），toast 只报一句「已保存」
      pushToast('已保存');
      await load();
    } catch (err) {
      setError(err.message || '保存失败');
      toastError(err, '保存失败');
    }
  };

  const editing = useMemo(() => songs?.find((s) => s.id === openId) ?? null, [songs, openId]);

  // ——— 歌词时间轴的四个动作（旧版都是内联箭头函数，逻辑一行没动，只是搬了个地方）———
  const sortLyrics = () =>
    patch(editing.id, {
      lyrics: [...editing.lyrics].sort((a, b) => toSec(a.time) - toSec(b.time)),
    });

  const insertLine = (i) => {
    const next = [...editing.lyrics];
    next.splice(i + 1, 0, { time: editing.lyrics[i].time, text: '' });
    patch(editing.id, { lyrics: next });
  };

  const removeLine = (i) => patch(editing.id, { lyrics: editing.lyrics.filter((_, k) => k !== i) });

  const appendLine = () => {
    const last = editing.lyrics[editing.lyrics.length - 1];
    patch(editing.id, { lyrics: [...editing.lyrics, { time: last?.time ?? '00:00.000', text: '' }] });
  };

  // 清空是唯一「一下点掉几十行」的动作 → 走珍珠玻璃的统一确认浮层（ConfirmHost）
  const clearLyrics = async () => {
    const ok = await confirm({
      title: '清空这首歌的歌词',
      message:
        `「${editing.title}」的 ${editing.lyrics.length} 行歌词会全部清掉（元信息行不受影响）。`
        + '这一步只改眼前的草稿 —— 只要还没点「保存并重新生成」，点「刷新」就能还原。',
      confirmText: '清空',
      danger: true,
    });
    if (!ok) return;
    patch(editing.id, { lyrics: [] });
  };

  if (!songs) {
    return (
      <div className={cls('page', ready && 'is-entrance-ready')}>
        <PageHeader title="音乐" desc={PAGE_DESC} />
        <Panel className={cls('reveal')}>
          {/* 旧版这里是「一块贴着边的占位卡片」，文案照旧（错误优先） */}
          <EmptyState title={error || '正在读取…'} icon={error ? CircleAlert : RefreshCw} />
        </Panel>
      </div>
    );
  }

  // `gi` 是这一首在整个歌单里的下标：上下移动 / 编辑全按它定位。
  // 表格**不开表头排序**：后端给的数组顺序就是前台顺序，一排序就会点错行（同分享·语录页）。
  const rows = songs.map((s, i) => ({ ...s, gi: i }));

  const renderCell = (row, col) => {
    const i = row.gi;
    switch (col.key) {
      case 'order':
        return (
          <span className={cls('music-order')}>
            <IconButton
              icon={ArrowUp}
              label="上移"
              size={16}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            />
            <IconButton
              icon={ArrowDown}
              label="下移"
              size={16}
              disabled={i === songs.length - 1}
              onClick={() => move(i, 1)}
            />
          </span>
        );
      case 'song':
        return (
          <span className={cls('cell-main')}>
            <SongCover url={row.cover} />
            <span className={cls('music-cell')}>
              <span className={cls('cell-title')}>{row.title}</span>
              <span className={cls('cell-sub', 'ellipsis')}>
                <span className={cls('p-mono')}>#{i + 1}</span>
                {' · '}
                {row.artist || '未知歌手'}
                {row.note && ` · ${row.note}`}
                {' · '}
                歌词 {row.lyrics.length} 行
                {row.extraLines > 0 && `（另有 ${row.extraLines} 行元信息，原样保留不动）`}
              </span>
            </span>
          </span>
        );
      case 'actions':
        return (
          <span className={cls('row-actions')}>
            <IconButton
              icon={Pencil}
              label={openId === row.id ? '收起' : '编辑这首歌'}
              size={16}
              onClick={() => setOpenId(openId === row.id ? null : row.id)}
            />
          </span>
        );
      default:
        return undefined;
    }
  };

  return (
    <div className={cls('page', ready && 'is-entrance-ready')}>
      <PageHeader
        title="音乐"
        desc={PAGE_DESC}
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={load}>
              {busy ? '刷新中…' : '刷新'}
            </Button>
            <Button variant="primary" icon={Save} disabled={!dirty} onClick={save}>
              保存并重新生成
            </Button>
          </>
        }
      />

      {/* 错误 / 提示：旧版是页面最上方那两条横条，文案与 role="alert" 都照旧。
          与下面面板的间距交给外层 .stack 的 18px，不写内联外边距。 */}
      <div className={cls('stack')}>
        {error && (
          <div
            className={cls('alert-calm', 'reveal')}
            role="alert"
            style={{ background: 'var(--red-soft)', color: 'var(--red-text)' }}
          >
            <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
            <span>{error}</span>
          </div>
        )}
        {notice && !error && (
          <div className={cls('alert-calm', 'reveal')}>
            <MorphIcon icon={Sparkles} size={15} color="currentColor" />
            <span>{notice}</span>
          </div>
        )}

        <Panel
          className={cls('reveal')}
          title="音乐"
          meta={dirty ? '有改动没保存' : undefined}
          status={dirty ? 'info' : 'ok'}
        >
          {/* 面板正文层：内距由 .panel-body 给，列表自己通宽、内距由单元格自带 ——
              两处不叠（pearl-local.css 第 12 节的兜底只补「没有正文层」的情况）。 */}
          <div className={cls('panel-body')}>
            <p className={cls('music-note')}>
              上下箭头调整前台显示顺序。共 {songs.length} 首；保存后自动同步到站点。
            </p>
          </div>

          <DataTable
            columns={COLUMNS}
            data={rows}
            rowKey="id"
            renderCell={renderCell}
            loading={busy}
            emptyText="歌单是空的"
            emptyDesc="在仓库的 src/data/music.json 里加一首歌（再放好封面与歌词），这里就能编辑了"
            emptyIcon={MusicIcon}
          />
        </Panel>
      </div>

      {editing && (
        /* 编辑条目 + 歌词时间轴：原来是一整块插在页面里的内联面板，上一轮改成居中弹窗
           （宽 880，够放时间 + 文字两列歌词），这一轮把内容整体换成珍珠组件。
           关闭：右上角的 X / 底部的「关闭」/ Esc（Modal 自己处理），都走 setOpenId(null)。 */
        <Modal
          open
          onClose={() => setOpenId(null)}
          title={`编辑「${editing.title}」`}
          sub={editing.lrcFile || '（没有歌词文件）'}
          width={880}
          footer={
            <Button variant="ghost" onClick={() => setOpenId(null)}>
              关闭
            </Button>
          }
        >
          <div className={cls('form-grid')}>
            <Field label="标题">
              <TextInput value={editing.title} onChange={(v) => patch(editing.id, { title: v })} />
            </Field>
            <Field label="歌手">
              <TextInput value={editing.artist} onChange={(v) => patch(editing.id, { artist: v })} />
            </Field>
            <Field label="封面路径">
              <TextInput value={editing.cover} onChange={(v) => patch(editing.id, { cover: v })} />
            </Field>
            <Field label="说明">
              <TextInput value={editing.note} onChange={(v) => patch(editing.id, { note: v })} />
            </Field>
          </div>

          {/* 歌词时间轴：小标题 + 提示 + 两个工具一行，下面是逐行的「时间 + 文字 + 行内按钮」 */}
          <div className={cls('lyric-bar')}>
            <SectionLabel title="歌词时间轴" />
            <span className={cls('lyric-tip')}>时间写成 00:28.561；改完点右上角「保存并重新生成」</span>
            <span className={cls('lyric-bar-acts')}>
              <Button variant="secondary" size="sm" onClick={sortLyrics}>
                按时间排序
              </Button>
              <Button variant="secondary" size="sm" onClick={clearLyrics}>
                清空歌词
              </Button>
            </span>
          </div>

          {/* 三列固定宽度（时间 116 / 文字自适应 / 按钮 72）：各行对得齐，
              按钮槽够放两个 32px 的图标按钮（32 + 2 + 32 = 66 < 72）。
              行按 index 做 key —— 与旧版一致：插行 / 删行后焦点落在同一格上。 */}
          <div className={cls('lyric-rows')}>
            <div className={cls('lyric-head')}>
              <span>时间</span>
              <span>文字</span>
              <span />
            </div>
            {editing.lyrics.map((ln, i) => (
              <div className={cls('lyric-row')} key={i}>
                <TextInput
                  value={ln.time}
                  onChange={(v) => {
                    const next = [...editing.lyrics];
                    next[i] = { ...ln, time: v };
                    patch(editing.id, { lyrics: next });
                  }}
                />
                <TextInput
                  value={ln.text}
                  onChange={(v) => {
                    const next = [...editing.lyrics];
                    next[i] = { ...ln, text: v };
                    patch(editing.id, { lyrics: next });
                  }}
                />
                <span className={cls('lyric-acts')}>
                  <IconButton
                    icon={Plus}
                    label="在这一行下面插一行"
                    size={16}
                    onClick={() => insertLine(i)}
                  />
                  <IconButton
                    icon={Trash}
                    label="删掉这一行"
                    size={16}
                    danger
                    onClick={() => removeLine(i)}
                  />
                </span>
              </div>
            ))}
          </div>

          <div className={cls('lyric-foot')}>
            <Button variant="secondary" size="sm" icon={Plus} onClick={appendLine}>
              在末尾加一行
            </Button>
            <span className={cls('lyric-total')}>
              共 {editing.lyrics.length} 行
              {editing.extraLines > 0 && ` · 另有 ${editing.extraLines} 行元信息会被原样保留（前台不显示它们）`}
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
