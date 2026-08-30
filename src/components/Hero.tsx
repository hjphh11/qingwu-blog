import { useEffect, useRef } from 'react';
import HanziWriter from 'hanzi-writer';
import { motion, useScroll, useTransform } from 'motion/react';

const GREETING = '欢迎来到清吾的小屋';
const CELL = 76;

// 首页 Hero:左=Hanzi Writer 笔顺问候,右=爱弥斯(随滚动缩小)。
export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const greetingRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.75]);
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0.15]);

  useEffect(() => {
    const container = greetingRef.current;
    if (!container) return;
    container.innerHTML = '';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const chars = Array.from(GREETING);

    const loadData = (
      char: string,
      onLoad: (data: any) => void,
      onError: (err?: any) => void,
    ) => {
      fetch(`/hanzi/${char}.json`)
        .then((r) => r.json())
        .then((data) => onLoad(data))
        .catch((err) => onError(err));
    };

    const startNext = (index: number) => {
      if (index >= chars.length) return;
      const cell = document.createElement('div');
      cell.className = 'char-cell';
      cell.style.width = `${CELL}px`;
      cell.style.height = `${CELL + 8}px`;
      container.appendChild(cell);

      if (reduce) {
        const span = document.createElement('span');
        span.className = 'font-hand text-[64px] leading-none text-ink';
        span.textContent = chars[index];
        cell.appendChild(span);
        startNext(index + 1);
        return;
      }

      const writer = HanziWriter.create(cell, chars[index], {
        width: CELL,
        height: CELL + 8,
        padding: 4,
        delayBetweenStrokes: 110,
        showCharacter: false,
        showOutline: true,
        strokeColor: '#4a3728',
        outlineColor: 'rgba(74, 55, 40, 0.25)',
        charDataLoader: loadData,
      });
      writer
        .animateCharacter({
          onComplete: () => startNext(index + 1),
        })
        .catch(() => startNext(index + 1));
    };

    startNext(0);
  }, []);

  return (
    <section
      ref={heroRef}
      className="relative flex min-h-[92svh] flex-col items-center justify-center gap-8 px-6 py-16 md:flex-row md:justify-between md:gap-12"
    >
      {/* 左:笔顺问候 */}
      <div className="order-2 flex w-full max-w-[640px] flex-1 flex-col md:order-1">
        <div
          ref={greetingRef}
          className="flex flex-wrap gap-2"
          aria-label={GREETING}
          role="text"
        />
        <p className="mt-8 text-base text-ink/70">
          写技术 · 记生活 · 一个温馨二次元的小角落
        </p>
      </div>

      {/* 右:爱弥斯(随滚动缩小并淡出) */}
      <motion.div
        style={{ scale, opacity }}
        className="order-1 flex justify-center md:order-2"
      >
        <img
          src="/images/emis/full.png"
          alt="爱弥斯"
          width={480}
          height={760}
          className="h-[56svh] w-auto max-w-full object-contain drop-shadow-[0_18px_40px_rgba(246,165,184,0.35)]"
        />
      </motion.div>
    </section>
  );
}
