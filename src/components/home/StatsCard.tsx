import { useEffect, useState } from 'react';

export default function StatsCard({ articleCount = 0 }: { articleCount?: number }) {
  const [visits, setVisits] = useState(0);

  useEffect(() => {
    const key = 'qingwu:visits';
    const cur = Number(localStorage.getItem(key) || 0) + 1;
    localStorage.setItem(key, String(cur));
    setVisits(cur);
  }, []);

  const stat = (label: string, value: number) => (
    <div className="flex flex-col items-center">
      <span className="font-display text-2xl text-crimson tabular-nums">{value}</span>
      <span className="mt-1 text-xs text-ink/60">{label}</span>
    </div>
  );

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 text-sm text-ink/60">
        <span>📊</span>
        <span className="uppercase tracking-wide">小数据</span>
      </div>
      <div className="mt-3 grid grid-cols-2 divide-x divide-rose/25 text-center">
        {stat('文章', articleCount)}
        {stat('访问', visits)}
      </div>
    </div>
  );
}
