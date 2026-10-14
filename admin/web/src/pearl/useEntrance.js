// 页面入场：scaffold 的样式用 `.app-frame:not(.is-entrance-ready) > *` 和
// `.page:not(.is-entrance-ready) .reveal` 把「还没入场」的元素设成 opacity: 0，
// 由它的 GSAP 时间线在挂载后补上 `is-entrance-ready` 类。
//
// ⚠️ 这里必须返回一个**布尔值**给组件的 className 用，不能像第一版那样直接改
// DOM 的 classList —— React 重渲染时会整体重写 className（比如切换导航、抽屉状态一变），
// 手写的类会被抹掉，侧栏和顶栏就又变成透明了（这个 bug 已在真机验收里复现过一次）。
//
// 返回 true 之后，让组件把 'is-entrance-ready' 拼进 className：
//   const ready = useEntrance();
//   <div className={cls('app-frame', ready && 'is-entrance-ready')}>
//
// 补类的时机：下一帧 + 120ms 定时器兜底（后台标签页里 rAF 不触发，scaffold 也踩过这个坑）。
import { useEffect, useState } from 'react';

export function useEntrance() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    const timer = setTimeout(() => setReady(true), 120);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(timer);
    };
  }, []);

  return ready;
}

export default useEntrance;
