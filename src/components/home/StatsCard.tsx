import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { ChartNoAxesColumn, Footprints, Compass, BookOpen, Sparkles } from '../../lib/icons';
import { WORKER_BASE } from '../../lib/workerBase';
import { CardShell, Skel, SkelHead } from './CardShell';

/**
 * 全站汇总的模块级缓存（60s）。
 *
 * 为什么放模块级：这张卡在首页，而 ClientRouter 每次切回首页都会重新挂载。
 * 没有缓存的话「回首页一次打一次 /site-summary」，来回点两下就是两次跨境请求；
 * 服务端虽然也缓存 60s，但浏览器这侧没必要重复发。
 * TTL 与 worker/src/summary.ts 的 CACHE_SECONDS 对齐，别一边 60 一边 300。
 */
const SUMMARY_TTL = 60_000;
let cached: { pv: number; uv: number; at: number } | null = null;

/** 本地计数（离线兜底）：没有网络 / 接口挂了时，至少还有「这台机器来过几次」 */
function readLocalCounter(): { visits: number; visitors: number } {
  const vKey = 'qingwu:visits';
  const pKey = 'qingwu:visitors';
  const seenKey = 'qingwu:seen';

  const visits = Number(localStorage.getItem(vKey) || 0) + 1;
  localStorage.setItem(vKey, String(visits));

  let visitors: number;
  if (!localStorage.getItem(seenKey)) {
    localStorage.setItem(seenKey, '1');
    visitors = Number(localStorage.getItem(pKey) || 0) + 1;
    localStorage.setItem(pKey, String(visitors));
  } else {
    visitors = Number(localStorage.getItem(pKey) || 1);
  }
  return { visits, visitors };
}

export default function StatsCard({ articleCount = 0 }: { articleCount?: number }) {
  const [visits, setVisits] = useState(0);
  const [visitors, setVisitors] = useState(0);
  // 之前这里直接渲染 visits/visitors 的初始值 0,首帧会先闪一个「0 次」再跳真值。
  // 改成:读完 localStorage 之前一律渲染骨架。
  const [ready, setReady] = useState(false);
  /** 数字是否来自全站汇总（false = 还没拿到，显示的是本机计数） */
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    let timer = 0;

    // ① 先把本机计数摆上：无网时它就是唯一的数据源，也避免骨架一直挂着
    let local = { visits: 0, visitors: 0 };
    try {
      local = readLocalCounter();
    } catch {
      /* 隐私模式禁了 localStorage —— 不计数，但卡片照常显示 */
    }
    setVisits(local.visits);
    setVisitors(local.visitors);
    setReady(true);

    // ② 再换成全站真值。命中 60s 缓存就不发请求（回首页那次最常遇到）
    if (cached && Date.now() - cached.at < SUMMARY_TTL) {
      setVisits(cached.pv);
      setVisitors(cached.uv);
      setLive(true);
      return;
    }

    try {
      controller = new AbortController();
      // 6s 兜底：首页不能被一个装饰性数字的请求吊着
      timer = window.setTimeout(() => controller?.abort(), 6000);

      fetch(`${WORKER_BASE}/site-summary`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: { ok?: boolean; pv?: number; uv?: number } | null) => {
          if (!alive || !data || data.ok !== true) return;
          const pv = Number(data.pv);
          const uv = Number(data.uv);
          if (!Number.isFinite(pv)) return;
          cached = { pv, uv: Number.isFinite(uv) ? uv : 0, at: Date.now() };
          setVisits(pv);
          setVisitors(cached.uv);
          setLive(true);
        })
        .catch(() => {
          /* 拿不到就保持本机计数 —— 打点失败本来就不该影响页面 */
        })
        .finally(() => window.clearTimeout(timer));
    } catch {
      /* fetch 被环境禁用时同样退回本机计数 */
    }

    return () => {
      alive = false;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  /* 三个数字改成**横排三列**。
     原来是三行、每行一条分隔线，整张卡 208px —— 右栏五张卡加起来 911px，
     比 1440×900 的可用高度（772px）还高，于是右栏永远没法跟左栏一样完整吸顶。
     横排之后同信息量只用 135px（省 73），右栏才装得进一屏。
     顺序没变，读起来还是「足迹 / 旅人 / 故事」。 */
  const cell = (Icon: typeof Footprints, label: string, value: number, unit: string) => (
    <div className="flex flex-col items-center gap-0.5">
      <MorphIcon icon={Icon} size={15} className="shrink-0 text-crimson/70" color="currentColor" />
      <span className="font-display text-lg leading-tight text-accent tabular-nums">
        {value}
        <span className="ml-0.5 text-xs">{unit}</span>
      </span>
      <span className="text-[0.6875rem] leading-tight text-subtle">{label}</span>
    </div>
  );

  // 骨架与真实布局一一对应：三列，每列「图标 / 数字 / 标签」
  const skelCell = (key: number) => (
    <div key={key} className="flex flex-col items-center gap-1">
      <Skel className="h-[15px] w-[15px] rounded-[5px]" />
      <Skel className="h-5 w-8 rounded-md" />
      <Skel className="h-3 w-12" />
    </div>
  );

  /* 数字的口径要说清楚：拿到全站汇总才是「全站」，否则是本机计数。
     卡片高度已经被右栏预算卡死（见上面那段注释），所以不另加一行说明，
     而是把口径塞进 title / aria-label —— 悬停能看到，读屏能听到，不占高度。
     这一条比数字本身重要：图上那个「旅人 1 位」就是没写清口径的后果。 */
  const source = live ? '全站统计' : '本机计数（全站数据暂不可用）';
  const summaryLabel = `留下的足迹 ${visits} 次，来过的旅人 ${visitors} 位，写下的故事 ${articleCount} 篇 · 数据来源：${source}`;

  return (
    <CardShell
      pending={!ready}
      skeleton={
        <>
          <SkelHead className="w-[8.75rem]" />
          <div className="mt-4 grid grid-cols-3">{[0, 1, 2].map(skelCell)}</div>
        </>
      }
    >
      <div className="flex items-center gap-2 text-sm text-muted">
        <MorphIcon icon={ChartNoAxesColumn} size={17} className="shrink-0" color="currentColor" />
        <span className="flex items-center gap-1 font-medium">
          悄悄收藏的脚印 <MorphIcon icon={Sparkles} size={14} color="currentColor" />
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3" role="group" aria-label={summaryLabel} title={source}>
        {cell(Footprints, '留下的足迹', visits, '次')}
        {cell(Compass, '来过的旅人', visitors, '位')}
        {cell(BookOpen, '写下的故事', articleCount, '篇')}
      </div>
    </CardShell>
  );
}
