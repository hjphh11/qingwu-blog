// 阶段 L 的小动效工具。都遵守「系统说要减少动效就闭嘴」。
import { useEffect, useRef, useState } from 'react';

export function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * 数字滚动：从 0 数到 target（概览的统计卡用）。
 * 减少动效 / 非数字 → 直接给终值。
 */
export function useCountUp(target, { duration = 650 } = {}) {
  const isNumber = typeof target === 'number' && Number.isFinite(target);
  const [value, setValue] = useState(isNumber && !prefersReducedMotion() ? 0 : target);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!isNumber || prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const from = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      // easeOutCubic：开头快、结尾稳，读数字不费劲
      const eased = 1 - (1 - p) ** 3;
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, isNumber]);

  return isNumber ? value : target;
}
