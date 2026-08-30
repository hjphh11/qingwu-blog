import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Clock } from '../../lib/icons';

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
      <div className="flex items-center gap-2 text-sm text-ink/70">
        <MorphIcon icon={Clock} size={17} className="shrink-0" color="currentColor" />
        <span className="font-medium">现在几点啦 ₍ᐢ..ᐢ₎</span>
      </div>
      <p className="mt-2 font-display text-3xl text-crimson tabular-nums">{time}</p>
      <p className="mt-1 text-sm text-ink/60">{date}</p>
    </div>
  );
}
