// 分享 / 语录管理（方案 §4.6 + 第 38 条）—— 珍珠玻璃版（第 6 页）。
//
// 数据链路与逻辑**与旧暖色版逐行一致**（一行都没动）：
//   GET  /api/shares · GET /api/shares/tags（列表 + 历史标签建议）
//   PUT  /api/shares（全量保存；服务端给新条目分配 id）
//   POST /api/shares/delete（按 id 移进回收站，可恢复）
//   以及：两类条目（link / quote）、标签、上移下移改本地顺序 → dirty → 「保存」才落盘、
//   加条目时的必填校验（收藏要标题+链接 / 语录要内容）、错误与提示文案。
//
// 呈现层（组件级）：
//   · 页根 .page + useEntrance()（入场类只能由 state 拼，见 pearl/useEntrance.js）；
//   · 页头 PageHeader —— 「刷新 / 加收藏 / 加语录 / 保存」放在页头右侧主操作位；
//   · 一块 Panel：正文层放「顺序说明」一行，表格走 DataTable（顺序 / 类型 / 内容 / id / 操作）；
//   · 条目类型用 Tag（收藏=info 蓝、语录=neutral 灰，对应旧 .tag-soft / .tag-rose 的语义色）；
//   · 上移 / 下移 / 编辑 / 删除全部走 IconButton，顺序保存仍是明确的按钮（决策 29，不做拖拽）；
//   · 删除确认走 pearl/ui/confirm.js（不再是 window.confirm）；
//   · 「加收藏 / 加语录 / 编辑条目」沿用上一轮改好的**居中 Modal**，但内容已改成珍珠组件
//     （Field + TextInput），所以不再依赖 pearl-legacy-bridge.css 的 `.modal` 镜像样式
//     （桥接层保留，别的页面还在用）。
//   · 标签输入不再用 components/TagInput.jsx（那套是暖色类名 .tag .tag-rose .input .suggest），
//     改成珍珠的 .perm-chips / .perm-chip + TextInput + .edit-suggest 建议浮层，
//     键盘行为逐条照抄旧组件（回车/逗号加、退格删一个、上下键选建议、Esc 收建议）。
// 类名一律走 cls()；页内不再出现 .card / .panel / .btn / .tag / .hint / .alert / .spacer /
// .form-grid / .post-list / .inline-box / .pager / .iconbtn 这类旧暖色类名。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
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
  X,
} from '../icons.js';
import { cls } from '../pearl/cls.js';
import { useEntrance } from '../pearl/useEntrance.js';
import Button from '../pearl/ui/Button.jsx';
import { confirm } from '../pearl/ui/confirm.js';
import DataTable from '../pearl/ui/DataTable.jsx';
import Field from '../pearl/ui/Field.jsx';
import IconButton from '../pearl/ui/IconButton.jsx';
import Modal from '../pearl/ui/Modal.jsx';
import PageHeader from '../pearl/ui/PageHeader.jsx';
import Panel from '../pearl/ui/Panel.jsx';
import Tag from '../pearl/ui/Tag.jsx';
import TextInput from '../pearl/ui/TextInput.jsx';

const emptyLink = () => ({ type: 'link', id: '', title: '', url: '', note: '', tags: [] });
const emptyQuote = () => ({ type: 'quote', id: '', text: '', author: '', tags: [] });

/** 条目类型的语义标签：收藏是「读过的东西」（蓝），语录是纯文本（灰） */
const KIND = {
  link: { label: '收藏', tone: 'info' },
  quote: { label: '语录', tone: 'neutral' },
};

/** 表格列：顺序（上下移动）/ 类型 / 内容 + 标签 / id / 操作 */
const COLUMNS = [
  { key: 'order', title: '顺序', width: 84, align: 'center' },
  { key: 'kind', title: '类型', width: 72 },
  { key: 'entry', title: '内容', minWidth: 260 },
  { key: 'id', title: 'id', width: 150, className: cls('mono') },
  { key: 'actions', title: '操作', width: 92, className: 'col-actions' },
];

/**
 * 标签输入（珍珠玻璃版）：已选标签是 .perm-chip，输入走 TextInput，
 * 建议浮层复用 .edit-suggest + .select-option（与文章编辑器同一份实现，样式见
 * styles/pearl-local.css 第 14 节）。
 *
 * ⚠️ 与 TypeFields 一样必须放在**组件外面**（模块作用域）：写在别的组件里面的话，
 * 每次 re-render 都会生成一个新的组件类型，React 会卸载重建整棵子树
 * → **输入框每打一个字就丢焦点**（2026-09-12 用户实测报过的 bug）。
 */
function TagField({ value, onChange, suggestions }) {
  // 输入自己管自己的草稿与建议浮层状态，blur 收浮层不会牵动外层的 draft
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // 建议：排掉已选的，按输入过滤，最多 8 条（与旧 TagInput 一致）
  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (suggestions ?? [])
      .filter((s) => !value.includes(s.name))
      .filter((s) => (q ? String(s.name).toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [suggestions, value, text]);

  const add = (raw) => {
    const t = String(raw ?? '').trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setText('');
    setActive(0);
  };

  const remove = (t) => onChange(value.filter((x) => x !== t));

  const onKeyDown = (e) => {
    // 逗号也当分隔符（中文逗号一起收）
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      if (open && filtered[active] && (e.key === 'Enter' || !text.trim())) add(filtered[active].name);
      else add(text);
      return;
    }
    if (e.key === 'Backspace' && !text && value.length > 0) {
      e.preventDefault();
      remove(value[value.length - 1]);
      return;
    }
    if (!open || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={cls('edit-tags')}>
      {value.length > 0 && (
        <div className={cls('perm-chips')}>
          {value.map((t) => (
            <button
              key={t}
              type="button"
              className={cls('perm-chip')}
              title={`删除标签「${t}」`}
              aria-label={`删除标签 ${t}`}
              onClick={() => remove(t)}
            >
              {t}
              <MorphIcon icon={X} size={12} color="currentColor" reducedMotion="user" />
            </button>
          ))}
        </div>
      )}
      <TextInput
        value={text}
        onChange={(v) => {
          setText(v);
          setOpen(true);
          setActive(0);
        }}
        placeholder="输入后回车，会从用过的标签里提示"
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div className={cls('edit-suggest', 'm-float')} role="listbox" aria-label="用过的标签">
          {filtered.map((s, i) => (
            <div
              key={s.name}
              role="option"
              aria-selected={i === active}
              className={cls('select-option', i === active && 'is-active')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                add(s.name);
              }}
            >
              <span className={cls('opt-label')}>{s.name}</span>
              <span className={cls('faint')}>用过 {s.count} 次</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 一类条目的输入区（收藏：标题/链接/说明；语录：内容/作者），两类都带标签输入。
 * 弹窗与「加收藏 / 加语录 / 编辑条目」共用这一份，字段与旧版逐条对应。
 *
 * ⚠️ 必须放在**组件外面**（模块作用域）。
 * 写在 `Shares()` 里面的话，每次 re-render 都会生成一个新的组件类型，
 * React 会认为「换了一个组件」→ 把整棵子树卸载重建 → **输入框每打一个字就丢焦点**
 * （表现就是「一次只能输入一个字母」）。2026-09-12 用户实测报的正是这个问题。
 */
function TypeFields({ item, onChange, knownTags }) {
  return (
    <div className={cls('form-grid')}>
      {item.type === 'link' ? (
        <>
          <Field label="标题" group>
            <TextInput
              value={item.title}
              onChange={(v) => onChange({ ...item, title: v })}
              placeholder="收藏的东西"
            />
          </Field>
          <Field label="链接" group>
            <TextInput
              value={item.url}
              onChange={(v) => onChange({ ...item, url: v })}
              placeholder="https://…"
            />
          </Field>
          <Field label="说明" group span>
            <TextInput
              value={item.note}
              onChange={(v) => onChange({ ...item, note: v })}
              placeholder="一句话推荐"
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="内容" group span>
            <TextInput
              multiline
              rows={2}
              value={item.text}
              onChange={(v) => onChange({ ...item, text: v })}
              placeholder="一句想留下来的话"
            />
          </Field>
          <Field label="作者 / 出处" group>
            <TextInput
              value={item.author ?? ''}
              onChange={(v) => onChange({ ...item, author: v })}
              placeholder="可留空"
            />
          </Field>
        </>
      )}
      <Field label="标签（前台可按标签筛选）" group span>
        <TagField
          value={item.tags ?? []}
          onChange={(tags) => onChange({ ...item, tags })}
          suggestions={knownTags}
        />
      </Field>
    </div>
  );
}

export default function Shares() {
  const ready = useEntrance();

  const [list, setList] = useState([]);
  const [knownTags, setKnownTags] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
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
      return true;
    } catch (err) {
      setError(err.message || '保存失败');
      return false;
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
    const ok = await saveAll([...list, item], '已添加（id 自动分配）');
    // 失败时保留弹窗与已填内容（与旧版一致：错误要看得见、内容不要丢）
    if (!ok) return;
    closeDraft();
  };

  const saveEdit = async () => {
    const next = [...list];
    next[editing.index] = { ...editing };
    delete next[editing.index].index;
    const ok = await saveAll(next);
    if (ok) setEditing(null);
  };

  const remove = async (item) => {
    const label = item.type === 'link' ? item.title : item.text.slice(0, 12);
    // 珍珠玻璃的统一确认浮层（scaffold 的 ConfirmHost），不再是浏览器原生 confirm
    const ok = await confirm({
      title: '移入回收站',
      message: `把「${label}」移进回收站？（可以恢复）`,
      confirmText: '移入回收站',
      danger: true,
    });
    if (!ok) return;
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

  // 关掉「加条目」弹窗（取消 / Esc / 添加成功后都走这里）
  const closeDraft = () => setDraft(null);

  // 数据文件有问题（缺标题或链接，前台渲染会出岔子）→ 红灯；有未保存改动 → 蓝灯；正常 → 青柠
  const brokenCount = list.filter(
    (it) =>
      (it.type === 'link' && (!String(it.title ?? '').trim() || !String(it.url ?? '').trim())) ||
      (it.type === 'quote' && !String(it.text ?? '').trim()),
  ).length;
  const status = brokenCount > 0 ? 'danger' : dirty ? 'info' : 'ok';

  // 提示文案：条数 + 有没有改动（下面那行「顺序 vs 标签筛选」写在面板正文里）
  const panelMeta = [
    `共 ${list.length} 条`,
    brokenCount > 0 ? `${brokenCount} 条内容不完整` : null,
    dirty ? '有改动没保存' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const renderCell = (row, col) => {
    const i = row.gi;
    switch (col.key) {
      case 'order':
        // 顺序列就是唯一的排序入口（没有拖拽，决策 29）
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              icon={ArrowUp}
              label={`上移「${row.label}」`}
              size={16}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            />
            <IconButton
              icon={ArrowDown}
              label={`下移「${row.label}」`}
              size={16}
              disabled={i === list.length - 1}
              onClick={() => move(i, 1)}
            />
          </span>
        );
      case 'kind': {
        const k = KIND[row.type] ?? KIND.quote;
        return <Tag tone={k.tone}>{k.label}</Tag>;
      }
      case 'entry':
        return (
          <span className={cls('cell-main')}>
            <span className={cls('quick-ico', 'm-groove')}>
              <MorphIcon
                icon={row.type === 'link' ? BookOpen : Quote}
                size={16}
                color="currentColor"
                spring="snappy"
                reducedMotion="user"
              />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className={cls('cell-title')}>
                {row.type === 'link' ? row.title : `「${row.text}」`}
              </span>
              <span className={cls('cell-sub', 'ellipsis')}>
                {row.type === 'link' ? row.url : row.author || '佚名'}
                {row.note ? ` · ${row.note}` : ''}
                {(row.tags ?? []).length > 0 ? ` · ${row.tags.map((t) => `#${t}`).join(' ')}` : ''}
              </span>
            </span>
          </span>
        );
      case 'id':
        return <span className={cls('tnum')}>{row.id}</span>;
      case 'actions':
        return (
          <span className={cls('row-actions')}>
            <IconButton
              icon={Pencil}
              label={`编辑「${row.label}」`}
              size={16}
              onClick={() => {
                if (editing?.index === i) {
                  setEditing(null);
                  return;
                }
                // 只带表单要用的字段 + 原下标：类型与 id 不给改（换类型请删掉重建）
                setEditing({
                  index: i,
                  type: row.type,
                  id: row.id,
                  title: row.title,
                  url: row.url,
                  note: row.note,
                  text: row.text,
                  author: row.author,
                  tags: row.tags ?? [],
                });
              }}
            />
            <IconButton
              icon={Trash}
              label={`把「${row.label}」移进回收站（可恢复）`}
              size={16}
              danger
              onClick={() => remove(row)}
            />
          </span>
        );
      default:
        return undefined;
    }
  };

  // 后端给的数组顺序就是前台顺序，所以表格**不开表头排序**：
  // 排序会把行挪位置，而上下移动按钮是按数组下标操作的，一排序就点错行。
  // `gi` 是这一条在整张列表里的下标：上下移动 / 编辑 / 删除全按它定位。
  const rows = list.map((it, i) => ({
    ...it,
    gi: i,
    label: it.type === 'link' ? it.title || '（没写标题）' : String(it.text ?? '').slice(0, 12),
  }));

  return (
    <div className={cls('page', ready && 'is-entrance-ready')}>
      <PageHeader
        title="分享 · 语录"
        desc="收藏（标题 / 链接 / 说明）与语录（内容 / 作者）两类条目 · 顺序就是前台 /share 的展示顺序"
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={load}>
              刷新
            </Button>
            {/* 加收藏 / 加语录：都先关掉可能开着的编辑弹窗，再开自己那个 */}
            <Button
              variant="secondary"
              icon={Plus}
              onClick={() => {
                setEditing(null);
                setDraft(emptyLink());
              }}
            >
              加收藏
            </Button>
            <Button
              variant="secondary"
              icon={Plus}
              onClick={() => {
                setEditing(null);
                setDraft(emptyQuote());
              }}
            >
              加语录
            </Button>
            <Button variant="primary" icon={Save} disabled={!dirty || busy} onClick={() => saveAll()}>
              保存
            </Button>
          </>
        }
      />

      {/* 错误 / 提示：旧版是页面最上方那两条 alert 横条，文案与 role="alert" 都照旧。
          配色与下方间距（18px）沿用文章编辑器 / 发布页同一个写法（横向内距由
          .alert-calm 自己给，不在这里重写）。 */}
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

      <Panel
        className={cls('reveal')}
        title="分享 · 语录"
        meta={panelMeta}
        status={status}
        tools={
          dirty ? (
            <Button variant="primary" size="sm" icon={Save} onClick={() => saveAll()}>
              保存顺序
            </Button>
          ) : null
        }
      >
        {/* 面板正文层：内距由 .panel-body 给（styles/pearl/components.css 的
            `.panel-body { padding: 0 20px 20px }`），表格自己通宽、内距由单元格自带 ——
            两处不叠（pearl-local.css §12 的兜底只补"没有正文层"的情况）。
            paddingTop/paddingBottom 不在这里写死，交给 pearl-local.css §15 的
            `:first-child` 规则 —— 内联样式会压过样式表，迟早跟别处的不一致。 */}
        <div className={cls('panel-body')}>
          <p className={cls('faint')} style={{ margin: 0 }}>
            顺序就是前台 /share 的展示顺序。带标签的条目在前台可以按标签筛选。
          </p>
        </div>

        <DataTable
          columns={COLUMNS}
          data={rows}
          rowKey="gi"
          renderCell={renderCell}
          loading={busy}
          emptyText="还没有内容"
          emptyDesc="点右上角「加收藏」或「加语录」加一条"
          emptyIcon={Plus}
        />
      </Panel>

      {/* 加收藏 / 加语录：居中弹窗（原来是插在列表上方的内联块，
          用户要求改成弹窗）。内容已全部走珍珠组件，Modal 走 portal 也不影响样式。 */}
      <Modal
        open={Boolean(draft)}
        onClose={closeDraft}
        title={draft?.type === 'link' ? '加一条收藏' : '加一句语录'}
        sub={
          draft?.type === 'link'
            ? '标题与链接建议都填 · 保存后前台立刻能看到'
            : '一句想留下来的话；作者 / 出处可留空'
        }
        width={720}
        footer={
          <>
            <Button variant="ghost" onClick={closeDraft}>
              取消
            </Button>
            <Button variant="primary" onClick={add} disabled={busy}>
              添加
            </Button>
          </>
        }
      >
        {draft && <TypeFields item={draft} onChange={setDraft} knownTags={knownTags} />}
      </Modal>

      {/* 编辑条目：同样走居中弹窗（只渲染一次，放在列表外面）。
          类型（收藏 / 语录）与 id 不给改：换类型请删掉重建。 */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={
          editing?.type === 'link'
            ? `编辑收藏「${editing.title || '（没写标题）'}」`
            : '编辑语录'
        }
        sub="类型（收藏 / 语录）与 id 不给改：换类型请删掉重建"
        width={720}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={saveEdit} disabled={busy}>
              保存
            </Button>
          </>
        }
      >
        {editing && (
          <TypeFields
            item={editing}
            onChange={(v) => setEditing((s) => ({ ...v, index: s.index }))}
            knownTags={knownTags}
          />
        )}
      </Modal>
    </div>
  );
}
