import { useEffect, useRef } from 'react';

type Petal = {
  x: number;
  y: number;
  size: number;
  speedY: number;
  sway: number;
  phase: number;
  rot: number;
  rotSpeed: number;
  hue: string;
};

type Star = {
  x: number;
  y: number;
  r: number;
  baseAlpha: number;
  phase: number;
  speed: number;
};

const PETAL_COLORS = ['#f6a5b8', '#f7b6c6', '#f2c5d0', '#ecc7cf'];

// 樱花飘落 + 闪烁星光(画布背景,奶油白之上)。尊重 prefers-reduced-motion。
export default function BackgroundDecor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    const petals: Petal[] = [];
    const stars: Star[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const makePetal = (spawnAnywhere: boolean): Petal => ({
      x: Math.random() * w,
      y: spawnAnywhere ? Math.random() * h : -20,
      size: 6 + Math.random() * 8,
      speedY: 0.8 + Math.random() * 1.4,
      sway: 0.6 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.04,
      hue: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
    });

    const makeStar = (spawnAnywhere: boolean): Star => ({
      x: Math.random() * w,
      y: spawnAnywhere ? Math.random() * h : Math.random() * h,
      r: 0.6 + Math.random() * 1.4,
      baseAlpha: 0.2 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
      speed: 0.02 + Math.random() * 0.03,
    });

    const petalCount = reduce ? 8 : 26;
    const starCount = reduce ? 14 : 64;

    const init = () => {
      petals.length = 0;
      stars.length = 0;
      for (let i = 0; i < petalCount; i++) petals.push(makePetal(true));
      for (let i = 0; i < starCount; i++) stars.push(makeStar(true));
    };

    const drawPetal = (p: Petal) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // 樱花花瓣:两段贝塞尔构成的水滴形
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.bezierCurveTo(p.size * 0.8, -p.size * 0.4, p.size * 0.8, p.size * 0.5, 0, p.size);
      ctx.bezierCurveTo(-p.size * 0.8, p.size * 0.5, -p.size * 0.8, -p.size * 0.4, 0, -p.size);
      ctx.fillStyle = p.hue;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.restore();
    };

    const drawStar = (s: Star, time: number) => {
      const alpha = s.baseAlpha * (0.55 + 0.45 * Math.sin(time * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 244, 214, ${Math.max(0, alpha)})`;
      ctx.fill();
    };

    const frame = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const star of stars) drawStar(star, time / 1000);
      for (const petal of petals) {
        petal.y += petal.speedY;
        petal.x += Math.sin(petal.phase) * petal.sway;
        petal.phase += 0.01;
        petal.rot += petal.rotSpeed;
        drawPetal(petal);
        if (petal.y - petal.size > h) {
          const np = makePetal(false);
          Object.assign(petal, np);
        }
      }
      raf = requestAnimationFrame(frame);
    };

    const onResize = () => {
      resize();
      init();
    };

    resize();
    init();
    window.addEventListener('resize', onResize);

    if (reduce) {
      // 降级:静态绘制一次,不逐帧动画
      for (const star of stars) drawStar(star, 0);
      for (const petal of petals) drawPetal(petal);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
