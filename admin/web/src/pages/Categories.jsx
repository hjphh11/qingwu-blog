// 分类管理（方案 §4.3 + 决策 17 / 29）—— 珍珠玻璃版。
//
// 版式照 Articles.jsx 的「统一列表页」：页面头（标题 + 主操作）→ 表格面板
// （工具栏放「保存顺序」与刷新）→ 分页。上下移动调顺序留在表格最左的「顺序」列里
// （不额外开一个排序面板：分类一共就几条，和表格重复一遍会更乱），行操作在最右列。
// 分类没有可筛的字段（关键词/状态都没有），所以不摆查询区 —— 查询区是给筛选用的，
// 硬塞一个空壳只会多一层视觉噪音。
//
// ⚠️ 功能与旧暖色版 Categories.jsx **逐条对齐**，只换呈现层：
//   · 增 / 删 / 改 / 排序；排序仍是「上下移动按钮 + 保存」，不做拖拽
//   · 新建**只填中文名**，内部标识自动转拼音（300ms 防抖预览，接口还是 /api/slug）
//   · 删分类的**归属保护**：有文章时必须先选一个分类转移（Modal + Select）
//   · 顺序改了还没保存要能一眼看出来（面板状态灯 + 标题旁文案 + 保存按钮亮起来）
//
// 与旧版的呈现层差异（都在下面就近注释了「为什么」）：
//   1. 顶部两条 alert（红/绿）→ 写操作的成功失败走提示牌堆（pushToast/toastError），
//      读取失败留一个可点「重试」的红面板（数据读不出来是持续状态，一闪而过的提示牌不够）。
//   2. 行内展开的新建 / 改名 / 删除确认三条框 → 三个 Modal：
//      表格里的行展不开表单，而且删除的「转到哪个分类」本来就需要一块独立的选择区。
//   3. 新建 / 改名的表单改走 Field + TextInput + IconPicker（芯片复用 .perm-chip 样式）。
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
  Save,
  Trash,
} from '../icons.js';
import { cls } from '../pearl/cls.js';
import { pushToast, toastError } from '../pearl/toast.js';
import Button from '../pearl/ui/Button.jsx';
import { confirm } from '../pearl/ui/confirm.js';
import Field from '../pearl/ui/Field.jsx';
import HoverCard from '../pearl/ui/HoverCard.jsx';
import IconButton from '../pearl/ui/IconButton.jsx';
import ListPage from '../pearl/business/ListPage.jsx';
import Modal from '../pearl/ui/Modal.jsx';
import Panel from '../pearl/ui/Panel.jsx';
import Select from '../pearl/ui/Select.jsx';
import Tag from '../pearl/ui/Tag.jsx';
import TextInput from '../pearl/ui/TextInput.jsx';

const IconOf = ({ name, size = 16 }) => (
  <MorphIcon icon={CATEGORY_ICONS[name] ?? DEFAULT_CATEGORY_ICON} size={size} color="currentColor" reducedMotion="user" />
);

/**
 * 表格列定义。
 *
 * ⚠️ 放在**模块作用域**（不是 useMemo）：这些列不依赖任何 state，写成常量后引用稳定。
 * DataTable 的 sortedData 是拿 columns 当依赖的，每次渲染新建一个数组会让它的 useMemo
 * 白算一遍 —— 页面这里没感觉，但这是列表页的通用坑，先按常量写住。
 *
 * 顺序列不标 sortable：本页的「顺序」是用户手工排的（order state），
 * 点表头排序会和上下移动的语义打架（表头把行排走，箭头却按全局顺序换位置）。
 */
const COLUMNS = [
  { key: 'order', title: '顺序', width: 128 },
  { key: 'icon', title: '图标', width: 78, align: 'center' },
  { key: 'label', title: '分类', minWidth: 200 },
  { key: 'id', title: '内部标识', width: 150, className: cls('mono') },
  { key: 'count', title: '文章', width: 116 },
  // col-actions 让这一列在横向滚动时吸附在右边（pearl 样式里的列位约定）
  { key: 'actions', title: '操作', width: 96, className: 'col-actions' },
];

/**
 * 图标选择器（一排可点的小圆片）。
 *
 * ⚠️ 放在**组件外面**（模块作用域）：写在 `Categories()` 里的话，每次 re-render 都会
 * 生成一个新的组件类型 → React 把整棵子树卸载重建（这里是按钮，不会丢焦点，
 * 但重建本身是浪费，而且以后往里加输入框就会踩「一次只能输入一个字母」那个坑）。
 *
 * 视觉复用珍珠玻璃的 `.perm-chip`（权限芯片）小圆片：它本来就是「一排可切换的小圆片」，
 * 这里只是换成图标、不需要文字。
 */
function IconPicker({ value, onChange }) {
  return (
    <div className={cls('perm-chips')}>
      {Object.keys(CATEGORY_ICONS).map((name) => (
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

export default function Categories() {
  const [data, setData] = useState(null);
  const [order, setOrder] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 旧版把这个反馈交给全局的 busy：保存顺序时 busy 要等 load() 回来才亮，
  // 按钮上什么都看不到。单独留一个标记，点下去立刻进加载态。
  const [savingOrder, setSavingOrder] = useState(false);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: '', icon: 'sparkles' });
  const [idPreview, setIdPreview] = useState('');
  const [editing, setEditing] = useState(null); // {id, label, icon}
  const [deleting, setDeleting] = useState(null); // {id, label, count, moveTo}

  // 分类通常只有几条，默认一页装得下；分页是列表页的统一件（够多时能翻）
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

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

  /**
   * 写操作的统一包装：成功推提示牌 + 重新读一遍数据，失败推错误提示。
   *
   * 只有**读取**失败才落到 `error`（上面那块红面板）—— 写操作失败是一次性事件，
   * 用提示牌更直接；旧版两种都往页面顶部的 alert 里塞，用户很容易整段漏看。
   */
  const act = async (fn, okText) => {
    try {
      await fn();
      if (okText) pushToast(okText, 'ok');
      await load();
      return true;
    } catch (err) {
      toastError(err, '操作失败');
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

  const saveOrder = async () => {
    setSavingOrder(true);
    try {
      await act(async () => {
        await api.post('/api/categories/reorder', { ids: order });
        setDirty(false);
      }, '顺序已保存，前台筛选按钮会跟着变');
    } finally {
      setSavingOrder(false);
    }
  };

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

  /**
   * 删除分类。target = { id, label, count, moveTo }。
   *
   * 为什么把 target 当参数收进来、而不是像旧版那样直接读 `deleting` state：
   * 空分类走的是全局确认浮层（`await confirm(...)`），确认之后才去删 —— 那一刻
   * setDeleting 还没生效（React 的 setState 不会立刻可见），闭包里读到的会是旧值。
   */
  const doDelete = (target) =>
    act(async () => {
      const r = await api.post(`/api/categories/${encodeURIComponent(target.id)}/delete`, {
        ...(target.count > 0 ? { moveTo: target.moveTo } : {}),
      });
      const moved = r.moved ?? 0;
      setDeleting(null);
      return moved;
    }, target.count > 0
      ? `已把 ${target.count} 篇文章转到「${byId[target.moveTo]?.label ?? target.moveTo}」并删掉分类`
      : '分类已删除');

  /** 点行里的铅笔：打开改名 / 换图标表单 */
  const openEdit = (c) => {
    setDeleting(null);
    // 旧版是「再点一次收起」，现在表单在 Modal 里，被遮住的行按钮点不到，
    // 所以这里只负责打开；关闭交给 Modal 的取消 / Esc。
    setEditing({ id: c.id, label: c.label, icon: c.icon ?? 'sparkles' });
  };

  /** 点行里的垃圾桶：有文章 → 进「转移」Modal；空分类 → 全局确认浮层 */
  const onDelete = async (c) => {
    setEditing(null);
    if (c.count > 0) {
      // 删除时「可以转移到哪些分类」= 除了自己以外的全部
      // （⚠️ 不能复用编辑态的变量 —— 删除时它一定是空的，下拉会没选项）
      const targets = order.filter((oid) => oid !== c.id);
      setDeleting({ id: c.id, label: c.label, count: c.count, moveTo: targets[0] ?? '' });
      return;
    }
    const ok = await confirm({
      title: '删除分类',
      message: `确定删除分类「${c.label}」？它下面没有文章，删掉不影响内容。`,
      confirmText: '删除',
      danger: true,
    });
    if (ok) doDelete({ id: c.id, label: c.label, count: 0, moveTo: '' });
  };

  // 表格里的行 = 完整顺序按当前页切一段；order 里可能混进已删掉的 id，用 byId 过滤
  const ordered = useMemo(() => order.map((id) => byId[id]).filter(Boolean), [order, byId]);
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  // 删到当前页空了就自动回到最后一页（旧版没有分页，这里补一个不至于显示空白页）
  const current = Math.min(page, pageCount);
  const rows = useMemo(
    () => ordered.slice((current - 1) * pageSize, current * pageSize),
    [ordered, current, pageSize],
  );

  const transferOptions = useMemo(
    () =>
      deleting
        ? order.filter((id) => id !== deleting.id).map((id) => ({ label: byId[id]?.label ?? id, value: id }))
        : [],
    [deleting, order, byId],
  );

  const renderCell = (row, col) => {
    // 上下移动按**全局**顺序算（不是当前页的下标），所以每格都回查一次 order
    const gi = order.indexOf(row.id);
    switch (col.key) {
      case 'order':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className={cls('tnum')} style={{ minWidth: 22, color: 'var(--ink-soft)' }}>
              {gi + 1}
            </span>
            <IconButton
              icon={ArrowUp}
              label="上移"
              size={15}
              small
              disabled={gi <= 0}
              onClick={() => move(gi, -1)}
            />
            <IconButton
              icon={ArrowDown}
              label="下移"
              size={15}
              small
              disabled={gi < 0 || gi === order.length - 1}
              onClick={() => move(gi, 1)}
            />
          </span>
        );
      case 'icon': {
        // 图标名原来靠原生 title 提示，这里给一张悬停名片 —— 顺便说清「前台按这个名字认图标」
        const iconName = row.icon ?? '（默认）';
        return (
          <HoverCard
            width={230}
            content={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontWeight: 640 }}>{iconName}</div>
                <div style={{ color: 'var(--ink-soft)', fontSize: 13, lineHeight: 1.6 }}>
                  前台按这个名字找同一个图标（src/lib/categoryIcons.ts），认不出就回落成默认图标
                </div>
              </div>
            }
          >
            {/* 复用空态的图标底座（m-groove 本来就是给图标方块用的材质），只是把尺寸压小 */}
            <span
              className={cls('empty-ico', 'm-groove')}
              style={{ width: 30, height: 30, borderRadius: 10 }}
              title={iconName}
            >
              <IconOf name={row.icon} size={16} />
            </span>
          </HoverCard>
        );
      }
      case 'label':
        return (
          <button
            type="button"
            className={cls('link-btn')}
            title={`${row.label}（点击改名 / 换图标）`}
            onClick={() => openEdit(row)}
          >
            {row.label}
          </button>
        );
      case 'count':
        return row.count === 0 ? (
          <Tag tone="neutral" dot>
            空分类
          </Tag>
        ) : (
          <span className={cls('tnum')}>{row.count} 篇</span>
        );
      case 'actions':
        return (
          <span style={{ display: 'inline-flex', gap: 2 }}>
            <IconButton icon={Pencil} label="改名 / 换图标" size={16} onClick={() => openEdit(row)} />
            <IconButton icon={Trash} label="删除" size={16} danger onClick={() => onDelete(row)} />
          </span>
        );
      default:
        return undefined;
    }
  };

  // 面板状态灯：读失败（数据异常）红 → 顺序改了没保存（未保存改动）蓝 → 正常青柠
  const listStatus = error ? 'danger' : dirty ? 'info' : 'ok';

  return (
    <>
      <ListPage
        title="分类"
        desc="上下箭头调顺序 · 改完点「保存顺序」· 前台 /blog 的筛选按钮会跟着变"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            新建分类
          </Button>
        }
        before={
          // 读取失败：红面板留着（数据读不出来是持续状态），配一个「重试」
          error ? (
            <Panel
              className={cls('reveal')}
              title="读取失败"
              meta="分类数据没读到"
              status="danger"
              tools={
                <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load}>
                  重试
                </Button>
              }
            >
              <div className={cls('panel-body')}>
                <p style={{ margin: 0, color: 'var(--ink-soft)' }}>{error}</p>
              </div>
            </Panel>
          ) : null
        }
        tableTitle="分类"
        // 未保存时把提示写在面板标题旁，保存按钮同时亮起来（两处都在视线里，不用满屏找）
        meta={dirty ? '顺序改了还没保存' : `共 ${total} 个分类`}
        status={listStatus}
        tools={
          <Button
            variant="primary"
            size="sm"
            icon={Save}
            loading={savingOrder}
            disabled={!dirty}
            onClick={saveOrder}
          >
            保存顺序
          </Button>
        }
        columns={COLUMNS}
        rows={rows}
        rowKey="id"
        renderCell={renderCell}
        loading={busy}
        total={ordered.length}
        page={current}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(n) => {
          // 换了每页条数就回第一页，否则可能停在一个已经不存在的位置
          setPageSize(Number(n) || 20);
          setPage(1);
        }}
        onRefresh={load}
        canExport={false}
        minWidth={760}
        emptyText={error ? '读取失败' : '还没有分类'}
        emptyDesc={
          error
            ? '点上方红面板里的「重试」再读一次'
            : '点右上角「新建分类」建第一个 —— 它会长成前台 /blog 的筛选按钮'
        }
      />

      {/* 新建分类（只填中文名，内部标识自动生成） */}
      {creating ? (
        <Modal
          open
          onClose={() => setCreating(false)}
          title="新建分类"
          sub="只填中文名 —— 内部标识按拼音自动生成，会写进每篇文章的 frontmatter"
          width={520}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button variant="primary" disabled={!form.label.trim()} onClick={create}>
                创建
              </Button>
            </>
          }
        >
          <div className={cls('form-grid')}>
            <Field label="分类名" required hint="前台筛选按钮上显示的就是这个名字">
              <TextInput
                value={form.label}
                onChange={(v) => setForm((f) => ({ ...f, label: v ?? '' }))}
                placeholder="比如：读书笔记"
                onEnter={() => {
                  if (form.label.trim()) create();
                }}
              />
            </Field>
            <Field label="图标" group hint="前台按名字找同一个图标">
              <IconPicker value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} />
            </Field>
            <Field label="内部标识（自动）" group span hint="标识要一眼能认出来 —— 它写在文章的 frontmatter 里">
              <div className={cls('mono')} style={{ padding: '8px 0' }}>
                {idPreview || <span className={cls('faint')}>按拼音生成</span>}
              </div>
            </Field>
          </div>
        </Modal>
      ) : null}

      {/* 改名 / 换图标 */}
      {editing ? (
        <Modal
          open
          onClose={() => setEditing(null)}
          title="改名 / 换图标"
          sub={
            <>
              内部标识 <span className={cls('mono')}>{editing.id}</span> 不给改 ——
              它写在每篇文章的 frontmatter 里，改了要连带重写所有文章
            </>
          }
          width={520}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button variant="primary" disabled={!editing.label.trim()} onClick={saveEdit}>
                保存
              </Button>
            </>
          }
        >
          <div className={cls('form-grid')}>
            <Field label="分类名" required hint="改名不影响已经关联的文章">
              <TextInput
                value={editing.label}
                onChange={(v) => setEditing((s) => ({ ...s, label: v ?? '' }))}
                onEnter={() => {
                  if (editing.label.trim()) saveEdit();
                }}
              />
            </Field>
            <Field label="图标" group hint="前台按名字找同一个图标">
              <IconPicker value={editing.icon} onChange={(icon) => setEditing((s) => ({ ...s, icon }))} />
            </Field>
          </div>
        </Modal>
      ) : null}

      {/* 删除的归属保护：有文章时必须先选一个分类转过去 */}
      {deleting && deleting.count > 0 ? (
        <Modal
          open
          onClose={() => setDeleting(null)}
          title="先转移文章，再删分类"
          sub="分类没删之前，文章必须有个去处"
          width={480}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button variant="danger" disabled={!deleting.moveTo} onClick={() => doDelete(deleting)}>
                转移并删除
              </Button>
            </>
          }
        >
          <div className={cls('confirm-body')}>
            <span className={cls('confirm-icon', 'is-danger')}>
              <MorphIcon icon={CircleAlert} size={18} color="currentColor" reducedMotion="user" />
            </span>
            <p className={cls('confirm-text')}>
              「{deleting.label}」下面还有 <b>{deleting.count}</b> 篇文章 ——
              请先把它们转到别的分类，再删这个分类。
            </p>
          </div>
          <div style={{ marginTop: 16 }}>
            <Field label="把这些文章转到" required group hint="只能转给别的分类，自己不能接收自己的文章">
              <Select
                value={deleting.moveTo}
                options={transferOptions}
                onChange={(v) => setDeleting((s) => ({ ...s, moveTo: v ?? '' }))}
              />
            </Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
