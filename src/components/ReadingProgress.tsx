import { motion, useScroll, useSpring } from 'motion/react';

// 文章详情页顶部阅读进度条(粉色进度线)。阶段3 在文章详情页引入使用。
export default function ReadingProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <motion.div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-crimson/70"
      style={{ scaleX }}
    />
  );
}
