import { useEffect, useState } from 'react';

export default function StatsCard({ articleCount = 0 }: { articleCount?: number }) {
  const [visits, setVisits] = useState(0);
  const [visitors, setVisitors] = useState(0);

  useEffect(() => {
    const vKey = 'qingwu:visits';
    const pKey = 'qingwu:visitors';
    const seenKey = 'qingwu:seen';

    const cur = Number(localStorage.getItem(vKey) || 0) + 1;
    localStorage.setItem(vKey, String(cur));
    setVisits(cur);

    if (!localStorage.getItem(seenKey)) {
      localStorage.setItem(seenKey, '1');
      const pc = Number(localStorage.getItem(pKey) || 0) + 1;
      localStorage.setItem(pKey, String(pc));
      setVisitors(pc);
    } else {
      setVisitors(Number(localStorage.getItem(pKey) || 1));
    }
  }, []);

  const row = (icon: string, label: string, value: number, unit: string) => (
    <div className="flex items-center justify-between border-b border-rose/15 pb-2 text-sm last:border-0 last:pb-0">
      <span className="flex items-center gap-2 text-ink/70">
        <span>{icon}</span>
        {label}
      </span>
      <span className="font-display text-lg text-crimson tabular-nums">
        ··· {value} {unit}
      </span>
    </div>
  );

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 text-sm text-ink/70">
        <span>📊</span>
        <span className="font-medium">悄悄收藏的脚印 ✨</span>
      </div>
      <div className="mt-3 space-y-2">
        {row('👣', '留下的足迹', visits, '次')}
        {row('🧭', '来过的旅人', visitors, '位')}
        {row('📖', '写下的故事', articleCount, '篇')}
      </div>
    </div>
  );
}
