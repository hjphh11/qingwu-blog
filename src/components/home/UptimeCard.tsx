import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Timer, Sparkles } from '../../lib/icons';
import { CardShell, Skel, SkelHead } from './CardShell';

// 本站运行时长:以某个上线日期为起点,实时累加。
const LAUNCH = '2026-08-30T14:00:00+08:00';

type Uptime = { days: number; hours: number; mins: number; secs: number };

function diff(now: Date): Uptime {
  const ms = Math.max(0, now.getTime() - new Date(LAUNCH).getTime());
  return {
    days: Math.floor(ms / 86400000),
    hours: Math.floor((ms / 3600000) % 24),
    mins: Math.floor((ms / 60000) % 60),
    secs: Math.floor((ms / 1000) % 60),
  };
}

export default function UptimeCard() {
  const [u, setU] = useState<Uptime>(() => diff(new Date()));
  // 同上:首帧渲染骨架,避免服务端/客户端时间不同导致水合对不上。
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    const t = setInterval(() => setU(diff(new Date())), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <CardShell
      pending={!ready}
      skeleton={
        <>
          <SkelHead className="w-[9.5rem]" />
          {/* 与真实的大号时长同高:text-2xl(24px) + leading-none */}
          <p className="mt-2.5">
            <Skel className="h-6 w-[9.5rem] rounded-lg" />
          </p>
        </>
      }
    >
      <div className="flex items-center gap-2 text-sm text-muted">
        <MorphIcon icon={Timer} size={17} className="shrink-0" color="currentColor" />
        <span className="flex items-center gap-1 font-medium">
          这里陪你多久啦 <MorphIcon icon={Sparkles} size={14} color="currentColor" />
        </span>
      </div>
      <p className="mt-2.5 font-display text-2xl leading-none text-crimson tabular-nums">
        {u.days}
        <span className="mx-1 text-base">天</span>
        {u.hours}:{String(u.mins).padStart(2, '0')}:
        {String(u.secs).padStart(2, '0')}
      </p>
    </CardShell>
  );
}
