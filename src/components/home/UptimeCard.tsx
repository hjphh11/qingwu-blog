import { useEffect, useState } from 'react';

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

  useEffect(() => {
    const t = setInterval(() => setU(diff(new Date())), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 text-sm text-ink/60">
        <span>⏳</span>
        <span className="uppercase tracking-wide">本站已运行</span>
      </div>
      <p className="mt-2 font-display text-2xl text-crimson tabular-nums">
        {u.days} 天 {u.hours}:{String(u.mins).padStart(2, '0')}:
        {String(u.secs).padStart(2, '0')}
      </p>
    </div>
  );
}
