import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { ChartNoAxesColumn, Footprints, Compass, BookOpen, Sparkles } from '../../lib/icons';
import { CardShell, Skel, SkelHead } from './CardShell';

export default function StatsCard({ articleCount = 0 }: { articleCount?: number }) {
  const [visits, setVisits] = useState(0);
  const [visitors, setVisitors] = useState(0);
  // 之前这里直接渲染 visits/visitors 的初始值 0,首帧会先闪一个「0 次」再跳真值。
  // 改成:读完 localStorage 之前一律渲染骨架。
  const [ready, setReady] = useState(false);

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

    setReady(true);
  }, []);

  const row = (
    Icon: typeof Footprints,
    label: string,
    value: number,
    unit: string,
  ) => (
    <div className="flex items-center justify-between border-b border-rose/15 pb-2.5 text-sm last:border-0 last:pb-0">
      <span className="flex items-center gap-2 text-muted">
        <MorphIcon icon={Icon} size={16} className="shrink-0" color="currentColor" />
        {label}
      </span>
      <span className="font-display text-lg text-accent tabular-nums">
        {value}
        <span className="ml-0.5 text-sm">{unit}</span>
      </span>
    </div>
  );

  // 骨架逐行对应真实行:右侧数值位是 text-lg(28px 行高),左缘原样是一行 text-sm。
  const skelRow = (key: number) => (
    <div
      key={key}
      className="flex items-center justify-between border-b border-rose/15 pb-2.5 last:border-0 last:pb-0"
    >
      <span className="flex items-center gap-2">
        <Skel className="h-4 w-4 rounded-[5px]" />
        <Skel className="h-5 w-[4.5rem]" />
      </span>
      <Skel className="h-7 w-[3.5rem] rounded-lg" />
    </div>
  );

  return (
    <CardShell
      pending={!ready}
      skeleton={
        <>
          <SkelHead className="w-[8.75rem]" />
          <div className="mt-4 space-y-3">{[0, 1, 2].map(skelRow)}</div>
        </>
      }
    >
      <div className="flex items-center gap-2 text-sm text-muted">
        <MorphIcon icon={ChartNoAxesColumn} size={17} className="shrink-0" color="currentColor" />
        <span className="flex items-center gap-1 font-medium">
          悄悄收藏的脚印 <MorphIcon icon={Sparkles} size={14} color="currentColor" />
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {row(Footprints, '留下的足迹', visits, '次')}
        {row(Compass, '来过的旅人', visitors, '位')}
        {row(BookOpen, '写下的故事', articleCount, '篇')}
      </div>
    </CardShell>
  );
}
