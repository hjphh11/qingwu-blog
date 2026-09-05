---
title: "用 Motion 做克制的动效：滚动揭示与滚动缩放"
description: "聊聊清吾里那套「不吵不闹」的动效：CSS 的滚动揭示 + Motion 的滚动缩放/模糊浮现，以及怎么照顾 prefers-reduced-motion。"
pubDate: 2026-09-17
category: tech
tags: ["Motion", "动画", "前端", "无障碍"]
---

动效是个容易上头的东西。做博客的时候我反复提醒自己一句话：**动效要有目的，而且要克制。** 这篇文章讲讲清吾里两类动效的实践——纯 CSS 的滚动揭示，和用 Motion 做的滚动驱动。

## 滚动揭示：进入视口就淡入

清吾很多区块（文章列表、分享卡片）都用了一个 `.reveal` 类，进入视口时上浮淡入。做法很轻量，放在 `src/styles/global.css` 里：

```css
.qjs .reveal {
  opacity: 0;
  transform: translateY(26px);
  transition: opacity 0.7s var(--ease-soft), transform 0.7s var(--ease-soft);
  will-change: opacity, transform;
}
.qjs .reveal.is-visible {
  opacity: 1;
  transform: none;
}
```

然后在 `Layout.astro` 里用一个全局的 `IntersectionObserver` 驱动：

```js
const io = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    }
  });
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
```

两个小细节值得记：

- **`io.unobserve` 在可见后立刻取消监听**。元素只会 reveal 一次，不会反复触发。
- **`rootMargin` 底部留了 `-12%`**，让元素要真正滚进视口一段距离才淡入，而不是刚到边缘就动，看起来更自然。

`will-change` 我加在了 `opacity, transform` 上，提示浏览器把这些属性交给 GPU 合成。因为只改这两项，不做逐帧重排，滚动起来才顺。

## Motion 的滚动驱动：爱弥斯随滚动缩小

首页右侧的爱弥斯用了 `motion/react`，让角色随页面滚动逐渐缩小、淡出，像在「退后」。

```tsx
const { scrollYProgress } = useScroll({
  target: heroRef,
  offset: ['start start', 'end start'],
});
const scale = useTransform(scrollYProgress, [0, 1], [1, 0.6]);
const opacity = useTransform(scrollYProgress, [0, 0.85], [1, 0]);
```

`useScroll` 监听目标元素在视口里的滚动进度，`useTransform` 把它映射成 `1 → 0.6` 的缩放和 `1 → 0` 的透明度。把这两个值绑到 `style` 上，角色就平滑地「让位」给下面的内容了。

## 台词逐词浮现

副标题「写技术 · 记生活 · 一个温馨二次元的小角落」是逐词浮现的，用了 variants + stagger：

```tsx
<motion.span
  initial="hidden"
  animate="show"
  variants={{
    hidden: {},
    show: { transition: { staggerChildren: 0.14, delayChildren: 0.5 } },
  }}
>
```

每个词是从「模糊 + 上浮」过渡到清晰，缓动用的是 `[0.16, 1, 0.3, 1]`——一个起步快、收尾很柔的曲线，跟站点的暖色调很配。

## 一定要照顾「减少动效」的用户

动效再好看，也不能逼着所有人都看。清吾在所有动效前都做了降级判断，最典型的是 `prefers-reduced-motion`。

在 CSS 里加一段媒体查询：

```css
@media (prefers-reduced-motion: reduce) {
  .qjs .reveal { transition: none; }
  .disc, .wave-bar { animation: none !important; }
  .aurora-blob { animation: none !important; }
}
```

在 JS 层面对应的是 `useReducedMotion()` 和 `matchMedia('(prefers-reduced-motion: reduce)')`。Hero 里如果是 `reduce`，就直接渲染静态文字，跳过笔顺动画；按钮涟漪、聚光渐隐也一并关闭，只保留静态柔光。

>克制，不只是「少做动画」，更是「尊重每个人的选择」。这是我觉得动效最有温度的地方。

## 小结

清吾的动效，大多可以归结成一个原则：**只在有明确目的时才动**。滚动揭示为了引导注意，滚动缩放为了内容让位，台词浮现为了营造一点仪式感——除此之外，尽量不动。它值得一个安静的角落。
