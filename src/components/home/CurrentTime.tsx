import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Clock } from '../../lib/icons';
import { CardShell, Skel, SkelHead } from './CardShell';

export default function CurrentTime() {
  const [now, setNow] = useState(() => new Date());
  // 首帧(含服务端)一律渲染骨架:服务端没有「现在几点」,直接渲染 new Date()
  // 会让服务端与客户端算出不同结果,React 水合对不上。
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
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
    <CardShell
      pending={!ready}
      skeleton={
        <>
          <SkelHead className="w-[9.5rem]" />
          {/* 与真实的大号时间同高:text-3xl(30px) + leading-none */}
          <p className="mt-2.5">
            <Skel className="h-[1.875rem] w-[8.5rem] rounded-lg" />
          </p>
          {/* 与真实日期行同高:text-sm(20px 行高) */}
          <p className="mt-2">
            <Skel className="h-5 w-[10.5rem]" />
          </p>
        </>
      }
    >
      <div className="flex items-center gap-2 text-sm text-muted">
        <MorphIcon icon={Clock} size={17} className="shrink-0" color="currentColor" />
        <span className="font-medium">现在几点啦 ₍ᐢ..ᐢ₎</span>
      </div>
      <p className="mt-2.5 font-display text-3xl leading-none text-crimson tabular-nums">{time}</p>
      <p className="mt-2 text-sm text-muted">{date}</p>
    </CardShell>
  );
}
