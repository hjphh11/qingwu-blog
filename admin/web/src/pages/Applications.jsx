// 友链申请审批（阶段 J · 方案 §4.5 + 第 35/36/49 条）—— 珍珠玻璃版（第 8 页）。
//
// 数据链路与逻辑**与旧暖色版逐行一致**（admin/server 一行都没动）：
//   · 申请数据在**私有仓库**里（含访客邮箱，不进公开仓库），这个页面读它、
//     并把审批结果写回去：
//       - 通过 = 追加进 links.json（→ 出现在「待发布」里，去发布页点一下就上线）
//       - 拒绝 = 标记（可留原因）；对方之后可以重新申请
//       - 点错了能「改回待审批」
//   · GET  /api/applications（`?refresh=1` 绕服务端缓存）
//   · POST /api/applications/{approve,reject,reopen}
//   · 操作成功后 dispatch `qingwu:pending` 事件，让顶栏那个「发布 N」跟着变
//   · 三态筛选（待审批 / 已通过 / 已拒绝 / 全部）+ 每个筛选按钮上的计数、共 N 条申请、
//     空态文案（待审批tab 是「没有待审批的申请」，其余是「这里还没有内容」）、
//     读取失败提示、没配 token 的告警（reason 原文照搬）
//
// 呈现层（组件级）：
//   · 页根 .page + useEntrance()（入场类只能由 state 拼，见 pearl/useEntrance.js）；
//   · 页头 PageHeader ——「刷新」放页头右侧主操作位；私有仓库 / 读取时间放工具按钮
//     左边的 .apply-meta（原来挂在面板头的 .hint 上）；
//   · 一块 Panel「友链申请」，正文**不套 .panel-body**（正文层与 pearl-local.css 第 12 节
//     的兜底只能选一条，别双层）—— 表格通宽、内距由单元格自带，因此依赖第 12 节的兜底：
//     它给顶部那段「通过 / 拒绝说明」与筛选行补左右各 20px；
//   · 列表用 DataTable（两列：申请信息 / 操作）。原来 .post-list 里每行是
//     「头像 + 名字 + 状态标签 + 链接 + 邮箱 + 一句话 + 申请时间」，这里合并进「申请信息」一列，
//     复用 .cell-main / .cell-title / .cell-sub 与概览页那枚 .quick-ico 玻璃小槽；
//   · 状态标签走 Tag 的语义色（待审批 = info 蓝 / 已通过 = ok 青柠 / 已拒绝 = danger 红，
//     对应旧 .tag-amber / .tag-ok / .tag-bad）；
//   · 头像兜底照旧：头像图挂了就藏掉它、露出底下的地球图标 —— 旧版直接改 img 的 display，
//     这里换成一份「加载失败的头像地址」state（同一效果，但不手改 DOM）；
//   · 通过 / 拒绝 / 改回待审批：确认走 pearl/ui/confirm.js（不再用 window.confirm）；
//   · 拒绝理由从旧版页内的内联 .inline-box 改成**居中 Modal**（宽 680，Esc / 遮罩可关），
//     与关于页 / 分享·语录 / 友链页同一交互；
//   · 结果反馈统一走珍珠的 toast（pearl/toast.js）—— 与本页旧版一致（友链页当初就是 toast，
//     不像关于页 / 分享页那样是页顶横条）；读取失败除了 toast 之外还要在页面上留一条
//     可读的错误横条（旧版就有，删掉就成了「白屏」）。
// 类名一律走 cls()；页内不再出现 .card / .panel / .panel-head / .btn / .btn-ghost / .hint /
// .tag / .alert / .spacer / .form-grid / .inline-box / .pager / .iconbtn / .field / .input /
// .textarea / .post-list / .empty 这类旧暖色类名。
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  Ban,
  CircleAlert,
  CircleCheck,
  Clock,
  ExternalLink,
  Globe,
  Inbox,
  Mail,
  RefreshCw,
  Undo2,
} from '../icons.js';
import { cls } from '../pearl/cls.js';
import { pushToast, toastError } from '../pearl/toast.js';
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

/** 三态 + 全部（旧版的四个筛选项，文案照旧） */
const FILTERS = [
  { key: 'pending', label: '待审批' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'all', label: '全部' },
];

/** 状态 → 中文标签 + 珍珠语义色（旧版是 .tag-amber / .tag-ok / .tag-bad） */
const STATUS = {
  pending: { label: '待审批', tone: 'info' },
  approved: { label: '已通过', tone: 'ok' },
  rejected: { label: '已拒绝', tone: 'danger' },
};

/** 表格列：申请信息（头像 / 名字 / 状态 / 链接 / 邮箱 / 一句话 / 时间）/ 操作 */
const COLUMNS = [
  { key: 'app', title: '申请信息', minWidth: 460 },
  { key: 'actions', title: '操作', width: 128, className: 'col-actions' },
];

const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false });
};

/**
 * 带兜底图标的状态标签。旧版是暖色的 `.tag.tag-ok / .tag-amber / .tag-bad`，珍珠版换成语义色的 Tag。
 *
 * ⚠️ 与下面几个小组件一样必须放在**组件外面**（模块作用域）：写在 `Applications()` 里的话，
 * 每次 re-render 都会生成一个新的组件类型 → React 卸载重建整棵子树。
 */
function StatusTag({ status }) {
  const st = STATUS[status] ?? STATUS.pending;
  return <Tag tone={st.tone}>{st.label}</Tag>;
}

/** 申请的头像：图挂了就藏掉它、露出底下的地球图标（与旧版的 onError 行为一致） */
function AppAvatar({ url }) {
  const [broken, setBroken] = useState(false);
  const show = Boolean(url) && !broken;

  return (
    <span className={cls('quick-ico', 'm-groove')}>
      <MorphIcon icon={Globe} size={16} color="currentColor" reducedMotion="user" />
      {show && (
        <img
          className="quick-img"
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      )}
    </span>
  );
}

/**
 * 拒绝理由弹窗的正文：一个字段（旧版内联 .inline-box 里那唯一的输入框）。
 * 必须放在**组件外面**（模块作用域）：写在 `Applications()` 里会让输入框每打一个字就丢焦点。
 */
function RejectForm({ name, value, onChange }) {
  return (
    <div className={cls('form-grid')}>
      <Field label="拒绝原因（选填，只给自己看）" group span>
        <TextInput
          multiline
          rows={3}
          value={value}
          onChange={onChange}
          placeholder="例如：站点打不开 / 内容不合适"
        />
      </Field>
      <p className={cls('apply-reject-note')}>
        拒绝后对方可以重新提交申请；这条申请会保留在「已拒绝」里，随时能点「改回待审批」。
        {name ? `（这条是「${name}」的申请）` : ''}
      </p>
    </div>
  );
}

export default function Applications() {
  const ready = useEntrance();

  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(null); // 正在处理的申请 id
  const [rejecting, setRejecting] = useState(null); // { id, name }
  const [reason, setReason] = useState('');

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError('');
    try {
      setData(await api.get(`/api/applications${refresh ? '?refresh=1' : ''}`));
    } catch (err) {
      setError(err.message || '读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (kind, id, body = {}) => {
    setActing(id);
    setError('');
    try {
      const r = await api.post(`/api/applications/${kind}`, { id, ...body });
      setData((d) => ({ ...d, ...r }));
      // 结果反馈走珍珠 toast（本页旧版就是 toast，不是页顶横条），文案与旧版逐字一致
      pushToast(
        kind === 'approve'
          ? `已把「${r.application?.name}」写进友链 —— 去发布页点发布就上线`
          : kind === 'reject'
            ? `已拒绝「${r.application?.name}」`
            : `「${r.application?.name}」已改回待审批`,
      );
      setRejecting(null);
      setReason('');
      window.dispatchEvent(new Event('qingwu:pending')); // 让顶栏「发布 N」跟着变
    } catch (err) {
      // 失败要同时看得见：toast 负责即时反馈，页内错误横条负责留在屏幕上（旧版就是横条）
      toastError(err, '操作失败');
      setError(err.message || '操作失败');
    } finally {
      setActing(null);
    }
  };

  /** 拒绝：先确认，再弹「拒绝理由」的居中弹窗（旧版是页内内联表单） */
  const askReject = async (a) => {
    const ok = await confirm({
      title: '拒绝这条申请',
      message: `拒绝「${a.name}」的友链申请？拒绝后对方可以重新申请，之后也随时能改回待审批。`,
      confirmText: '填拒绝原因',
      danger: true,
    });
    if (!ok) return;
    setReason('');
    setRejecting({ id: a.id, name: a.name });
  };

  const items = data?.items ?? [];
  const shown = filter === 'all' ? items : items.filter((a) => a.status === filter);
  const counts = data?.counts ?? { pending: 0, approved: 0, rejected: 0, total: 0 };

  const notConfigured = data && data.enabled === false;

  const renderCell = (row, col) => {
    if (col.key === 'app') {
      return (
        <span className={cls('cell-main')}>
          <AppAvatar url={row.avatar} />
          <span className={cls('apply-info')}>
            <span className={cls('cell-title', 'apply-name')}>
              {row.name}
              <StatusTag status={row.status} />
            </span>
            {row.intro && <span className={cls('cell-sub', 'ellipsis')}>{row.intro}</span>}
            <span className={cls('cell-sub', 'ellipsis')}>
              <a href={row.url} target="_blank" rel="noreferrer">
                {row.url} <MorphIcon icon={ExternalLink} size={12} color="currentColor" />
              </a>
              {row.email && (
                <>
                  <span className={cls('apply-sep')}>·</span>
                  <a href={`mailto:${row.email}`}>
                    <MorphIcon icon={Mail} size={12} color="currentColor" /> {row.email}
                  </a>
                </>
              )}
            </span>
            <span className={cls('cell-sub', 'ellipsis')}>
              <MorphIcon icon={Clock} size={12} color="currentColor" /> 提交于 {fmt(row.submittedAt)}
              {row.reviewedAt && <> · 处理于 {fmt(row.reviewedAt)}</>}
              {row.reason && <> · 原因：{row.reason}</>}
            </span>
          </span>
        </span>
      );
    }

    if (col.key === 'actions') {
      return (
        <span className={cls('row-actions')}>
          {row.status !== 'approved' && (
            <Button
              variant="primary"
              size="sm"
              icon={CircleCheck}
              disabled={acting === row.id}
              onClick={() => act('approve', row.id)}
            >
              通过
            </Button>
          )}
          {row.status === 'pending' && (
            <IconButton
              icon={Ban}
              label={`拒绝「${row.name}」`}
              disabled={acting === row.id}
              onClick={() => askReject(row)}
            />
          )}
          {row.status !== 'pending' && (
            <IconButton
              icon={Undo2}
              label={`把「${row.name}」改回待审批`}
              disabled={acting === row.id}
              onClick={() => act('reopen', row.id)}
            />
          )}
        </span>
      );
    }

    return undefined;
  };

  return (
    <div className={cls('page', ready && 'is-entrance-ready')}>
      <PageHeader
        title="友链申请"
        desc="访客在友链申请页提交的申请会存到私有仓库（带邮箱，不进公开仓库）·「通过」会直接写进 links.json —— 之后回发布页点发布，友链才真正上线"
        actions={
          <>
            {/* 数据在私有仓库哪里 / 什么时候读的（旧版挂在面板头的 .hint 上） */}
            <span className={cls('apply-meta', 'ellipsis')}>
              {data?.repo ? (
                <>
                  数据在私有仓库 <span className={cls('mono')}>{data.repo}</span>
                  {data.fetchedAt && <>（读于 {fmt(data.fetchedAt)}）</>}
                </>
              ) : (
                '数据在私有仓库里'
              )}
            </span>
            <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={() => load(true)}>
              {busy ? '刷新中…' : '刷新'}
            </Button>
          </>
        }
      />

      {/* 错误横条：旧版是页面最上方那条 alert（role="alert" 照旧）。
          配色沿用文章编辑器 / 分享·语录 / 关于页同一写法；**与下面面板的间距不写内联 margin**，
          交给外层 .stack 的 18px（横向内距由 .alert-calm 自己给）。 */}
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

        <Panel className={cls('reveal')} title="友链申请" meta={`共 ${counts.total} 条申请`}>
          {/* 「通过 / 拒绝」的说明（旧版是面板头下面那行 .hint） */}
          <p className={cls('apply-desc')}>
            访客在友链申请页提交的申请会存到私有仓库（带邮箱，不进公开仓库）。
            「通过」会直接写进 <span className={cls('mono')}>links.json</span> —— 之后回<strong>发布页</strong>
            点发布，友链才真正上线。「拒绝」会标记回去，对方之后可以重新申请。
          </p>

          {/* 没配 token 的告警：文案（含 data.reason）与旧版逐字相同，只是换了珍珠的横条样式。
              「还没配」是要你去配的待办（蓝），不是坏了 —— 蓝底的写法与发布页同一处。 */}
          {notConfigured && (
            <div
              className={cls('alert-calm', 'apply-warn')}
              role="alert"
              style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}
            >
              <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
              <span>
                {data?.reason} —— 在服务器上给 <span className={cls('mono')}>/opt/qingwu/.env</span> 加一项{' '}
                <span className={cls('mono')}>ADMIN_APPLY_TOKEN</span>（该私有仓库的 Contents 读写权限）再重启后台即可。
              </span>
            </div>
          )}

          {/* 三态筛选（每个按钮上带该状态的计数，旧版是 .chip）+ 右侧「共 N 条申请」 */}
          <div className={cls('apply-filters')}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={cls('perm-chip', filter === f.key && 'is-on')}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {f.key !== 'all' && counts[f.key] > 0 && <b className={cls('tnum')}> {counts[f.key]}</b>}
              </button>
            ))}
            <span className={cls('apply-total')}>共 {counts.total} 条申请</span>
          </div>

          {/* 列表：读取中走 DataTable 的骨架屏；读不到数据时它的空态里写的就是错误信息 */}
          <DataTable
            columns={COLUMNS}
            data={shown}
            rowKey="id"
            renderCell={renderCell}
            loading={busy}
            emptyIcon={error ? CircleAlert : Inbox}
            emptyText={
              error
                ? error
                : filter === 'pending'
                  ? '没有待审批的申请'
                  : '这里还没有内容'
            }
            emptyDesc={error ? '点右上角「刷新」再试一次' : undefined}
          />
        </Panel>
      </div>

      {/* 拒绝理由：居中弹窗（旧版是插在该行下面的内联 .inline-box）。理由选填，
          「确认拒绝」直接调 reject 接口，成功后由 act() 关掉弹窗、清空理由并弹 toast。 */}
      <Modal
        open={Boolean(rejecting)}
        onClose={() => {
          setRejecting(null);
          setReason('');
        }}
        title={rejecting ? `拒绝「${rejecting.name}」的申请` : '拒绝申请'}
        sub="拒绝原因选填（只给自己看，不会发给对方）—— 拒绝后对方可以重新申请"
        width={680}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRejecting(null);
                setReason('');
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              danger
              loading={acting != null && acting === rejecting?.id}
              onClick={() => act('reject', rejecting.id, { reason })}
            >
              确认拒绝
            </Button>
          </>
        }
      >
        {rejecting && <RejectForm name={rejecting.name} value={reason} onChange={setReason} />}
      </Modal>
    </div>
  );
}
