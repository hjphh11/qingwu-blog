/**
 * 首页 NowLine —— 一条窄带，三个信息：现在时间 · 你在哪座城 · 本站亮了多久。
 *
 * ── 为什么把五张卡压成一条 ────────────────────────────────
 * v6 §6.2：「不做统计卡片，五张卡压缩成一条 NowLine」。右栏原本五张玻璃卡（时间 / 城市 /
 * 文章数 / 技术栈 / 运行时长）加起来七百多像素，把首屏挤得只剩一篇半文章。压成一条之后
 * 首屏能多露出一篇，右栏也不再是「一堵卡片墙」。
 * 文章数与技术栈移到关于页（那才是想看细节的地方）。
 *
 * ── 三个必须守住的点 ────────────────────────────────────
 * 1. **首帧一律骨架**。时间和天数的服务端/客户端结果必然不同，直接渲染会 hydration mismatch
 *    （和原来 CurrentTime / UptimeCard 的做法一致）。
 * 2. **永远单行**：容器不允许换行，城市名超长就截断。这样骨架与真实内容**行高恒定**，
 *    不会出现「数据到位后整块长高 20px」的跳动（骨架与内容逐元素等高是既有约定）。
 * 3. **10 秒一跳**，不是 1 秒：常驻首页的时钟没必要每秒重渲染，而且只显示到分钟。
 */

import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Clock, MapPin, Sparkles } from '../../lib/icons';
import { useVisitorCity } from '../../lib/visitorCity';

/** 与 UptimeCard 同一个起点，别改两处 */
const LAUNCH = '2026-08-30T14:00:00+08:00';

function daysSince(now: Date) {
  return Math.floor(Math.max(0, now.getTime() - new Date(LAUNCH).getTime()) / 86400000);
}

export default function NowLine() {
  const [now, setNow] = useState<Date | null>(null);
  const { city, status, locate } = useVisitorCity();

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  const pending = now === null;
  const time = now ? now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '';
  const days = now ? daysSince(now) : 0;

  const cityText = status === 'granted' ? city : status === 'loading' ? '定位中' : status === 'unknown' ? '未知' : '点我定位';

  /* 骨架不用固定高度的色块，而是**同一套排版 + 占位文字**。
     一开始用 h-4 的条，实测比真实内容矮 4px（42 vs 46）—— 因为真实行高由
     `text-base` 的行盒决定，色块量不出来。换成占位文字后行盒完全一致，高度必然相等，
     而且以后改字号也不会再把这条规则弄坏。 */
  if (pending) {
    return (
      <div className="glass-card flex w-fit max-w-full items-center gap-x-2.5 px-4 py-2.5 text-sm text-muted" aria-hidden="true">
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <MorphIcon icon={Clock} size={15} className="shrink-0" color="currentColor" />
          <span className="font-display text-base text-rose/25 tabular-nums">00:00</span>
        </span>
        <Dot />
        <span className="inline-flex max-w-[7em] items-center gap-1.5">
          <MorphIcon icon={MapPin} size={15} className="shrink-0" color="currentColor" />
          <span className="truncate text-rose/25">哪座城</span>
        </span>
        <Dot />
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <MorphIcon icon={Sparkles} size={14} className="shrink-0" color="currentColor" />
          <span className="text-rose/25">
            亮了 <span className="font-display text-base tabular-nums">00</span> 天
          </span>
        </span>
      </div>
    );
  }

  return (
    /* w-fit：这条够窄，撑满整行会变成一根空玻璃条。max-w-full 兜住窄屏。
       宽度在数据到位时会变一点点（占位文字比真实文字短），这是可接受的 ——
       真正要守住的是**高度恒定**，那才是会顶动内容的部分。 */
    <div className="glass-card flex w-fit max-w-full items-center gap-x-2.5 px-4 py-2.5 text-sm text-muted">
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <MorphIcon icon={Clock} size={15} className="shrink-0" color="currentColor" />
        <span className="font-display text-base text-crimson tabular-nums">{time}</span>
      </span>

      <Dot />

      {/* 城市可能很长，唯一允许收缩的一段；其余都 shrink-0，保证永远单行 */}
      {status === 'granted' ? (
        <span className="inline-flex items-center gap-1.5">
          <MorphIcon icon={MapPin} size={15} className="shrink-0" color="currentColor" />
          {/* 城市名可能很长（「乌鲁木齐」之类）。限宽 + 截断，保证这一行不换行 */}
          <span className="max-w-[7em] truncate" title={city}>
            {cityText}
          </span>
        </span>
      ) : (
        <button
          type="button"
          onClick={locate}
          disabled={status === 'loading'}
          className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap transition-colors hover:text-accent disabled:cursor-default"
          title="允许定位后就能知道你在哪座城"
        >
          <MorphIcon icon={MapPin} size={15} className="shrink-0" color="currentColor" />
          <span>{cityText}</span>
        </button>
      )}

      <Dot />

      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <MorphIcon icon={Sparkles} size={14} className="shrink-0" color="currentColor" />
        亮了 <span className="font-display text-base text-accent tabular-nums">{days}</span> 天
      </span>
    </div>
  );
}

/** 分隔点。用玫瑰色而不是正文色，弱到不抢注意力 */
function Dot() {
  return (
    <span aria-hidden="true" className="shrink-0 text-rose/70">
      ·
    </span>
  );
}
