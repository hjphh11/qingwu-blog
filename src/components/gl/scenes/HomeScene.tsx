/**
 * 首页光场：两道光柱 + 浮尘 12 万。
 * 关键词「温暖、开阔、有风」—— 两束斜射的暖光，尘埃从光里穿过。
 *
 * 立绘不在这里：爱弥斯是 DOM 层（官方立绘进 WebGL 会失真，也不方便做 FLIP 归位）。
 */

import Dust from '../Dust';
import LightShafts from '../LightShafts';

export default function HomeScene({ dust }: { dust: number }) {
  return (
    <>
      {/* 玫瑰光偏左、琥珀光偏右，角度略有差异（1.62 / 1.50 rad），交叉才不呆板。
          强度刻意压得很低（0.12 / 0.07）：第 4 条交付的是**内核**，
          现有视觉（奶油底 + 极光）不该被顺手改掉。真正的光场观感在第 6 条
          「首页 + 开场」里连构图一起定。 */}
      <LightShafts
        a={{ color: '#f6a5b8', intensity: 0.12, angle: 1.62, width: 0.10 }}
        b={{ color: '#e8b04b', intensity: 0.07, angle: 1.50, width: 0.13 }}
      />
      {/* 两层尘埃撑纵深：主层近而亮，次层远而淡、走得更慢。
          两层**按 7:3 分摊同一个预算**，总数严格等于 budget.dust —— 
          否则「预算 12 万」就成了一句空话。 */}
      <Dust count={Math.round(dust * 0.7)} color="#f6a5b8" opacity={0.5} speed={1} spread={[26, 16, 12]} />
      <Dust count={Math.round(dust * 0.3)} color="#ffd9b0" opacity={0.32} speed={0.55} spread={[34, 20, 18]} />
    </>
  );
}
