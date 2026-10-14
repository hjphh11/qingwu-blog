// 关于页管理（方案 §4.7）—— 珍珠玻璃版（第 7 页）。
//
// 数据链路与逻辑**与旧暖色版逐行一致**（一行都没动）：
//   GET /api/about（四块：profile / info / emis / contacts）
//   PUT /api/about（**部分保存**：只提交改动的那一块，没传的块服务端不动）
//   以及：每块各自的「保存」、四块独立的脏标记（{ profile: true, ... }）、
//   信息条目与联系方式的增删排序、图标点选、爱弥斯人设段落的增删排序、
//   错误与提示文案（含页首那句「改完每块点它自己的「保存」，之后到「发布」才会上线」）。
//
// 呈现层（组件级）：
//   · 页根 .page + useEntrance()（入场类只能由 state 拼，见 pearl/useEntrance.js）；
//   · 页头 PageHeader ——「重新读取」放在页头右侧主操作位；
//   · 四块各一个 Panel（主页信息 / 信息条目 / 爱弥斯 / 联系方式）。每块的「保存」按钮
//     留在**它自己那块面板**上（不合并成全局保存）；这块有未保存改动时，面板标题亮蓝灯
//     （status="info"）并在副标题里写「有改动」——对应旧版 Head 里那个 dirty-dot；
//   · 字段一律走珍珠的 Field：标签是 `.field-label`（--ink-muted ≈ 6:1，满足 AA），
//     不再依赖 pearl-legacy-bridge.css 那条 `.field > span:first-child` 兜底规则；
//   · 信息条目 / 联系方式是「一行一条 + 顺序 + 增删」→ DataTable
//     （列：顺序 / 内容 / 操作；内容格复用 .cell-main / .cell-title / .cell-sub
//     与概览页那枚 .quick-ico 玻璃小槽，与分享·语录页同一写法）；
//   · 爱弥斯的人设段落是「几段可编辑文本 + 顺序 + 删」—— 表格的单元格是 nowrap，
//     放不了可编辑段落，所以走 .about-rows / .about-row（styles/pearl-local.css 第 16 节）；
//   ·「加一条 / 编辑」从旧版页内两处内联 `.inline-box` 改成**居中 Modal**（宽 720，
//     与友链申请 / 分享·语录两页同一交互），弹窗内容全是珍珠组件，所以不再依赖桥接层的
//     `.modal` 镜像样式；
//   · 图标选择器保留全部 24 个可选图标与选中态（同名与前台 src/lib/aboutIcons.ts 对齐），
//     复用分类页那套 `.perm-chips` / `.perm-chip.is-on`。
// 类名一律走 cls()；页内不再出现 .card / .panel / .panel-head / .btn / .btn-ghost / .hint /
// .tag / .alert / .spacer / .form-grid / .inline-box / .iconbtn / .field / .input / .textarea /
// .post-list / .post-item 这类旧暖色类名。
//
// 旧版删除条目**本来就不弹确认**（删除只改本地数据、没点「保存」前可以「重新读取」还原），
// 所以本页没有引入 confirm.js，也没有用浏览器原生的确认框 —— 不是漏掉，是旧交互里没这一步。
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
import { cls } from '../pearl/cls.js';
import { useEntrance } from '../pearl/useEntrance.js';
import Button from '../pearl/ui/Button.jsx';
import DataTable from '../pearl/ui/DataTable.jsx';
import EmptyState from '../pearl/ui/EmptyState.jsx';
import Field from '../pearl/ui/Field.jsx';
import IconButton from '../pearl/ui/IconButton.jsx';
import Modal from '../pearl/ui/Modal.jsx';
import PageHeader from '../pearl/ui/PageHeader.jsx';
import Panel from '../pearl/ui/Panel.jsx';
import Select from '../pearl/ui/Select.jsx';
import Tag from '../pearl/ui/Tag.jsx';
import TextInput from '../pearl/ui/TextInput.jsx';

const IconOf = ({ name, size = 16 }) => (
  <MorphIcon icon={ABOUT_ICONS[name] ?? DEFAULT_ABOUT_ICON} size={size} color="currentColor" reducedMotion="user" />
);

/** 面板副标题的拼装：提示 / 条数 / 「有改动」用 ` · ` 连起来（空值自动跳过） */
const metaOf = (...parts) => parts.filter(Boolean).join(' · ');

/** 「点击后」的两种动作（旧版是内联 <option>，文案照旧） */
const CONTACT_ACTIONS = [
  { label: '复制内容', value: 'copy' },
  { label: '打开链接', value: 'link' },
];

/** 信息条目的三列：顺序（上下移动）/ 内容 / 操作 */
const INFO_COLUMNS = [
  { key: 'order', title: '顺序', width: 84, align: 'center' },
  { key: 'entry', title: '条目', minWidth: 260 },
  { key: 'actions', title: '操作', width: 92, className: 'col-actions' },
];

/** 联系方式的三列：顺序 / 方式（标签 + 动作 + 内容）/ 操作 */
const CONTACT_COLUMNS = [
  { key: 'order', title: '顺序', width: 84, align: 'center' },
  { key: 'entry', title: '方式', minWidth: 300 },
  { key: 'actions', title: '操作', width: 92, className: 'col-actions' },
];

/**
 * 每块面板头上的「保存」（旧版 Head 里那个按钮）。
 *
 * ⚠️ 与下面几个小组件一样，必须放在**组件外面**（模块作用域）：写在 `About()` 里的话，
 * 每次 re-render 都会生成一个新的组件类型 → React 把整棵子树卸载重建
 * （以后往里加输入框就会踩「一次只能输入一个字母」那个坑）。
 */
function SaveButton({ isDirty, onSave }) {
  return (
    <Button variant="primary" size="sm" icon={Save} disabled={!isDirty} onClick={onSave}>
      保存
    </Button>
  );
}

/**
 * 图标选择器（一排可点的小圆片），24 个可选图标与选中态照旧。
 *
 * 视觉复用珍珠玻璃的 `.perm-chip`（权限芯片）小圆片：它本来就是「一排可切换的小圆片」，
 * 这里只是换成图标、不要文字（与分类页的图标选择器同一份写法）。
 */
function IconPicker({ value, onChange }) {
  return (
    <div className={cls('perm-chips')}>
      {Object.keys(ABOUT_ICONS).map((name) => (
        <button
          type="button"
          key={name}
          className={cls('perm-chip', value === name && 'is-on')}
          aria-pressed={value === name}
          onClick={() => onChange(name)}
          title={name}
        >
          <IconOf name={name} size={15} />
        </button>
      ))}
    </div>
  );
}

/**
 * 信息条目的三个字段（标签 / 值 / 图标）—— 「加一条」与「编辑」共用这一份，
 * 字段与旧版内联表单逐条对应。必须放在**组件外面**（模块作用域）。
 */
function InfoFields({ item, onChange }) {
  return (
    <div className={cls('form-grid')}>
      <Field label="标签">
        <TextInput value={item.label} onChange={(v) => onChange({ ...item, label: v })} />
      </Field>
      <Field label="值">
        <TextInput value={item.value} onChange={(v) => onChange({ ...item, value: v })} />
      </Field>
      <Field label="图标" group span>
        <IconPicker value={item.icon} onChange={(icon) => onChange({ ...item, icon })} />
      </Field>
    </div>
  );
}

/**
 * 联系方式的四个字段（标签 / 点击后 / 内容 / 图标）—— 「加一条」与「编辑」共用。
 * 「内容」的占位提示跟着「点击后」变（旧版是内联三元），文案照旧。
 */
function ContactFields({ item, onChange }) {
  return (
    <div className={cls('form-grid')}>
      <Field label="标签">
        <TextInput value={item.label} onChange={(v) => onChange({ ...item, label: v })} />
      </Field>
      <Field label="点击后">
        <Select
          value={item.action}
          options={CONTACT_ACTIONS}
          onChange={(v) => onChange({ ...item, action: v })}
        />
      </Field>
      <Field label="内容" span>
        <TextInput
          value={item.value}
          onChange={(v) => onChange({ ...item, value: v })}
          placeholder={item.action === 'copy' ? '要复制的内容' : 'https://…'}
        />
      </Field>
      <Field label="图标" group span>
        <IconPicker value={item.icon} onChange={(icon) => onChange({ ...item, icon })} />
      </Field>
    </div>
  );
}

export default function About() {
  const ready = useEntrance();

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

  // 「加一条」只打开弹窗（预填旧版那两个默认值），点「应用」才追加进数组并打上脏标记，
  // 点「取消」什么也不发生。
  // 注：旧版是点「加一条」就先把默认条目追加进数组（点「取消」也不撤）——那是内联表单的
  // 副产物（内联表单改的是数组里第 index 条，所以必须先塞进去）。改成弹窗后这一步没有
  // 存在意义，把追加挪到「应用」，默认值 / 脏标记 / 保存链路与旧版完全一致。
  const addInfo = () => setEditInfo({ index: null, icon: 'info', label: '新条目', value: '' });

  const addContact = () =>
    setEditContact({ index: null, icon: 'link', label: '新方式', action: 'link', value: '' });

  /** 「应用」= 把弹窗里的字段写回这一块（新增追加到末尾，与旧版的位置一致） */
  const applyInfo = () => {
    const item = { icon: editInfo.icon, label: editInfo.label, value: editInfo.value };
    const next = [...about.info];
    if (editInfo.index == null) next.push(item);
    else next[editInfo.index] = item;
    setBlock('info', next);
    setEditInfo(null);
  };

  const applyContact = () => {
    const item = {
      icon: editContact.icon,
      label: editContact.label,
      action: editContact.action,
      value: editContact.value,
    };
    const next = [...about.contacts];
    if (editContact.index == null) next.push(item);
    else next[editContact.index] = item;
    setBlock('contacts', next);
    setEditContact(null);
  };

  if (!about) {
    return (
      <div className={cls('page', ready && 'is-entrance-ready')}>
        <PageHeader
          title="关于页"
          desc="主页信息 / 信息条目 / 爱弥斯 / 联系方式 —— 改完每块点它自己的「保存」，之后到「发布」才会上线"
        />
        <Panel className={cls('reveal')}>
          {/* 旧版这里是「一块贴着边的占位卡片」，文案照旧（错误优先） */}
          <EmptyState
            title={error || '正在读取…'}
            desc={error ? '点右上角「重新读取」再试一次' : undefined}
            icon={error ? CircleAlert : RefreshCw}
          />
        </Panel>
      </div>
    );
  }

  // 信息条目 / 联系方式的表格行：gi 是这一条在这块数组里的下标，
  // 上下移动 / 编辑 / 删除全按它定位；`name` 只给无障碍标签用（列表里可能没写标签）。
  const infoRows = about.info.map((it, i) => ({ ...it, gi: i, name: it.label || '（没写标签）' }));
  const contactRows = about.contacts.map((c, i) => ({ ...c, gi: i, name: c.label || '（没写标签）' }));

  const renderInfoCell = (row, col) => {
    const i = row.gi;
    switch (col.key) {
      case 'order':
        return (
          <span className={cls('about-row-acts')}>
            <IconButton
              icon={ArrowUp}
              label={`上移「${row.name}」`}
              size={16}
              disabled={i === 0}
              onClick={() => moveIn('info', i, -1)}
            />
            <IconButton
              icon={ArrowDown}
              label={`下移「${row.name}」`}
              size={16}
              disabled={i === about.info.length - 1}
              onClick={() => moveIn('info', i, 1)}
            />
          </span>
        );
      case 'entry':
        return (
          <span className={cls('cell-main')}>
            <span className={cls('quick-ico', 'm-groove')}>
              <IconOf name={row.icon} />
            </span>
            <span className={cls('about-cell')}>
              <span className={cls('cell-title')}>{row.label}</span>
              <span className={cls('cell-sub', 'ellipsis')}>{row.value}</span>
            </span>
          </span>
        );
      case 'actions':
        return (
          <span className={cls('row-actions')}>
            <IconButton
              icon={Pencil}
              label={`编辑「${row.name}」`}
              size={16}
              onClick={() => setEditInfo({ index: i, icon: row.icon, label: row.label, value: row.value })}
            />
            <IconButton
              icon={Trash}
              label={`删除「${row.name}」`}
              size={16}
              danger
              onClick={() => setBlock('info', about.info.filter((_, k) => k !== i))}
            />
          </span>
        );
      default:
        return undefined;
    }
  };

  const renderContactCell = (row, col) => {
    const i = row.gi;
    switch (col.key) {
      case 'order':
        return (
          <span className={cls('about-row-acts')}>
            <IconButton
              icon={ArrowUp}
              label={`上移「${row.name}」`}
              size={16}
              disabled={i === 0}
              onClick={() => moveIn('contacts', i, -1)}
            />
            <IconButton
              icon={ArrowDown}
              label={`下移「${row.name}」`}
              size={16}
              disabled={i === about.contacts.length - 1}
              onClick={() => moveIn('contacts', i, 1)}
            />
          </span>
        );
      case 'entry':
        return (
          <span className={cls('cell-main')}>
            <span className={cls('quick-ico', 'm-groove')}>
              <IconOf name={row.icon} />
            </span>
            <span className={cls('about-cell')}>
              <span className={cls('cell-title')}>{row.label}</span>
              <span className={cls('cell-sub', 'ellipsis')}>
                {/* 旧版 `.tag-soft` 那枚小标签 → 珍珠的 neutral 语义标签 */}
                <Tag tone="neutral">{row.action === 'copy' ? '点击复制' : '打开链接'}</Tag>
                {' · '}
                {row.value}
              </span>
            </span>
          </span>
        );
      case 'actions':
        return (
          <span className={cls('row-actions')}>
            <IconButton
              icon={Pencil}
              label={`编辑「${row.name}」`}
              size={16}
              onClick={() =>
                setEditContact({
                  index: i,
                  icon: row.icon,
                  label: row.label,
                  action: row.action,
                  value: row.value,
                })
              }
            />
            <IconButton
              icon={Trash}
              label={`删除「${row.name}」`}
              size={16}
              danger
              onClick={() => setBlock('contacts', about.contacts.filter((_, k) => k !== i))}
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
        title="关于页"
        desc="主页信息 / 信息条目 / 爱弥斯 / 联系方式 —— 改完每块点它自己的「保存」，之后到「发布」才会上线"
        actions={
          <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={load}>
            {busy ? '刷新中…' : '重新读取'}
          </Button>
        }
      />

      {/* 错误 / 提示：旧版是页面最上方那两条 alert 横条，文案与 role="alert" 都照旧。
          配色沿用文章编辑器 / 分享·语录两页同一个写法（横向内距由 .alert-calm 自己给）；
          与下方面板的间距交给外层 .stack 的 18px，不写内联外边距。 */}
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

        {/* ① 主页信息（旧版 .card.panel + .form-grid 里 5 个 .field） */}
        <Panel
          className={cls('reveal')}
          title="主页信息"
          meta={metaOf(dirty.profile && '有改动')}
          status={dirty.profile ? 'info' : undefined}
          tools={
            <SaveButton
              isDirty={dirty.profile}
              onSave={() => saveBlock('profile', '「主页信息」已保存')}
            />
          }
        >
          {/* 面板内距只用一种：正文层 .panel-body，所以 pearl-local.css 第 12 节的兜底
              不会再叠一层（两处都上的话左右内距会变成 40px）。 */}
          <div className={cls('panel-body')}>
            <div className={cls('form-grid')}>
              <Field label="名字">
                <TextInput
                  value={about.profile.name}
                  onChange={(v) => setBlock('profile', { ...about.profile, name: v })}
                />
              </Field>
              <Field label="标语">
                <TextInput
                  value={about.profile.tagline}
                  onChange={(v) => setBlock('profile', { ...about.profile, tagline: v })}
                />
              </Field>
              <Field label="名字由来" span>
                <TextInput
                  multiline
                  rows={2}
                  value={about.profile.whyName}
                  onChange={(v) => setBlock('profile', { ...about.profile, whyName: v })}
                />
              </Field>
              <Field label="为什么做博客" span>
                <TextInput
                  multiline
                  rows={3}
                  value={about.profile.whyBlog}
                  onChange={(v) => setBlock('profile', { ...about.profile, whyBlog: v })}
                />
              </Field>
              <Field label="写什么" span>
                <TextInput
                  multiline
                  rows={2}
                  value={about.profile.whatWrite}
                  onChange={(v) => setBlock('profile', { ...about.profile, whatWrite: v })}
                />
              </Field>
            </div>
          </div>
        </Panel>

        {/* ② 信息条目（旧版 .post-list，可增删排序 + 图标选择） */}
        <Panel
          className={cls('reveal')}
          title="信息条目"
          meta={metaOf('图标 / 标签 / 值，可增删排序', `共 ${about.info.length} 条`, dirty.info && '有改动')}
          status={dirty.info ? 'info' : undefined}
          tools={
            <>
              <Button variant="secondary" size="sm" icon={Plus} onClick={addInfo}>
                加一条
              </Button>
              <SaveButton isDirty={dirty.info} onSave={() => saveBlock('info', '「信息条目」已保存')} />
            </>
          }
        >
          <DataTable
            columns={INFO_COLUMNS}
            data={infoRows}
            rowKey="gi"
            renderCell={renderInfoCell}
            loading={busy}
            emptyText="还没有信息条目"
            emptyDesc="点右上角「加一条」加一条 —— 前台首页的「关于我」就是这些"
            emptyIcon={Plus}
          />
        </Panel>

        {/* ③ 爱弥斯（头像路径 + 人设段落） */}
        <Panel
          className={cls('reveal')}
          title="爱弥斯"
          meta={metaOf('头像路径 + 人设段落（每段一段）', dirty.emis && '有改动')}
          status={dirty.emis ? 'info' : undefined}
          tools={
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={() => setBlock('emis', { ...about.emis, persona: [...about.emis.persona, ''] })}
              >
                加一段
              </Button>
              <SaveButton isDirty={dirty.emis} onSave={() => saveBlock('emis', '「爱弥斯」已保存')} />
            </>
          }
        >
          <div className={cls('panel-body')}>
            <div className={cls('stack')}>
              <Field label="头像路径">
                <TextInput
                  value={about.emis.img}
                  onChange={(v) => setBlock('emis', { ...about.emis, img: v })}
                  placeholder="/images/emis/portrait.png"
                />
              </Field>

              {/* 人设段落：一行 = 上下移动 + 可编辑段落 + 删除（旧版是 .post-item 里塞 textarea） */}
              <div className={cls('about-rows')}>
                {about.emis.persona.map((p, i) => (
                  <div key={i} className={cls('about-row')}>
                    <span className={cls('about-row-acts')}>
                      <IconButton
                        icon={ArrowUp}
                        label={`第 ${i + 1} 段上移`}
                        size={16}
                        disabled={i === 0}
                        onClick={() => movePersona(i, -1)}
                      />
                      <IconButton
                        icon={ArrowDown}
                        label={`第 ${i + 1} 段下移`}
                        size={16}
                        disabled={i === about.emis.persona.length - 1}
                        onClick={() => movePersona(i, 1)}
                      />
                    </span>
                    <TextInput
                      multiline
                      rows={3}
                      value={p}
                      onChange={(v) => {
                        const arr = [...about.emis.persona];
                        arr[i] = v;
                        setBlock('emis', { ...about.emis, persona: arr });
                      }}
                    />
                    <span className={cls('about-row-acts')}>
                      <IconButton
                        icon={Trash}
                        label={`删除第 ${i + 1} 段`}
                        size={16}
                        danger
                        onClick={() =>
                          setBlock('emis', {
                            ...about.emis,
                            persona: about.emis.persona.filter((_, k) => k !== i),
                          })
                        }
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        {/* ④ 联系方式（旧版 .post-list，可增删排序 + 图标选择 + 点击动作） */}
        <Panel
          className={cls('reveal')}
          title="联系方式"
          meta={metaOf(
            '前台「联系我们」按钮展开的就是这些',
            `共 ${about.contacts.length} 条`,
            dirty.contacts && '有改动',
          )}
          status={dirty.contacts ? 'info' : undefined}
          tools={
            <>
              <Button variant="secondary" size="sm" icon={Plus} onClick={addContact}>
                加一条
              </Button>
              <SaveButton
                isDirty={dirty.contacts}
                onSave={() => saveBlock('contacts', '「联系方式」已保存')}
              />
            </>
          }
        >
          <DataTable
            columns={CONTACT_COLUMNS}
            data={contactRows}
            rowKey="gi"
            renderCell={renderContactCell}
            loading={busy}
            emptyText="还没有联系方式"
            emptyDesc="点右上角「加一条」加一条 —— 前台「联系我们」展开的就是这些"
            emptyIcon={Plus}
          />
        </Panel>
      </div>

      {/* 信息条目的「加一条 / 编辑」：居中弹窗（旧版是插在卡片里的内联 .inline-box，
          与友链 / 分享·语录两页同一交互）。「应用」只改这一块的本地数据并打上脏标记，
          真正落盘还要点「信息条目」面板上的「保存」。 */}
      <Modal
        open={Boolean(editInfo)}
        onClose={() => setEditInfo(null)}
        title={editInfo?.index == null ? '加一条信息条目' : '编辑信息条目'}
        sub="图标 / 标签 / 值 —— 点「应用」只改这一块，还要点面板上的「保存」才落盘"
        width={720}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditInfo(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={applyInfo}>
              应用
            </Button>
          </>
        }
      >
        {editInfo && <InfoFields item={editInfo} onChange={setEditInfo} />}
      </Modal>

      {/* 联系方式的「加一条 / 编辑」：同样走居中弹窗 */}
      <Modal
        open={Boolean(editContact)}
        onClose={() => setEditContact(null)}
        title={editContact?.index == null ? '加一条联系方式' : '编辑联系方式'}
        sub="点击后选「复制内容」就是点击复制，「打开链接」就是新窗口打开 —— 同样要点面板上的「保存」"
        width={720}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditContact(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={applyContact}>
              应用
            </Button>
          </>
        }
      >
        {editContact && <ContactFields item={editContact} onChange={setEditContact} />}
      </Modal>
    </div>
  );
}
