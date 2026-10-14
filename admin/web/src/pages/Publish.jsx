// 发布页（方案 §4.10）—— 珍珠玻璃版。
//
// 流程：构建校验 → 暂存 → 提交 → 拉取变基 → 推送 → 触发重建
//   默认「一键全发」，也可以只勾选要发布的文件；下面还有定时发布与发布历史（一键回滚）。
//
// ⚠️ 数据链路与逻辑**与旧暖色版逐行一致**（只换呈现层）：
//   GET  /api/publish/status（有任务在跑就 1.2s 轮询一次）
//   GET  /api/publish/history · POST /api/publish · POST /api/publish/rollback
//   GET  /api/schedule · POST /api/schedule | /api/schedule/cancel | /api/schedule/clear
//   GET  /api/articles?pageSize=200（定时发布里选文章用）
//   以及 syncPending()（window 事件 qingwu:pending，让顶栏那个「发布 N」跟着更新）。
//
// 呈现层换成珍珠玻璃组件：页根 .page + useEntrance()、页头 PageHeader、各区 Panel、
// 标签 Tag、按钮 Button/IconButton、空态 EmptyState、文件表格 DataTable、
// 确认浮层 confirm()（不再是 window.confirm）、定时表单 Modal（居中弹窗）。
// 流水线用 styles/pearl/instruments.css 里现成的 .pipe-steps / .pipe-step / .pipe-step-n
// （编号徽章 + is-on / is-done 状态，3 列网格正好把服务端 6 步排两行），没有自己发明一套 step 样式。
// 类名一律走 cls()；页内不再出现 .card / .panel / .btn / .tag / .post-list 这类旧暖色类名。
import { useCallback, useEffect, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Trash,
  TriangleAlert,
  X,
} from '../icons.js';
import { cls } from '../pearl/cls.js';
import { useEntrance } from '../pearl/useEntrance.js';
import Button from '../pearl/ui/Button.jsx';
import Checkbox from '../pearl/ui/Checkbox.jsx';
import { confirm } from '../pearl/ui/confirm.js';
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

/** 变更类型 → 中文标签 + 珍珠的四种语义色（旧版是 tag-ok / tag-amber / tag-bad / tag-soft） */
const KIND = {
  added: { label: '新增', tone: 'ok' },
  modified: { label: '修改', tone: 'info' },
  deleted: { label: '删除', tone: 'danger' },
  renamed: { label: '改名', tone: 'neutral' },
};

/** 定时任务状态 → 文字 + 语义色（标签文字与原版一字不差） */
const SCHED = {
  pending: { label: '等待中', tone: 'info' },
  running: { label: '发布中', tone: 'info' },
  done: { label: '已发布', tone: 'ok' },
  canceled: { label: '已取消', tone: 'neutral' },
  failed: { label: '失败', tone: 'danger' },
};

/**
 * 发布步骤的状态记号：与服务端 admin/server/publish.js 的
 * pending / running / ok / failed / skip 一一对应（记号沿用旧版 .step .dot 里的那几个字符）。
 */
const STEP_GLYPH = { ok: '✓', failed: '✗', running: '…', skip: '–' };
const STEP_LABEL = { pending: '等待中', running: '进行中', ok: '已完成', failed: '失败', skip: '跳过' };
const STEP_TONE = { pending: 'neutral', running: 'info', ok: 'ok', failed: 'danger', skip: 'neutral' };
/** 步骤明细那几行的图标：跑完打勾、失败报警、其余用钟 */
const stepIcon = (state) => (state === 'ok' ? CircleCheck : state === 'failed' ? TriangleAlert : Clock);

const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false });
};

// 让顶栏那个「发布 N」的数字跟着一起更新（PearlShell.jsx 里监听）
const syncPending = () => window.dispatchEvent(new Event('qingwu:pending'));

/** 待发布文件表格的列：勾选 / 改动类型 / 文件（与旧版三列一致） */
const FILE_COLUMNS = [
  { key: 'pick', title: '', width: 46 },
  { key: 'kind', title: '改动', width: 76 },
  { key: 'file', title: '文件', className: cls('mono') },
];

export default function Publish() {
  // 入场类只能由 state 驱动（见 pearl/useEntrance.js：手写 classList 会被 React 重写抹掉）
  const ready = useEntrance();

  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // null = 全选
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);
  // 阶段 K：定时发布（到点由服务器自动跑一遍发布）
  const [schedule, setSchedule] = useState({ jobs: [] });
  const [at, setAt] = useState('');
  const [articleId, setArticleId] = useState('');
  const [note, setNote] = useState('');
  const [schedBusy, setSchedBusy] = useState(false);
  /** 「加一条定时」的表单现在是居中弹窗（原来是插在页面里的内联表单块） */
  const [schedOpen, setSchedOpen] = useState(false);
  const [articles, setArticles] = useState([]);
  // 阶段 L：刚「跑完」的步骤 —— 给它的编号徽章弹一下（只在状态真正翻转时加 450ms）
  const [popped, setPopped] = useState([]);
  const prevStates = useRef({});

  useEffect(() => {
    const steps = status?.job?.steps;
    if (!steps) return;
    const flipped = steps
      .filter((s) => s.state === 'ok' && prevStates.current[s.key] && prevStates.current[s.key] !== 'ok')
      .map((s) => s.key);
    prevStates.current = Object.fromEntries(steps.map((s) => [s.key, s.state]));
    if (flipped.length === 0) return;
    setPopped(flipped);
    const t = setTimeout(() => setPopped([]), 450);
    return () => clearTimeout(t);
  }, [status]);

  const loadSchedule = useCallback(async () => {
    try {
      setSchedule(await api.get('/api/schedule'));
    } catch {
      /* 定时待办读不到不影响发布本身 */
    }
  }, []);

  useEffect(() => {
    loadSchedule();
    api
      .get('/api/articles?pageSize=200')
      .then((r) => setArticles(r.articles ?? []))
      .catch(() => setArticles([]));
  }, [loadSchedule]);

  const addSchedule = async () => {
    setError('');
    setSchedBusy(true);
    try {
      const r = await api.post('/api/schedule', { at, articleId: articleId || null, note });
      setSchedule(r);
      // 成功才清空输入并关弹窗（取消/Esc 关掉时保留已填内容，与旧版内联表单一致）
      setAt('');
      setArticleId('');
      setNote('');
      setSchedOpen(false);
    } catch (err) {
      setError(err.message || '加定时任务失败');
    } finally {
      setSchedBusy(false);
    }
  };

  const cancelSchedule = async (id) => {
    setError('');
    try {
      setSchedule(await api.post('/api/schedule/cancel', { id }));
    } catch (err) {
      setError(err.message || '取消失败');
    }
  };

  const clearSchedule = async () => {
    try {
      setSchedule(await api.post('/api/schedule/clear', {}));
    } catch (err) {
      setError(err.message || '清理失败');
    }
  };

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [s, h] = await Promise.all([api.get('/api/publish/status'), api.get('/api/publish/history')]);
      setStatus(s);
      setHistory(h.history ?? []);
      syncPending();
      if (s.job && !s.job.running) setSelected(null);
    } catch (err) {
      setError(err.message || '读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 有任务在跑就轮询（1.2s）
  useEffect(() => {
    const running = status?.job?.running;
    if (running) {
      pollRef.current = setTimeout(async () => {
        try {
          const s = await api.get('/api/publish/status');
          setStatus(s);
          if (s.job && !s.job.running) {
            const h = await api.get('/api/publish/history');
            setHistory(h.history ?? []);
            syncPending();
          }
        } catch {
          /* 轮询失败就下一次再说 */
        }
      }, 1200);
    }
    return () => clearTimeout(pollRef.current);
  }, [status]);

  const files = status?.files ?? [];
  const picked = selected === null ? files.map((f) => f.file) : selected;

  const doPublish = async (paths) => {
    setError('');
    try {
      const r = await api.post('/api/publish', paths && paths.length ? { paths } : {});
      setStatus((s) => ({ ...s, job: r.job }));
    } catch (err) {
      setError(err.message || '发布失败');
    }
  };

  const doRollback = async (commit, subject) => {
    // 旧版是 window.confirm；珍珠玻璃走统一的确认浮层（原话照旧，提交信息单独一行）
    const ok = await confirm({
      title: '回滚这次提交',
      message: (
        <>
          把这次提交回滚掉并重新上线？
          <br />
          <span className={cls('mono')}>{subject}</span>
        </>
      ),
      confirmText: '回滚并重新上线',
      danger: true,
    });
    if (!ok) return;
    setError('');
    try {
      const r = await api.post('/api/publish/rollback', { commit });
      setStatus((s) => ({ ...s, job: r.job }));
    } catch (err) {
      setError(err.message || '回滚失败');
    }
  };

  const job = status?.job;
  const schedJobs = schedule.jobs ?? [];
  const stepMsgs = job?.steps?.filter((s) => s.message) ?? [];

  // 主发布按钮的文案（与旧版逐字一致：发布中 / 先切回 main / 重试推送 N 个 / 构建校验并发布全部）
  const publishLabel = job?.running
    ? '发布中…'
    : status && status.onMain === false
      ? '先切回 main 再发布'
      : files.length === 0 && (status?.ahead ?? 0) > 0
        ? `重试推送 ${status.ahead} 个提交`
        : '构建校验并发布全部';

  // 状态灯：① 不能发（没配令牌 / 不在 main）红 ② 有改动或落后远端 蓝 ③ 其余正常 青柠
  const pubStatus = !status
    ? undefined
    : !status.hasToken || status.onMain === false
      ? 'danger'
      : files.length > 0 || (status.ahead ?? 0) > 0
        ? 'info'
        : 'ok';

  const articleOptions = [
    { label: '（不指定：发全部待发布）', value: '' },
    ...articles.map((a) => ({ label: `${a.title}${a.draft ? '（草稿）' : ''}`, value: a.id })),
  ];

  /** 待发布文件表格的单元格（勾选列自己画，保持旧版「三列 + 顶部全选按钮」的形状） */
  const renderFileCell = (row, col) => {
    if (col.key === 'pick') {
      const on = picked.includes(row.file);
      return (
        <Checkbox
          checked={on}
          label=""
          onChange={(v) => setSelected(v ? [...picked, row.file] : picked.filter((p) => p !== row.file))}
        />
      );
    }
    if (col.key === 'kind') {
      const k = KIND[row.kind];
      return <Tag tone={k?.tone}>{k?.label ?? row.kind}</Tag>;
    }
    if (col.key === 'file') {
      return <span style={{ wordBreak: 'break-all' }}>{row.file}</span>;
    }
    return undefined;
  };

  return (
    <div className={cls('page', ready && 'is-entrance-ready')}>
      <PageHeader
        title="发布"
        desc="构建校验 → 暂存 → 提交 → 拉取变基 → 推送 → 触发重建；发布是异步任务，下面能看每一步的进度。"
        actions={
          <>
            <Button icon={RefreshCw} disabled={busy} onClick={load}>
              {busy ? '刷新中…' : '刷新'}
            </Button>
            <Button
              variant="primary"
              icon={Send}
              onClick={() => doPublish(null)}
              disabled={!status?.canPublish || job?.running}
            >
              {publishLabel}
            </Button>
          </>
        }
      />

      {/* 错误提示：旧版是页面最上方那条 alert-error，文案与 role="alert" 都照旧 */}
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

      <div className={cls('stack')}>
        {/* ① 发布状态：分支 / 与远端 / 待发布（旧版是那张三行的小表） */}
        <Panel className={cls('reveal')} title="发布" status={pubStatus}>
          <div className={cls('panel-body')} style={{ paddingTop: 4 }}>
            {!status ? (
              <EmptyState title="正在读取发布状态…" desc="分支 · 与远端的差距 · 待发布的文件" icon={RefreshCw} />
            ) : (
              <>
                <div className={cls('kv-grid')}>
                  <div className={cls('kv')}>
                    <div className={cls('kv-label')}>分支</div>
                    <div className={cls('kv-value')}>
                      <span className={cls('mono')}>{status.branch ?? '—'}</span>
                      {status.onMain === false && (
                        <div style={{ marginTop: 6 }}>
                          <Tag tone="danger">不在 main 上 —— 发布只会推 main，先切回 main</Tag>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={cls('kv')}>
                    <div className={cls('kv-label')}>与远端</div>
                    <div className={cls('kv-value')}>
                      领先 <b>{status.ahead ?? 0}</b> 个提交、落后 <b>{status.behind ?? 0}</b> 个
                      {(status.behind ?? 0) > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <Tag tone="info">远端有新提交，发布时会先自动拉取变基</Tag>
                        </div>
                      )}
                      {(status.ahead ?? 0) > 0 && status.onMain !== false && (
                        <div style={{ marginTop: 6 }}>
                          <Tag tone="info">
                            本地有 {status.ahead} 个提交还没推上去（上次推送没成功？再发一次即可）
                          </Tag>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={cls('kv', 'span-2')}>
                    <div className={cls('kv-label')}>待发布</div>
                    <div className={cls('kv-value')}>
                      <b>{files.length}</b> 个文件
                      {files.length === 0 && (
                        <span className={cls('faint')}>（没有待发布的改动 — 保存内容后这里会出现）</span>
                      )}
                      {files.length === 0 && (status.ahead ?? 0) > 0 && status.onMain !== false && (
                        <div className={cls('faint')} style={{ marginTop: 4 }}>
                          上次推送没成功：本地攒了 {status.ahead} 个提交还没上去 —— 点上面的「重试推送」推上去即可（改动没丢）。
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 令牌 / Deploy Hook 的告警（文案原文保留；只在状态读回来之后才判断，免得加载时闪一下） */}
                {(!status.hasToken || !status.hasDeployHook) && (
                  <div
                    className={cls('alert-calm')}
                    style={{
                      marginTop: 14,
                      background: status.hasToken ? 'var(--blue-soft)' : 'var(--red-soft)',
                      color: status.hasToken ? 'var(--blue)' : 'var(--red-text)',
                    }}
                  >
                    <MorphIcon
                      icon={status.hasToken ? CircleAlert : TriangleAlert}
                      size={15}
                      color="currentColor"
                    />
                    <span>
                      {!status.hasToken && <strong>还没配「发布令牌」，现在只能保存、不能发布。</strong>}
                      {status.hasToken && !status.hasDeployHook && '站点会在推送后自己重建，稍慢一点。'}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>

        {/* ② 定时发布（阶段 K · 方案 §4.12）：到点由服务器自己跑一遍发布 */}
        <Panel
          className={cls('reveal')}
          title="定时发布"
          meta="每 15 秒检查一次，重启后会补跑"
          status={schedJobs.some((j) => j.state === 'pending') ? 'info' : undefined}
          tools={
            <>
              <Button variant="primary" size="sm" icon={CalendarClock} onClick={() => setSchedOpen(true)}>
                加一条定时
              </Button>
              {schedJobs.some((j) => j.state !== 'pending') && (
                <Button variant="ghost" size="sm" icon={Trash} onClick={clearSchedule}>
                  清掉已结束的
                </Button>
              )}
            </>
          }
        >
          <div className={cls('panel-body')} style={{ paddingTop: 4 }}>
            <p className={cls('faint')} style={{ marginBottom: 12 }}>
              到点自动发一次；指定文章时，会先把<strong>草稿</strong>改成已发布再发。
            </p>

            {schedJobs.length === 0 ? (
              <EmptyState
                title="没有定时待办"
                desc="点右上角「加一条定时」，到点由服务器自己发一次"
                icon={CalendarClock}
              />
            ) : (
              <div className={cls('activity-list')}>
                {schedJobs.map((j) => {
                  const st = SCHED[j.state] ?? SCHED.failed;
                  return (
                    <div key={j.id} className={cls('activity')}>
                      {/* 图标沿用旧版：等待中是钟，其余是勾（状态另用标签写清） */}
                      <span className={cls('quick-ico', 'm-groove')}>
                        <MorphIcon
                          icon={j.state === 'pending' ? Clock : CircleCheck}
                          size={16}
                          color="currentColor"
                          spring="snappy"
                          reducedMotion="user"
                        />
                      </span>
                      <div className={cls('activity-main')}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span className={cls('tnum')} style={{ fontWeight: 620 }}>
                            {fmt(j.at)}
                          </span>
                          <Tag tone={st.tone}>{st.label}</Tag>
                        </div>
                        <div className={cls('faint')} style={{ fontSize: 12 }}>
                          {j.articleId ? `文章 ${j.articleId}` : '全部待发布改动'}
                          {j.note && <> · {j.note}</>}
                          {j.result && <> · {j.result}</>}
                        </div>
                      </div>
                      {j.state === 'pending' && (
                        <IconButton
                          icon={X}
                          label="取消这条定时"
                          danger
                          onClick={() => cancelSchedule(j.id)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>

        {/* ③ 待发布文件（可勾选）；没有改动时这一块整块不出现（与旧版一致） */}
        {files.length > 0 && (
          <Panel
            className={cls('reveal')}
            title="待发布的改动"
            meta={`共 ${files.length} 个文件 · 已勾选 ${picked.length} 个`}
            status="info"
            tools={
              <>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  全选
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                  全不选
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={Send}
                  onClick={() => doPublish(picked)}
                  disabled={picked.length === 0 || job?.running}
                >
                  只发布勾选的 {picked.length} 个
                </Button>
              </>
            }
          >
            <DataTable
              columns={FILE_COLUMNS}
              data={files}
              rowKey="file"
              renderCell={renderFileCell}
              emptyText="没有待发布的改动"
              emptyDesc="保存内容后这里会出现要发布的文件"
            />
          </Panel>
        )}

        {/* ④ 发布进度：流水线（.pipe-steps）+ 每步的说明 + 原始日志 */}
        {job && (
          <Panel
            className={cls('reveal')}
            title={`${job.kind === 'rollback' ? '回滚' : '发布'}${job.running ? '进行中' : job.ok ? '成功' : '失败'}`}
            meta={fmt(job.startedAt)}
            status={job.running ? 'info' : job.ok ? 'ok' : 'danger'}
          >
            <div className={cls('panel-body')} style={{ paddingTop: 4 }}>
              {job.error && (
                <div
                  className={cls('alert-calm')}
                  style={{ background: 'var(--red-soft)', color: 'var(--red-text)', marginBottom: 14 }}
                >
                  <MorphIcon icon={TriangleAlert} size={15} color="currentColor" />
                  <span>{job.error}</span>
                </div>
              )}
              {job.ok === true && !job.error && (
                <div className={cls('alert-calm')} style={{ marginBottom: 14 }}>
                  <MorphIcon icon={CircleCheck} size={15} color="currentColor" />
                  <span>已推送 —— 站点通常 1 分钟左右更新（可以刷新首页看看）。</span>
                </div>
              )}

              {/* 流水线：scaffold 的步骤条（3 列网格；服务端 6 步正好两行）。
                  编号徽章里放状态记号，跑完的进 is-done（青柠）、正在跑的进 is-on（蓝）。 */}
              <div className={cls('pipe-steps')}>
                {job.steps.map((s, i) => (
                  <div
                    key={s.key}
                    className={cls(
                      'pipe-step',
                      s.state === 'running' && 'is-on',
                      s.state === 'ok' && 'is-done',
                      popped.includes(s.key) && 'is-popped',
                    )}
                    title={s.message || undefined}
                  >
                    <span className={cls('pipe-step-n')}>{STEP_GLYPH[s.state] ?? i + 1}</span>
                    <span>{s.label}</span>
                    {s.state === 'running' && <Tag tone="info">进行中</Tag>}
                    {s.state === 'failed' && <Tag tone="danger">失败</Tag>}
                    {s.state === 'skip' && <Tag tone="neutral">跳过</Tag>}
                  </div>
                ))}
              </div>

              {/* 每一步的说明（旧版写在这行步骤里；流水线的格子只有 38px 高，
                  长文案会撑破格子，所以收到下面这份明细里） */}
              {stepMsgs.length > 0 && (
                <div className={cls('activity-list')}>
                  {stepMsgs.map((s) => (
                    <div key={s.key} className={cls('activity')}>
                      <span className={cls('quick-ico', 'm-groove')}>
                        <MorphIcon icon={stepIcon(s.state)} size={15} color="currentColor" reducedMotion="user" />
                      </span>
                      <div className={cls('activity-main')}>
                        <div style={{ fontWeight: 620 }}>{s.label}</div>
                        <div className={cls('faint')} style={{ fontSize: 12 }}>
                          {s.message}
                        </div>
                      </div>
                      <Tag tone={STEP_TONE[s.state] ?? 'neutral'}>{STEP_LABEL[s.state] ?? s.state}</Tag>
                    </div>
                  ))}
                </div>
              )}

              {job.log?.length > 0 && (
                <pre className={cls('code-block')} style={{ marginTop: 14, maxHeight: 260 }}>
                  {job.log.join('\n')}
                </pre>
              )}
            </div>
          </Panel>
        )}

        {/* ⑤ 发布历史 + 回滚 */}
        <Panel
          className={cls('reveal')}
          title="发布历史"
          meta="回滚 = 撤销那次提交再发一遍（不改写历史）"
          tools={<IconButton icon={RefreshCw} label="刷新" bordered disabled={busy} onClick={load} />}
        >
          <div className={cls('panel-body')} style={{ paddingTop: 4 }}>
            {history.length === 0 ? (
              <EmptyState
                title={busy ? '正在读取发布历史…' : '还没有发布记录'}
                desc={busy ? '最近 12 次提交' : '发布一次之后，这里会列出最近的提交，可一键回滚'}
                icon={busy ? RefreshCw : Clock}
              />
            ) : (
              <div className={cls('activity-list')}>
                {history.map((h) => (
                  <div key={h.hash} className={cls('activity')}>
                    <div className={cls('activity-main')}>
                      <div className={cls('ellipsis')} title={h.subject} style={{ fontWeight: 620 }}>
                        {h.subject}
                      </div>
                      <div className={cls('faint')} style={{ fontSize: 12 }}>
                        <span className={cls('mono')}>{h.short}</span> · {h.date}
                      </div>
                    </div>
                    <IconButton
                      icon={RotateCcw}
                      label={h.isRoot ? '这是仓库的第一个提交，回滚不了' : '回滚这次提交'}
                      danger
                      disabled={h.isRoot || job?.running}
                      onClick={() => doRollback(h.hash, h.subject)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* 发布成功后那条「想确认线上？」提示（旧版是页面底部的一条横幅，文案照旧） */}
      {job?.ok === true && !job.running && (
        <div
          className={cls('alert-calm', 'reveal')}
          style={{ background: 'var(--blue-soft)', color: 'var(--blue)', marginTop: 18 }}
        >
          <MorphIcon icon={Sparkles} size={15} color="currentColor" />
          <span>
            想确认线上？打开{' '}
            <a className={cls('link-btn')} href="https://www.qingwu.ink" target="_blank" rel="noreferrer">
              www.qingwu.ink
            </a>{' '}
            看一眼即可（Vercel 大约 1 分钟生效）。
          </span>
        </div>
      )}

      {/* 「加一条定时」的表单：居中弹窗（原来是页面里的内联表单块） */}
      <Modal
        open={schedOpen}
        onClose={() => setSchedOpen(false)}
        title="加一条定时"
        sub="到点由服务器自己跑一遍发布 · 每 15 秒检查一次"
        width={640}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSchedOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              icon={CalendarClock}
              loading={schedBusy}
              disabled={!at}
              onClick={addSchedule}
            >
              {schedBusy ? '添加中…' : '加一条定时'}
            </Button>
          </>
        }
      >
        {/* 失败提示也要在弹窗里看得见（页顶那条横幅被遮罩挡住了） */}
        {error && (
          <div
            className={cls('alert-calm')}
            role="alert"
            style={{ background: 'var(--red-soft)', color: 'var(--red-text)', marginBottom: 14 }}
          >
            <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
            <span>{error}</span>
          </div>
        )}

        <div className={cls('form-grid')}>
          <Field label="什么时候发">
            <TextInput type="datetime-local" value={at} onChange={setAt} />
          </Field>
          <Field label="发哪篇（可不选 = 发布当时所有待发布改动）" group>
            <Select value={articleId} options={articleOptions} onChange={setArticleId} filterable />
          </Field>
          <Field label="备注（选填）" wide>
            <TextInput value={note} onChange={setNote} placeholder="例如：早上八点发新文章" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
