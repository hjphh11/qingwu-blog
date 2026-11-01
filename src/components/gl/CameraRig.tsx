/**
 * 相机机架：鼠标视差 + 滚动推进。
 *
 * ⚠️ 纪律（v6 §6.3）：**只在 useFrame 里改相机**，绝不在 scroll / pointermove
 * 的事件回调里改。DOM 事件的触发时机与渲染帧不同步，在那里改会让画面抖。
 * 事件回调只把数字写进 store 的 `motion`，这里每帧去读。
 *
 * 关于 lerp 系数：v6 写的是 `lerp 0.06`。这里改成**帧率无关**的等价写法
 * `1 - (1 - 0.06)^(delta*60)`：在 60Hz 上手感与 0.06 完全一致，但在 120Hz 屏上
 * 不会因为帧数翻倍而「变快一倍」。硬写 0.06 的代码在高刷屏上视差会明显更灵敏。
 */

import { useFrame } from '@react-three/fiber';
import { pointer, scroll } from '../../lib/gl/store';

/** 60fps 下等价于 v6 的 lerp 0.06 */
const FOLLOW = 0.06;

/** 把「每帧 0.06」换算成本帧应走的比例，帧率无关 */
function damp(delta: number) {
  return 1 - Math.pow(1 - FOLLOW, Math.min(delta, 0.1) * 60);
}

type Props = {
  /** 视差幅度（世界单位）。0.25 对应 v6 的 ±0.25 */
  amount?: number;
  /** 滚动到底时相机往前推多少 */
  push?: number;
};

export default function CameraRig({ amount = 0.25, push = 1.6 }: Props) {
  useFrame(({ camera }, delta) => {
    const k = damp(delta);

    // 目标：指针方向决定横向偏移；滚动推进沿 -z 前进并轻微抬高，
    // 让画面在往下滚时「穿过」浮尘，而不是原地不动。
    const tx = pointer.x * amount;
    const ty = -pointer.y * amount * 0.7 + scroll.progress * 0.55;
    const tz = 6 - scroll.progress * push;

    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (tz - camera.position.z) * k;

    // 注视点也随滚动微移，否则只看位置移动会像「平移镜头」而不是「前进」
    camera.lookAt(pointer.x * 0.12, scroll.progress * 0.35, -2);
  });

  return null;
}
