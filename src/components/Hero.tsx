import { useEffect, useRef } from 'react';
import HanziWriter from 'hanzi-writer';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

const GREETING = '欢迎来到清吾的小屋';
const CELL = 92;

// 副标文案,按「 · 」切成三段,供逐词模糊浮现。
const SUBTITLE_PARTS = '写技术 · 记生活 · 一个温馨二次元的小角落'.split('·').map((s) => s.trim());

// 首页 Hero:左=Hanzi Writer 笔顺问候,右=爱弥斯(随滚动缩小)。
export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const greetingRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.6]);
  const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

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
      cell.style.height = `${CELL + 12}px`;
      container.appendChild(cell);

      if (reduce) {
        const span = document.createElement('span');
        span.className = 'font-hand text-[88px] leading-none text-ink';
        span.textContent = chars[index];
        cell.appendChild(span);
        startNext(index + 1);
        return;
      }

      const writer = HanziWriter.create(cell, chars[index], {
        width: CELL,
        height: CELL + 12,
        padding: 4,
        delayBetweenStrokes: 30,
        strokeAnimationSpeed: 3,
        strokeFadeDuration: 150,
        strokeWidth: 4,
        showCharacter: false,
        showOutline: false,
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
      className="relative flex min-h-svh items-stretch px-6 pb-16 pt-28"
    >
      <div className="flex w-full flex-col items-center gap-10 md:flex-row md:items-start md:justify-between md:gap-12">
        {/* 左:大号笔顺问候,顶到左上角 */}
        <div className="order-2 flex w-full max-w-[680px] flex-1 flex-col md:order-1 md:self-start">
          <div
            ref={greetingRef}
            className="flex flex-wrap gap-2"
            aria-label={GREETING}
            role="text"
          />
          {/* 副标:逐词模糊浮现(借鉴 MotionVault「blur-fade-in」,MIT,按爱弥斯暖色重写) */}
          <p className="mt-8 text-base text-ink/70">
            {reduce ? (
              SUBTITLE_PARTS.join(' · ')
            ) : (
              <motion.span
                className="inline-flex flex-wrap items-center"
                initial="hidden"
                animate="show"
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.14, delayChildren: 0.5 } },
                }}
              >
                {SUBTITLE_PARTS.map((part, i) => (
                  <span key={i} className="inline-flex items-center">
                    {i > 0 && <span className="mx-2 text-rose" aria-hidden="true">·</span>}
                    <motion.span
                      variants={{
                        hidden: { opacity: 0, filter: 'blur(8px)', y: 8 },
                        show: {
                          opacity: 1,
                          filter: 'blur(0px)',
                          y: 0,
                          transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
                        },
                      }}
                    >
                      {part}
                    </motion.span>
                  </span>
                ))}
              </motion.span>
            )}
          </p>
        </div>

        {/* 右:爱弥斯(偏大、垂直居中,随滚动缩小并淡出) */}
        <motion.div
          style={{ scale, opacity }}
          className="order-1 flex shrink-0 justify-center md:order-2 md:self-center"
        >
          <picture>
            <source srcSet="/images/emis/full.webp" type="image/webp" />
            <img
              src="/images/emis/full.png"
              alt="爱弥斯"
              width={480}
              height={760}
              fetchPriority="high"
              decoding="async"
              className="h-[75svh] w-auto max-w-[44vw] object-contain drop-shadow-[0_18px_40px_rgba(246,165,184,0.35)]"
            />
          </picture>
        </motion.div>
      </div>
    </section>
  );
}
