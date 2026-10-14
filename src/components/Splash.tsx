import { useEffect, useRef, useState } from 'react';

/**
 * 挂在 window 上的两个调试/验收用挂载点。
 *
 * 故意写成局部类型断言而不是 `declare global` —— 声明进全局 Window 会顺手
 * 影响项目里其它引用 window 的文件(比如 docs/review 下那几份验收脚本),
 * 把 npm run check 的提示数从 7 条顶到 15 条。
 *
 * · `__qSplashLog`:开屏事件日志(带时间戳)。验收要求「用带时间戳的事件日志
 *   核对,不能靠肉眼看」,所以常驻一份;每次播放清空重记,元素形如
 *   `{ t: 415, ev: 'phase-B-start' }`。
 * · `__qSplashTaken`:开屏层是否已接管,供 Layout 那段关键脚本的兜底定时器判断。
 */
type SplashWindow = Window & {
  __qSplashLog?: { t: number; ev: string }[];
  __qSplashTaken?: boolean;
};

/* ────────────────────────────────────────────────────────────────
   开屏动画 —— 爱弥斯现身 → 打招呼 → FLIP 位移归位到首页立绘原位

   三阶段时间线、实测数据、四条硬约束与验收清单见
   docs/开屏与全部加载动画-完整设计文档.html 第 02 节。

   两个「必须」:
   · 只在首页播 —— 归位要靠首页立绘的原位([data-emis-hero]),别的页面没有落点。
   · 每会话一次 —— sessionStorage 记着。同一次访问里 ClientRouter 切页绝不重播,
     关掉标签页再进才播。所以老访客几乎无感,新访客有仪式感。

   ⚠️ 判定条件必须与 Layout.astro 里那段 is:inline 关键脚本**完全一致**
   (它负责在首帧之前铺幕布、藏立绘、锁滚动)。两处不一致会出现
   「幕布铺上了但没人来收」—— 访客被锁在没有立绘、不能滚动的页面上。
   ──────────────────────────────────────────────────────────────── */

/** sessionStorage 键:每会话只播一次。 */
const KEY = 'qingwu:splash';
/** 打招呼文案。默认沿用首页笔顺问候的同一句话(单一来源)。 */
const GREET = '欢迎来到清吾的小屋';
/** 归位位移时长(固定)。 */
const MOVE_MS = 820;
/** 蒙层先散开 120ms,位移再跟上。⚠️ 它是总时长算式的一部分(见下)。 */
const HANDOFF_DELAY = 120;
/** 点「跳过」时的位移时长与收尾。 */
const SKIP_MOVE_MS = 620;
const SKIP_TAIL_MS = 40;
/** 开屏只在首页。 */
const HOME = '/';

/* 立绘投影。⚠️ 这三个值必须和 Hero.tsx 里首页立绘的 drop-shadow 一致 ——
   归位交接时两张图重叠,阴影不同就能看出换手。 */
const SHADOW_Y = 18;
const SHADOW_BLUR = 40;
const SHADOW_COLOR = 'rgba(246, 165, 184, 0.35)';

/**
 * 投影按缩放倒数补一份。
 *
 * 为什么需要:`filter: drop-shadow()` 是在元素自己的坐标系里算的,元素一旦被
 * `transform: scale(s)` 放大 s 倍,连投影也一起被放大 s 倍。开屏的爱弥斯是被
 * 「位移 + 放大」送到首页立绘上的(桌面要约 2.9 倍),投影值若不动,落位那一刻
 * 它的投影会比首页立绘大 2.9 倍 —— 撤掉开屏层的瞬间就会看到阴影跳一下。
 * 按目标缩放反算一份,末端渲染出来正好等于首页立绘的投影。
 */
function shadowAt(scale: number) {
  const y = (SHADOW_Y / scale).toFixed(2);
  const blur = (SHADOW_BLUR / scale).toFixed(2);
  return `blur(0px) drop-shadow(0 ${y}px ${blur}px ${SHADOW_COLOR})`;
}

/**
 * FLIP 交接:把 el 从「当前视觉位置」平稳地移到 target 的矩形(shared-element handoff)。
 *
 * 难点:el 身上已经有一个 `translate(-50%, -50%)` 的居中变换,直接覆写 `transform`
 * 会丢掉居中、跳一帧。
 * 做法:先把 `transform` 清掉、量出一个「未变换基准 base」,此后所有变换都
 * **相对 base** 表达 —— 既不丢居中,也不需要硬编码任何坐标,桌面(右侧偏上)/
 * 平板 / 手机(顶部居中)三套布局用同一段代码都对得上。
 *
 * transform 与 filter 一起过渡:投影的渲染尺寸 = 值 × 当前缩放,两端连续,
 * 不会在起手或落位时跳(见 shadowAt)。
 */
function flipTo(el: HTMLElement, target: DOMRect, ms: number, fromRect?: DOMRect) {
  const from = fromRect ?? el.getBoundingClientRect();

  el.style.transition = 'none';
  el.style.transform = 'none';
  // 未变换基准。getBoundingClientRect 同步强制重排,所以不会闪。
  const base = el.getBoundingClientRect();
  if (!base.height || !target.height) return;

  el.style.transformOrigin = 'top left';
  // 先精确摆回「原来的视觉位置」,保证这一帧没有跳变。
  el.style.transform =
    `translate(${(from.left - base.left).toFixed(1)}px, ${(from.top - base.top).toFixed(1)}px) ` +
    `scale(${(from.height / base.height).toFixed(4)})`;
  // 强制重排,让浏览器吃下这个起点(否则起点与目标会并成一帧,看不到过渡过程)。
  void el.offsetWidth;

  const scale = target.height / base.height;
  el.style.transition =
    `transform ${ms}ms cubic-bezier(.16, 1, .3, 1), ` +
    `filter ${ms}ms cubic-bezier(.16, 1, .3, 1)`;
  el.style.transform =
    `translate(${(target.left - base.left).toFixed(1)}px, ${(target.top - base.top).toFixed(1)}px) ` +
    `scale(${scale.toFixed(4)})`;
  el.style.filter = shadowAt(scale);
}

/**
 * 元素**实际画出来的**那部分图的矩形。
 *
 * 为什么需要:首页立绘同时有 `md:h-[64svh]` 和 `md:max-w-[44vw]`,`object-contain`
 * 会把图缩到能塞进盒子里、空白补在四周 —— 于是「元素矩形」会比「真正看得见的立绘」
 * 大一圈。820×1000 就是这种情况:盒子 360.8×640,画出来的其实是 360.8×556。
 * 归位要对齐的是**看得见的立绘**,不是盒子,否则落位那一刻开屏的爱弥斯会比立绘
 * 大 15%(实测宽度差 54.5px)。
 * 按图的原始比例把内容矩形算出来(居中,与 contain 的规则一致)。
 */
function contentRect(el: HTMLImageElement): DOMRect {
  const r = el.getBoundingClientRect();
  const nw = el.naturalWidth;
  const nh = el.naturalHeight;
  if (!nw || !nh || !r.width || !r.height) return r;
  const ratio = nw / nh;
  let w = r.width;
  let h = w / ratio;
  if (h > r.height) {
    h = r.height;
    w = h * ratio;
  }
  return new DOMRect(r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h);
}

interface Props {
  /** 三阶段总时长(ms)。三档:1600 紧凑 / 2000 默认 / 2400 舒展。 */
  dur?: number;
  /** 打招呼文案(逐字浮现)。字数变了间隔会自动重算。 */
  text?: string;
  /** 归位方式。'flip' = 位移交接(默认);'fade' = 原地淡出(对照用)。 */
  reveal?: 'flip' | 'fade';
}

export default function Splash({ dur = 2000, text = GREET, reveal = 'flip' }: Props) {
  const [show, setShow] = useState(false);
  const splashRef = useRef<HTMLDivElement>(null);
  const emisRef = useRef<HTMLImageElement>(null);
  const greetRef = useRef<HTMLDivElement>(null);
  /** 跳过的入口。放 ref 里,让「跳过」按钮和全局的按键/滚动意图共用一份实现。 */
  const skipRef = useRef<() => void>(() => {});

  // —— 决定这一次播不播 ——
  useEffect(() => {
    let play = false;
    try {
      play = window.location.pathname === HOME && !sessionStorage.getItem(KEY);
      if (play) sessionStorage.setItem(KEY, '1');
    } catch {
      // sessionStorage 不可用(隐私模式等):当作已看过,直接看内容,不冒险播。
      play = false;
    }
    // 告诉 Layout 那段关键脚本:开屏层已经接管,兜底定时器可以放心了。
    (window as SplashWindow).__qSplashTaken = true;
    if (play) setShow(true);
    else document.documentElement.classList.remove('q-splash-pending');
  }, []);

  // —— 三阶段时间线 ——
  useEffect(() => {
    if (!show) return;
    const splash = splashRef.current;
    const emis = emisRef.current;
    const greet = greetRef.current;
    if (!splash || !emis || !greet) return;

    const root = document.documentElement;
    // 幕布交还给开屏层:撤掉关键脚本铺的奶油底,改由 .q-splash 承接。
    root.classList.remove('q-splash-pending');
    root.classList.add('q-splash-running');

    const heroImg = document.querySelector<HTMLImageElement>('[data-emis-hero]');
    const timers: number[] = [];
    let finished = false;

    // 事件日志:验收要按时间戳核对「三档总时长」「问候先写完再位移」这些,
    // 所以每个阶段都打一个点(见 docs 第 07 节验收清单)。
    const t0 = performance.now();
    const log: { t: number; ev: string }[] = [];
    (window as SplashWindow).__qSplashLog = log;
    const mark = (ev: string) => log.push({ t: Math.round(performance.now() - t0), ev });
    mark('play-start');

    const later = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(fn, ms));
    };
    const clearTimers = () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.length = 0;
    };

    /** 收尾:先放出首页真身(此刻位置与开屏层完全重合,看不出切换),再撤开屏层。 */
    const finish = () => {
      if (finished) return;
      finished = true;
      mark('hidden');
      root.classList.remove('q-splash-running');
      setShow(false);
    };

    /** 位移归位。返回 false 表示量不到落点(理论上不会发生),调用方改走淡出。 */
    const handoff = (ms: number) => {
      if (!heroImg) return false;
      const from = contentRect(emis);
      // 对齐「画出来的立绘」而不是元素盒子 —— 详见 contentRect 的说明
      const target = contentRect(heroImg);
      if (!from.height || !target.height) return false;
      flipTo(emis, target, ms, from);
      return true;
    };

    /** 跳过:从点击那一刻算起 ≤ 900ms 完成归位(文档实测 669ms)。 */
    const skipNow = () => {
      if (finished) return;
      clearTimers();
      mark('skip');
      // ⚠️ 必须先摘掉 is-nod:CSS 动画的 transform 会整体盖掉 inline 的 FLIP。
      emis.classList.remove('is-nod');
      splash.classList.add('is-leaving');
      if (reveal !== 'flip' || !handoff(SKIP_MOVE_MS)) {
        emis.style.transition = `opacity ${SKIP_MOVE_MS}ms ease`;
        emis.style.opacity = '0';
      }
      later(finish, SKIP_MOVE_MS + SKIP_TAIL_MS);
    };
    skipRef.current = skipNow;

    /* ── 降低动效:约 240ms 纯淡出,不位移、不呼吸、不逐字 ──
       文档约定:这种模式下问候**根本不出现**(不是渲染了再藏起来)。 */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      emis.style.transform = 'translate(-50%, -50%)';
      emis.style.filter = shadowAt(1);
      emis.style.transition = 'opacity 0.22s linear';
      emis.style.opacity = '1';
      later(() => {
        splash.classList.add('is-leaving');
        emis.style.opacity = '0';
        mark('quiet-out');
        later(finish, 180);
      }, 66);
    } else {
      /* ── 阶段切分 ──
         总时长必须精确等于 dur,所以位移的触发点要把它后面所有环节都减掉:
           dur = moveAt + HANDOFF_DELAY + MOVE_MS  →  moveAt = dur − 820 − 120
         (第一版漏掉了 HANDOFF_DELAY,标称 2.0s 实测跑到 2073ms。) */
      const moveAt = Math.max(300, dur - MOVE_MS - HANDOFF_DELAY);
      const phaseA = Math.round(moveAt * 0.39);

      const spans = Array.from(text).map((ch) => {
        const s = document.createElement('span');
        s.textContent = ch;
        greet.appendChild(s);
        return s;
      });

      // 阶段 A:现身
      later(() => {
        emis.classList.add('is-in');
        mark('phase-A-in');
      }, 60);
      // 轻轻点头一次。⚠️ 塞不下就整段跳过 —— 绝不让它被位移打断(1.6s 档就是这种情况)。
      const nodAt = phaseA - 120;
      if (nodAt > 0 && nodAt + 700 <= moveAt) {
        later(() => {
          emis.classList.add('is-nod');
          mark('emis-nod');
        }, nodAt);
      }

      // 阶段 B:问候逐字浮现。
      // 间隔数是 (字数 − 1) —— 按固定值算会让最后两个字还在浮现时位移就开始了。
      const budget = Math.max(120, moveAt - 300 - phaseA);
      const perChar = Math.min(
        100,
        Math.max(42, Math.round(budget / Math.max(1, spans.length - 1))),
      );
      spans.forEach((s, i) => {
        later(() => {
          s.classList.add('is-in');
          if (i === 0) mark('phase-B-start');
          if (i === spans.length - 1) mark('phase-B-done');
        }, phaseA + i * perChar);
      });

      // 阶段 C:暖光 + 蒙层 + 问候一起散开
      later(() => {
        splash.classList.add('is-leaving');
        mark('phase-C');
      }, moveAt);

      // 延后 HANDOFF_DELAY 再启动位移,让「蒙层开始散开」先被看见。
      later(() => {
        emis.classList.remove('is-nod');
        if (reveal === 'fade') {
          emis.style.transition = `opacity ${MOVE_MS}ms ease`;
          emis.style.opacity = '0';
          mark('handoff-fade');
        } else if (!handoff(MOVE_MS)) {
          // 找不到首页立绘(理论上不会发生):退化成淡出,而不是留在原地不动。
          emis.style.transition = `opacity ${MOVE_MS}ms ease`;
          emis.style.opacity = '0';
          mark('handoff-fade');
        } else {
          mark('handoff-flip');
        }
      }, moveAt + HANDOFF_DELAY);

      // 归位结束:撤掉开屏层,首页真身显形(位置已完全重合,看不出切换)
      later(() => {
        mark('handoff-done');
        finish();
      }, moveAt + HANDOFF_DELAY + MOVE_MS);
    }

    /* ── 随时可中断:任意点击 / 按键 / 滚动意图都立即进入阶段 C ── */
    const onIntent = () => skipNow();
    // 切后台:直接收尾,而不是「暂停」。开屏是一次性的、靠一串定时器推进,
    // 真做暂停要把每个阶段分别冻结再续上,复杂且容易卡在半路;直接收尾更稳 ——
    // 回来时看到的就是正常页面。(持续动画的暂停由 .qhidden 那一套负责。)
    const onVisibility = () => {
      if (document.hidden) {
        clearTimers();
        finish();
      }
    };

    document.addEventListener('keydown', onIntent);
    window.addEventListener('wheel', onIntent, { passive: true });
    window.addEventListener('touchmove', onIntent, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimers();
      document.removeEventListener('keydown', onIntent);
      window.removeEventListener('wheel', onIntent);
      window.removeEventListener('touchmove', onIntent);
      document.removeEventListener('visibilitychange', onVisibility);
      // 组件以任何方式被卸载(含切页)都必须把这两个标记清干净,
      // 否则访客会被锁在没有立绘、不能滚动的页面上。
      root.classList.remove('q-splash-pending', 'q-splash-running');
    };
  }, [show, dur, text, reveal]);

  if (!show) return null;

  return (
    <div ref={splashRef} className="q-splash" onClick={() => skipRef.current()}>
      <div className="q-splash__bg" aria-hidden="true" />
      <div className="q-splash__glow" aria-hidden="true" />
      <picture className="contents">
        <source srcSet="/images/emis/full.webp" type="image/webp" />
        <img
          ref={emisRef}
          className="q-splash__emis"
          src="/images/emis/full.png"
          alt=""
          aria-hidden="true"
          width={480}
          height={760}
          fetchPriority="high"
          decoding="async"
        />
      </picture>
      <div ref={greetRef} className="q-splash__greet" aria-hidden="true" />
      <button type="button" className="q-splash__skip" onClick={() => skipRef.current()}>
        跳过
      </button>
    </div>
  );
}
