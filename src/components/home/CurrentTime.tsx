import { useEffect, useState } from 'react';

export default function CurrentTime() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = now.toLocaleTimeString('zh-CN', { hour12: false });
  const date = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 text-sm text-ink/60">
        <span>⏰</span>
        <span className="uppercase tracking-wide">当前时间</span>
      </div>
      <p className="mt-2 font-display text-3xl text-crimson tabular-nums">{time}</p>
      <p className="mt-1 text-sm text-ink/60">{date}</p>
    </div>
  );
}
