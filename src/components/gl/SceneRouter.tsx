/**
 * 场景路由：`sceneKey` → 场景子树。
 *
 * 为什么不是条件渲染 + 淡入淡出：`<Canvas>` persist 之后没有黑场掩护，
 * 组件卸载/挂载那一下会露出「几何体突然消失」的穿帮。所以真正的切换遮罩
 * 由 CanvasHost 用一层 DOM 光晕承担（0.6s：亮起 → 换场景 → 退去），
 * 这里只负责「现在该渲染哪棵子树」。
 *
 * 预算从 quality.ts 统一取，场景组件不自己写死粒子数。
 */

import { budgetFor } from '../../lib/gl/quality';
import type { QualityTier, SceneKey } from '../../lib/gl/store';
import HomeScene from './scenes/HomeScene';
import ReadingScene from './scenes/ReadingScene';
import ProjectsScene from './scenes/ProjectsScene';
import SoundScene from './scenes/SoundScene';

type Props = {
  scene: SceneKey;
  tier: QualityTier;
};

export default function SceneRouter({ scene, tier }: Props) {
  const budget = budgetFor(scene, tier);

  switch (scene) {
    case 'home':
      return <HomeScene dust={budget.dust} />;
    case 'reading':
      return <ReadingScene dust={budget.dust} />;
    case 'projects':
      return <ProjectsScene dust={budget.dust} />;
    case 'sound':
      return <SoundScene dust={budget.dust} />;
  }
}
