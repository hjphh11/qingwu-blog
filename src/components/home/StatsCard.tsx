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
      <div className="mt-4 grid grid-cols-3">
        {cell(Footprints, '留下的足迹', visits, '次')}
        {cell(Compass, '来过的旅人', visitors, '位')}
        {cell(BookOpen, '写下的故事', articleCount, '篇')}
      </div>
    </CardShell>
  );
}
