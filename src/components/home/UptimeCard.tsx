import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Timer } from '../../lib/icons';

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
      <div className="flex items-center gap-2 text-sm text-ink/70">
        <MorphIcon icon={Timer} size={17} className="shrink-0" color="currentColor" />
        <span className="font-medium">这里陪你多久啦 ✨</span>
      </div>
      <p className="mt-2 font-display text-2xl text-crimson tabular-nums">
        {u.days} 天 {u.hours}:{String(u.mins).padStart(2, '0')}:
        {String(u.secs).padStart(2, '0')}
      </p>
    </div>
  );
}
