import { useEffect, useRef, useState } from 'react';
import HanziWriter from 'hanzi-writer';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

const GREETING = '欢迎来到清吾的小屋';
const CHARS = Array.from(GREETING);
const CELL = 92;
const CELL_H = CELL + 12;

// 副标文案,按「 · 」切成三段,供逐词模糊浮现。
const SUBTITLE_PARTS = '写技术 · 记生活 · 一个温馨二次元的小角落'.split('·').map((s) => s.trim());

// 把问候语一次性画成静态字(降低动效 / 用户点「跳过」时用)。
// ⚠️ 只改格子的**内容**,绝不动格子本身 —— 格子是 React 渲染的,清空它们会让
// React 的记账对不上,下次渲染会直接报 removeChild。
function paintStatic(container: HTMLElement) {
  const cells = Array.from(container.querySelectorAll<HTMLElement>('.char-cell'));
  cells.forEach((cell, i) => {
    cell.textContent = '';
    const span = document.createElement('span');
    span.className = 'font-hand text-[88px] leading-none text-ink';
    span.textContent = CHARS[i] ?? '';
    cell.appendChild(span);
  });
}

// 首页 Hero:左=Hanzi Writer 笔顺问候,右=爱弥斯(随滚动缩小)。
export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const greetingRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);
  const emisRef = useRef<HTMLImageElement>(null);
  const [done, setDone] = useState(false);
  /** 立绘的占位层收不收,由这里说了算(原因见 JSX 里 data-media-self 的说明)。 */
  const [imgReady, setImgReady] = useState(false);
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
    // 格子在服务端就已经渲染好了,这里只取出来往里作画(见 JSX 里的说明)。
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.char-cell'));
    if (cells.length !== CHARS.length) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cancelled = false;

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

    // 降低动效:不逐笔写,直接给完整静态字(和下面 reduce 分支一致)
    if (reduceMotion) {
      paintStatic(container);
      setDone(true);
      return;
    }

    const startNext = (index: number) => {
      if (cancelled || cancelledRef.current || index >= CHARS.length) {
        if (index >= CHARS.length) setDone(true);
        return;
      }
      // 只往**已经存在**的格子里作画 —— 不再 appendChild,
      // 所以首屏这十几秒里容器高度一动不动,副标题不会再被顶上顶下。
      const writer = HanziWriter.create(cells[index], CHARS[index], {
        width: CELL,
        height: CELL_H,
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
    return () => {
      cancelled = true;
    };
  }, []);

  // 立绘占位层:self-managed,并且补一次「命中缓存」的判定 ——
  // 那种情况下 img 的 load 事件不会再触发,不补就会一直停在占位层上。
  useEffect(() => {
    const img = emisRef.current;
    if (img?.complete && img.naturalWidth > 0) setImgReady(true);
  }, []);

  const skip = () => {
    cancelledRef.current = true;
    const c = greetingRef.current;
    if (c) paintStatic(c);
    setDone(true);
  };

  return (
    <section
      ref={heroRef}
      className="relative flex min-h-[min(88svh,44rem)] items-stretch px-6 pb-16 pt-24 sm:pt-28"
    >
      <div className="mx-auto flex w-full max-w-[1080px] flex-col items-center gap-8 md:flex-row md:items-start md:justify-between md:gap-12">
        {/* 左:大号笔顺问候,顶到左上角 */}
        <div className="order-2 flex w-full max-w-[680px] flex-1 flex-col md:order-1 md:self-start">
          {/* 首页原本没有任何 h1(笔顺问候是 canvas,不是文本节点),
              屏幕阅读器和 SEO 都拿不到页面主标题。这里补一个视觉隐藏的 h1。 */}
          <h1 className="sr-only">欢迎来到清吾的小屋 · 清吾的个人博客</h1>
          <div ref={greetingRef} className="flex flex-wrap gap-2" aria-hidden="true">
            {/* 「先占位,再作画」:格子在这里(服务端)一次渲染好,容器高度从第一帧
                起就是最终高度;后面逐字作画只在**已有格子**里落笔。
                之前是「一个字画完才 appendChild 下一个」,首屏十几秒里副标题被顶上
                顶下三次(+104 / +112 / −44px)。
                ⚠️ 格子归 React 管,JS 只能改它们的**内容**(HanziWriter 的 svg /
                静态字),不要增删格子本身。 */}
            {CHARS.map((_, i) => (
              <div key={i} className="char-cell" style={{ width: CELL, height: CELL_H }} />
            ))}
          </div>
          {/* 逐字写完要十几秒,给急性子一个「直接看完整版」的出口。
              用 invisible 而不是从 DOM 里摘掉 —— 按钮自己消失会把下面的副标题
              往上带 40px,那是白白多出来的一次位移。 */}
          {!reduce && (
            <button
              type="button"
              onClick={skip}
              className={`mt-3 -ml-2 w-fit rounded-lg px-2 py-2 text-xs text-subtle underline decoration-dotted underline-offset-4 transition-colors hover:text-accent ${
                done ? 'invisible' : ''
              }`}
            >
              跳过笔顺动画
            </button>
          )}
          {/* 副标:逐词模糊浮现(借鉴 MotionVault「blur-fade-in」,MIT,按爱弥斯暖色重写) */}
          <p className="mt-7 text-base leading-relaxed text-ink/75">
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
                    {i > 0 && <span className="mx-2 text-crimson/70" aria-hidden="true">·</span>}
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

        {/* 右:爱弥斯(偏大、垂直居中,随滚动缩小并淡出)
            小屏上单独给一个较小的高度上限 —— 之前一律 h-[75svh],在手机上立绘
            几乎占满一屏,把问候挤到下面且首屏完全看不到正文。

            ⚠️ data-emis-hero 是开屏「归位」的落点:开屏层的爱弥斯用 FLIP 平移到
            这个元素的矩形上(运行时测量,所以三档视口共用一段代码)。
            它的 drop-shadow 也必须与 Splash.tsx 里的 SHADOW_* 三个常量一致 ——
            交接时两张图重叠,阴影不同就能看出换手。 */}
        <motion.div
          style={{ scale, opacity }}
          className="order-1 flex shrink-0 justify-center md:order-2 md:self-center"
        >
          {/* q-media = 玫瑰渐变占位 + 加载完淡出(见 global.css 第 ⑥ 条)。
              立绘的盒子本来就被 width/height + h-[·svh] 锁死了,所以这里防的是
              「白 → 图」那一下硬切,不是 CLS。
              ⚠️ data-media-self:这个容器的 is-loaded 由**组件自己**管(下面的 imgReady),
              不能让 Layout 的全局脚本在水合前改 class —— 实测会触发 React 的
              hydration mismatch(`q-media` vs `q-media is-loaded`)。 */}
          <picture data-media-self className={`q-media${imgReady ? ' is-loaded' : ''}`}>
            <source srcSet="/images/emis/full.webp" type="image/webp" />
            <img
              ref={emisRef}
              data-emis-hero
              src="/images/emis/full.png"
              alt="爱弥斯"
              width={480}
              height={760}
              fetchPriority="high"
              decoding="async"
              onLoad={() => setImgReady(true)}
              onError={() => setImgReady(true)}
              className="h-[46svh] w-auto max-w-[70vw] object-contain drop-shadow-[0_18px_40px_rgba(246,165,184,0.35)] sm:h-[58svh] md:h-[64svh] md:max-w-[44vw]"
            />
          </picture>
        </motion.div>
      </div>
    </section>
  );
}
