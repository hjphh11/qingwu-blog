/**
 * 阅读场景：安静、后退、不打扰。
 *
 * 只有一道很淡的暖光 + 少量慢速尘埃。强度刻意压到首页的 1/3 ——
 * 这个场景的作用是「让人忘记背后有光」，不是让人欣赏光。
 *
 * ⚠️ v6 §4.3 还要求一条「文字带压暗 42%」的软边遮罩。**这里没做**：
 * 光场画在内容**下面**（z -5），在它上面压暗压不到奶油底色，
 * 那样做只会把光压暗、字底依然亮，达不到目的。
 * 正确的做法是在内容层之上叠一个只作用于背景的遮罩，属于第 7 条
 * 「全透明阅读的保护层」（v6 §7.2）的活。
 */

import Dust from '../Dust';
import LightShafts from '../LightShafts';

export default function ReadingScene({ dust }: { dust: number }) {
  return (
    <>
      {/* 只留主光，辅光强度给 0 —— 组件接口要两根，但阅读页只需要一根 */}
      <LightShafts
        a={{ color: '#f6a5b8', intensity: 0.10, angle: 1.66, width: 0.16 }}
        b={{ color: '#e8b04b', intensity: 0, angle: 1.5, width: 0.1 }}
      />
      <Dust count={dust} color="#f6a5b8" opacity={0.26} speed={0.42} spread={[30, 18, 14]} />
    </>
  );
}
