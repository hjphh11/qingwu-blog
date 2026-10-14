// 友链管理（方案 §4.4 + 第 34 条）—— 珍珠玻璃版。
//
// 版式照 Articles.jsx（统一列表页）：页面头 + 主操作 → 表格面板（刷新 / 状态灯）
// → 分页；「顺序调整区」「加一条友链」「编辑这条友链」放在表格上方的整宽区域
// （ListPage 的 before），表格里只留上下移动 / 显示开关 / 编辑 / 删除这些行操作。
//
// ⚠️ 底下这套逻辑与旧暖色版（feat/admin-pearl-shell 之前的 Links.jsx）**完全一致**：
//   · 读 GET /api/links → d.friends 全量替换列表
//   · 增 / 改走 PUT /api/links（全量 friends，服务端补 addedAt）
//   · 删走 POST /api/links/delete（只传 url，进回收站、可恢复）
//   · 上下移动改本地顺序 → dirty → 「保存顺序 / 保存」才落盘（决策 29，不做拖拽）
//   · 「是否显示」只在本页改，前台不受影响（第 34 条）
//   · addedAt“有就显示、没有就写‘添加时间未记录’”（只在后台用）
//   · name / url 必填校验；不做备注（第 33 条）
// 改动只在呈现层与组件复用，没有删掉任何一条旧行为。
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { ArrowDown, ArrowUp, Eye, EyeOff, ExternalLink, Pencil, Plus, RefreshCw, Trash } from '../icons.js';
import { cls } from '../pearl/cls.js';
import { toastError, pushToast } from '../pearl/toast.js';
import Button from '../pearl/ui/Button.jsx';
import { confirm } from '../pearl/ui/confirm.js';
import Field from '../pearl/ui/Field.jsx';
import HoverCard from '../pearl/ui/HoverCard.jsx';
import IconButton from '../pearl/ui/IconButton.jsx';
import ListPage from '../pearl/business/ListPage.jsx';
import Modal from '../pearl/ui/Modal.jsx';
import Panel from '../pearl/ui/Panel.jsx';
import Switch from '../pearl/ui/Switch.jsx';
import Tag from '../pearl/ui/Tag.jsx';
import TextInput from '../pearl/ui/TextInput.jsx';

const EMPTY = { name: '', avatar: '', intro: '', url: '', visible: true };
// 表格字号 13px，一屏能放下 12 行；列表本身不分页（旧版就是一页列出全部），
// 但保留分页控件以便继续复用 ListPage/DataTable 的骨架与「共 N 条」读数。
const PAGE_SIZE = 12;

/** 「添加时间」的兜底文案：旧版对没记录的条目就是写这句话，不要悄悄改成「—」 */
const addedText = (at) => (at ? `添加于 ${at}` : '添加时间未记录');

/** 头像：远程 URL 加载失败就退回首字块（不显示裂图、不占位错位），与旧版 onError 行为一致 */
const AVATAR_SIZE = 28;

function FriendAvatar({ src, name }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);

  // 尺寸写死：珍珠玻璃的 .avatar 只有圆角/对齐，没有宽高（它假定调用方给 size），
  // 而远程头像原图可能是 512×512 —— 不写尺寸会把行高撑开。
  const box = { width: AVATAR_SIZE, height: AVATAR_SIZE, flex: 'none', fontSize: 13 };

  if (!src || broken) {
    return (
      <span className={cls('avatar')} style={box} aria-hidden="true">
        {(name || '?').trim().slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      className={cls('avatar')}
      src={src}
      alt=""
      onError={() => setBroken(true)}
      style={{ ...box, objectFit: 'cover' }}
    />
  );
}

/**
 * 表单里的一行输入框。
 *
 * ⚠️ 必须放在**组件外面**（模块作用域）：写在 `Links()` 里面的话，每次 re-render
 * 都会生成一个新的组件类型 → React 把整棵子树卸载重建 → **输入框每打一个字就丢焦点**。
 * （2026-09-12 用户实测：语录/友链的输入框「一次只能输入一个字母」。）
 *
 * 珍珠玻璃版：Field + TextInput 都是模块作用域的组件，`group` 让 Field 用 div 根节点
 * （TextInput 的 textarea 不能被 label 包裹），label 仍由 Field 渲染。
 */
function FormField({ label, value, onChange, placeholder, hint, wide = false, multiline = false }) {
  return (
    <Field label={label} hint={hint} group wide={wide}>
      <TextInput
        value={value}
        onChange={(v) => onChange(v ?? '')}
        placeholder={placeholder}
        multiline={multiline}
        rows={2}
      />
    </Field>
  );
}

/** 表格式的只读文本格（长 URL / 长介绍在这里自己省略，避免撑破行高） */
function Ellipsis({ text, mono = false, width }) {
  return (
    <span
      className={cls(mono && 'mono')}
      title={text}
      style={{
        display: 'inline-block',
        maxWidth: width,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      {text}
    </span>
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    setNotice('');
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

  // 提示牌：成功/失败都往 toast 堆里推一条，替代旧版表格顶上那两条 alert 横条。
  // error 与 notice 互为「本条状态」，切换时各自清空（旧版也是这么互斥显示的）。
  useEffect(() => {
    if (error) toastError({ message: error }, '操作失败');
  }, [error]);
  useEffect(() => {
    if (notice) pushToast(notice, 'ok');
  }, [notice]);

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
      return true;
    } catch (err) {
      setError(err.message || '保存失败');
      return false;
    }
  };

  const addItem = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      setError('名字和链接都要填');
      return;
    }
    // 新增也要经过服务端（会自动补添加时间）
    const ok = await saveAll([...list, { ...form }], `已添加「${form.name.trim()}」`);
    // 失败时保留输入与面板，不要把人填的内容清掉
    if (!ok) return;
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
    const ok = await saveAll(next, '已保存');
    if (ok) setEditing(null);
  };

  const remove = async (item) => {
    // 珍珠玻璃的确认浮层（scaffold 的 ConfirmHost），不再是浏览器原生 confirm
    const ok = await confirm({
      title: '移入回收站',
      message: `把「${item.name}」移进回收站？之后可以恢复，不会真丢。`,
      confirmText: '移入回收站',
      danger: true,
    });
    if (!ok) return;
    setError('');
    setNotice('');
    try {
      const r = await api.post('/api/links/delete', { url: item.url });
      setList(r.friends ?? []);
      setDirty(false);
      setNotice('已移进回收站');
    } catch (err) {
      setError(err.message || '删除失败');
    }
  };

  const toggleVisible = (i) => {
    const next = [...list];
    next[i] = { ...next[i], visible: next[i].visible === false };
    mark(next);
  };

  // 数据文件有问题（缺名字或链接，前台渲染会出岔子）→ 红灯；有未保存改动 → 蓝灯；正常 → 青柠
  const brokenCount = list.filter((it) => !String(it.name ?? '').trim() || !String(it.url ?? '').trim()).length;
  const status = brokenCount > 0 ? 'danger' : dirty ? 'info' : 'ok';

  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const current = Math.min(page, pageCount);
  // 保持后端给的数组顺序（前台就按这个顺序排），所以表格**不开表头排序**：
  // 排序会把行挪位置，而上下移动按钮是按数组下标操作的，一排序就点错行。
  //
  // `gi` 是这一条在**整张列表**里的下标（不是当前页内下标）：上下移动、编辑、
  // 显示开关全按它定位。DataTable 的 renderCell 只收到行对象，所以随行一起带过去。
  const rows = list.slice((current - 1) * pageSize, current * pageSize).map((it, i) => ({
    ...it,
    gi: (current - 1) * pageSize + i,
  }));

  const columns = [
    { key: 'order', title: '顺序', width: 84, align: 'center' },
    { key: 'friend', title: '友链', minWidth: 220 },
    { key: 'intro', title: '一句介绍', minWidth: 220 },
    { key: 'url', title: '站点地址', width: 220 },
    { key: 'visible', title: '显示', width: 92, align: 'center' },
    { key: 'addedAt', title: '添加时间', width: 132, className: cls('mono') },
    { key: 'actions', title: '操作', width: 112, className: 'col-actions' },
  ];

  const renderCell = (row, col) => {
    const gi = row.gi;
    const last = gi === list.length - 1;
    switch (col.key) {
      case 'order':
        // 顺序列就是唯一的排序入口（没有拖拽，决策 29）
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              icon={ArrowUp}
              label={`上移「${row.name}」`}
              size={16}
              disabled={gi === 0}
              onClick={() => move(gi, -1)}
            />
            <IconButton
              icon={ArrowDown}
              label={`下移「${row.name}」`}
              size={16}
              disabled={last}
              onClick={() => move(gi, 1)}
            />
          </span>
        );
      case 'friend':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, maxWidth: 280 }}>
            <FriendAvatar src={row.avatar} name={row.name} />
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontWeight: 640,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.name}
              </span>
              <span className="faint" style={{ fontSize: 12 }}>
                {row.avatar ? '有头像' : '没头像'}
              </span>
            </span>
          </span>
        );
      case 'intro':
        return row.intro ? (
          <Ellipsis text={row.intro} width="300px" />
        ) : (
          <span className="faint">（没有介绍）</span>
        );
      case 'url':
        // 旧版把地址当纯文本显示；这里可点（外链新窗口打开），悬停能看全
        return (
          <HoverCard
            width={320}
            content={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className={cls('mono')} style={{ fontSize: 13, lineHeight: 1.55, wordBreak: 'break-all' }}>
                  {row.url}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  前台「友链」区按顺序排；点标题会在新窗口打开对方站点
                </div>
              </div>
            }
          >
            <a
              className={cls('link-btn', 'mono')}
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 190 }}
            >
              <MorphIcon icon={ExternalLink} size={14} color="currentColor" reducedMotion="user" />
              <Ellipsis text={row.url.replace(/^https?:\/\//, '')} width="150px" />
            </a>
          </HoverCard>
        );
      case 'visible':
        // 只有开关、文字交给 ariaLabel（表格里塞「显示中」会换行撑高行）
        return (
          <Switch
            checked={row.visible !== false}
            onChange={() => toggleVisible(gi)}
            ariaLabel={`${row.visible === false ? '恢复显示' : '标记为不显示'}「${row.name}」（只影响后台，前台不受影响）`}
          />
        );
      case 'addedAt':
        return row.addedAt ? (
          <span className={cls('tnum')}>{addedText(row.addedAt)}</span>
        ) : (
          <span className="faint">{addedText('')}</span>
        );
      case 'actions':
        return (
          <span style={{ display: 'inline-flex', gap: 2 }}>
            <IconButton
              icon={Pencil}
              label={`编辑「${row.name}」`}
              size={16}
              // 只带表单要用的四个字段 + 原下标：不要把 avatar 之外的字段写回数据文件
              onClick={() => {
                if (editing?.index === gi) {
                  setEditing(null);
                  return;
                }
                setEditing({ index: gi, name: row.name, avatar: row.avatar, intro: row.intro, url: row.url, visible: row.visible });
              }}
            />
            <IconButton
              icon={Trash}
              label={`把「${row.name}」移进回收站（可恢复）`}
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

  const brokenHint = brokenCount > 0 ? `${brokenCount} 条缺名字或链接（数据文件有问题）` : null;

  return (
    <ListPage
      title="友链"
      desc="管理友情链接 · 顺序就是前台的显示顺序"
      actions={
        <>
          <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={load}>
            刷新
          </Button>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setEditing(null);
              setAdding((v) => !v);
            }}
          >
            加友链
          </Button>
          <Button variant="secondary" disabled={!dirty} onClick={() => saveAll()}>
            保存改动
          </Button>
        </>
      }
      tableTitle="友链"
      status={status}
      meta={brokenHint ?? (dirty ? '有改动没保存' : undefined)}
      before={
        <>
          {/* 顺序调整区：唯一的排序入口（上下移动 + 保存，决策 29） */}
          {list.length > 0 && (
            <Panel
              title="顺序调整"
              meta={`前台按这个顺序排 · 共 ${list.length} 条${dirty ? ' · 有改动没保存' : ''}`}
              className="reveal"
              status={dirty ? 'info' : undefined}
              tools={
                <Button variant="primary" size="sm" disabled={!dirty} onClick={() => saveAll()}>
                  保存顺序
                </Button>
              }
            >
              <div className="panel-body" style={{ paddingTop: 4 }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {list.map((it, i) => (
                    <div
                      key={`${it.url}-${i}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '9px 0',
                        borderTop: i === 0 ? 'none' : '1px solid var(--p-line)',
                      }}
                    >
                      <Tag tone="info">#{i + 1}</Tag>
                      <FriendAvatar src={it.avatar} name={it.name} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.name}
                        </div>
                        <div className={cls('mono', 'faint')} style={{ fontSize: 12 }}>
                          {it.url}
                          {it.addedAt ? ` · 添加于 ${it.addedAt}` : ''}
                        </div>
                      </div>
                      <IconButton
                        icon={ArrowUp}
                        label={`上移「${it.name}」`}
                        size={16}
                        bordered
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      />
                      <IconButton
                        icon={ArrowDown}
                        label={`下移「${it.name}」`}
                        size={16}
                        bordered
                        disabled={i === list.length - 1}
                        onClick={() => move(i, 1)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {/* 加一条友链：**居中弹窗**（原来是插在页面中间的内联面板，
              用户指出"应该在中间弹出来输入"）。Modal 走 portal，放在树里哪个位置都不影响。 */}
          {adding && (
            <Modal
              open
              onClose={() => { setAdding(false); setForm(EMPTY); }}
              title="加一条友链"
              sub="名字和链接必填 · 保存后前台立刻能看到"
              width={760}
              footer={
                <>
                  <Button variant="ghost" onClick={() => { setAdding(false); setForm(EMPTY); }}>
                    取消
                  </Button>
                  <Button variant="primary" onClick={addItem}>
                    添加
                  </Button>
                </>
              }
            >
              <div className={cls('form-grid')}>
                <FormField
                  label="名字"
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="对方的站名"
                />
                <FormField
                  label="链接"
                  value={form.url}
                  onChange={(v) => setForm((f) => ({ ...f, url: v }))}
                  placeholder="https://…"
                />
                <FormField
                  label="头像链接"
                  value={form.avatar}
                  onChange={(v) => setForm((f) => ({ ...f, avatar: v }))}
                  hint="远程 URL，不落地"
                  placeholder="https://…/avatar.png"
                />
                <FormField
                  label="一句介绍"
                  value={form.intro}
                  onChange={(v) => setForm((f) => ({ ...f, intro: v }))}
                  placeholder="对方的一句话"
                  wide
                  multiline
                />
              </div>
            </Modal>
          )}

          {/* 编辑这条友链（点行里的铅笔打开）—— 同样改成居中弹窗 */}
          {editing && (
            <Modal
              open
              onClose={() => setEditing(null)}
              title={`编辑「${editing.name || '（没写名字）'}」`}
              sub="显示开关与添加时间只在后台用，前台不受影响"
              width={760}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setEditing(null)}>
                    取消
                  </Button>
                  <Button variant="primary" onClick={saveEdit}>
                    保存
                  </Button>
                </>
              }
            >
              <div className={cls('form-grid')}>
                <FormField
                  label="名字"
                  value={editing.name}
                  onChange={(v) => setEditing((s) => ({ ...s, name: v }))}
                />
                <FormField
                  label="链接"
                  value={editing.url}
                  onChange={(v) => setEditing((s) => ({ ...s, url: v }))}
                />
                <FormField
                  label="头像链接"
                  value={editing.avatar}
                  onChange={(v) => setEditing((s) => ({ ...s, avatar: v }))}
                  hint="远程 URL，不落地"
                />
                <FormField
                  label="一句介绍"
                  value={editing.intro}
                  onChange={(v) => setEditing((s) => ({ ...s, intro: v }))}
                  wide
                  multiline
                />
                <Field label="显示" group hint="只影响后台列表，前台「友链」区不受影响" wide>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Switch
                      checked={editing.visible !== false}
                      onChange={(v) => setEditing((s) => ({ ...s, visible: v }))}
                      ariaLabel="是否在后台显示这条友链（前台不受影响）"
                    />
                    <span className="faint" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <MorphIcon
                        icon={editing.visible !== false ? Eye : EyeOff}
                        size={14}
                        color="currentColor"
                        reducedMotion="user"
                      />
                      {editing.visible !== false ? '后台显示中' : '后台隐藏'}
                    </span>
                  </div>
                </Field>
              </div>
            </Modal>
          )}
        </>
      }
      columns={columns}
      rows={rows}
      rowKey="url"
      renderCell={renderCell}
      loading={busy}
      total={list.length}
      page={current}
      pageSize={pageSize}
      onPage={setPage}
      onPageSize={(n) => {
        setPageSize(n);
        setPage(1);
      }}
      onRefresh={load}
      canExport={false}
      emptyText={list.length === 0 && !busy ? '还没有友链' : '这一页没有友链'}
      emptyDesc={list.length === 0 && !busy ? '点右上角「加友链」加一条' : '回到第一页看看'}
    />
  );
}
