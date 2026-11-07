---
title: "目录高亮卡住之后：把 IntersectionObserver 换回了 scroll"
description: "阅读体验这一块的两个真实问题：目录高亮为什么会在两个标题之间停住，以及页内脚本为什么在切页之后全失效。顺带记高对比开关的做法。"
pubDate: 2026-11-05
category: tech
tags: ["JavaScript", "可访问性", "阅读体验", "踩坑"]
---

重写时我给文章页加了两样东西：右边一列能跟着读的目录，和导航上一个高对比开关。

两样都不复杂，但都在过程中暴露了一个我一直以来的误解。

## 目录高亮：我一开始的选择是错的

第一版用的是 `IntersectionObserver`，很自然：观察所有 `h2` / `h3`，谁进入视口就把谁点亮。也确实是「性能更好的做法」。

但很快就发现它会卡住。

现象是：滚动到某一段，高亮停在上一节不动了，继续往下滚一段才突然跳过去。而且它**只在两个标题之间有距离时**出现 —— 如果标题挨得近，看着还挺正常。

原因说白了很简单：`IntersectionObserver` 的回调只在**相交状态发生变化**时触发。

如果判定带（比如视口中部那一条）里没有任何标题，滚动不产生任何状态变化，也就没有回调。目录就停在最后一次的值上。而这恰好是最需要更新的场景 —— 你正读到两个标题之间的那一大段正文。

如果把判定带拉得很宽，又会变成「一次点亮好几个」。这条路走不通。

## 换成 rAF 节流的 scroll

改法很朴素：监听 `scroll`，每帧最多算一次。

```js
const pick = () => {
  raf = 0;
  if (!heads.length) return;
  // 判定线放在视口 30% 处：最后一个越过它的标题就是当前章节
  const line = window.innerHeight * 0.3;
  let idx = 0;
  for (let i = 0; i < heads.length; i++) {
    if (heads[i].getBoundingClientRect().top <= line) idx = i;
    else break;
  }
  setActive(heads[idx].id);
};

const onScroll = () => {
  if (!raf) raf = requestAnimationFrame(pick);
};
window.addEventListener('scroll', onScroll, { passive: true });
```

几个决定：

- **判定线放 30% 而不是顶部。** 贴着顶的那条线太「诚实」了 —— 标题刚滚出视口才换高亮，人已经读到下面了。30% 大致是眼睛所在的位置。
- **落到第一项。** 一个都没越过时（还在引言），点亮第一条。什么都不点亮会让人以为目录坏了。
- **`passive: true`。** 不阻止滚动，浏览器不用等回调结束。
- **一帧最多算一次。** 十几个标题的 `getBoundingClientRect()` 读取代价可以忽略，但没必要一次滚动算几十遍。

代价是每次滚动都要读布局，理论上不如 IO「优雅」。但它的好处是：**任何滚动位置都有确定结果**。没有「等待状态变化」这回事。

这件事之后我对「用 IO 做 scroll-spy」这件事就不太信了。它适合「元素出现时做一次动画」，不适合「持续跟踪位置」。

## 更隐蔽的那个坑：页内脚本绑到了废掉的节点上

目录好了之后，又发现「返回」按钮时灵时不灵 —— 具体是：从首页点进文章正常，从另一篇文章点进来就点不动。

原因是客户端路由。

`ClientRouter` 切页时会把整个 `<body>` 换掉，但页内 `<script type="module">` **不会再执行一次**。模块脚本在首屏只跑一遍，之后新的 DOM 里那些元素，从来没被绑过事件 —— 而旧节点上绑的监听，随着旧 body 一起被丢掉了。

所以做法变成：**把绑定与解绑包成一对，并且幂等**。

```js
let teardown = null;

function init() {
  teardown?.();
  teardown = null;

  const back = document.getElementById('back-btn');
  const onBack = () => { /* … */ };
  back?.addEventListener('click', onBack);

  // …目录逻辑…

  teardown = () => {
    window.removeEventListener('scroll', onScroll);
    back?.removeEventListener('click', onBack);
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
document.addEventListener('astro:page-load', init);
```

这里有两个必须同时存在的入口，缺一不可：

- **监听 `astro:page-load`** —— 处理后续导航。
- **DOM 就绪时也主动跑一次** —— 因为首屏那次 `page-load` 有可能在脚本求值之前就派发完了。

第二点很容易漏。只监听事件的话，首屏进来目录根本不亮，得刷新一次才对 —— 这种「刷新就好了」的 bug 最容易被误判成缓存问题。

`init()` 开头先 `teardown?.()` 是为了幂等：首屏可能既跑了立即初始化，又收到 `page-load`，不能绑两次。

顺带一个同源的坑：这类脚本里**不要**在模块顶层直接抓元素。

```js
// 不要这样
const toc = document.querySelector('[data-toc]');
document.addEventListener('astro:page-load', () => { /* 用的还是那个旧 toc */ });
```

顶层抓到的节点在切页之后就是「上一页的尸体」。看起来代码没错，就是不工作。

## 高对比开关：只改两件事

这个开关的定位很明确：站点本身的对比度是达标的，但「**次要文字 + 半透明玻璃卡**」是最先撑不住的一档。玻璃会透出背后的极光，浅色区域叠浅色文字时余量很小。视力不好、或者在强光下看的人，需要一档更硬的版本。

实现只有一个类 `html.q-contrast`，它只做两件事：

```css
html.q-contrast {
  --color-muted: rgb(58, 43, 31);
  --color-subtle: rgba(58, 43, 31, 0.92);
}

html.q-contrast .glass-card {
  background: rgba(255, 252, 248, 0.94);
}
```

1. 把「次要 / 三级文字」提到接近纯色；
2. 把玻璃卡底色加实，不再让背景透上来。

**不动字号、不动布局。** 开关只该改变对比，不该改变版式 —— 一旦字号变了，页面高度全变，读到一半的人会被顶走。

这里面有个 CSS 细节值得一提：为什么写在 `html.q-contrast` 上，而不是 `:root`？

因为 `html.q-contrast` 比 `:root` 多一个类，选择器更具体，能盖住 `@theme` 里定义的值。而且它写在 `base` 层 —— Tailwind 的层序是 `theme → base → components → utilities`，base 在 theme 之后，覆盖稳定生效。

### 首帧不能闪

这个开关存 `localStorage`，但**不能在 React 里读**。

如果在组件里 `useEffect` 读出来再切类，会出现「先渲染低对比版本，再跳到高对比」的闪一下。夜间模式做多了的人对这个应该很熟。

所以：`Layout.astro` 里一段 `is:inline` 脚本，在首帧绘制之前读 `localStorage` 并把类加到 `<html>` 上。React 组件只**读既成事实**：

```js
useEffect(() => {
  // 只读不写：真正的初始状态由 Layout 的首帧前脚本决定
  setOn(document.documentElement.classList.contains('q-contrast'));
}, []);
```

加类早于首帧，SSR 与客户端就一致了。

### 顺手修了一个颜色

做这档对比度的时候，我重新验了一遍主色绯红。

原来的 `#e0526b`，在奶油白上只有 **3.51:1**，白字压在上面是 **3.76:1** —— 两个方向都不够 AA。

压深到 `#c23a55` 之后：奶油白上 **5.0:1**，白字 **5.1:1**。色相（349°）和饱和度基本没变，还是同一支绯红，只是暗了一档。

这条改动其实是「高对比开关」最意外的收益：**默认状态就达标了**，开关只是给需要更硬版本的人多一档。

至于怎么验 —— 我没有只信计算器。截图取样，用实际渲染出来的像素算对比度，再留 **0.05 的容差**（抗锯齿会让边缘像素浮动）。这个容差不是为了「放过不达标的」，而是让「4.51 和 4.53」这种差别不至于反复折腾。

## 小结

这一块的两个问题，本质上是同一件事的两面：

- 目录卡住：把「状态变化才通知」的工具，用在了需要「持续跟踪」的场景。
- 事件失效：以为页内脚本会跟着页面「重新执行」，其实没有。

它们都不会报错。表现都是「有时候不对」，而「有时候」是最难查的一类。

至于高对比开关，做完之后我发现它真正教会我的不是 CSS，而是：**先让默认状态达标，再给一个更硬的版本**。而不是反过来，用一个开关去弥补默认值的不足。
