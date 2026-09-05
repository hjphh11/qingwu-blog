---
title: "玻璃拟态卡片与聚光效果：清吾的卡片是怎么做出来的"
description: "记录清吾首页与列表里的玻璃拟态卡片 + 指针聚光效果的实现，含 backdrop-filter 与 stacking context 的关键细节。"
pubDate: 2026-09-14
category: tech
tags: ["CSS", "玻璃拟态", "前端"]
---

清吾里到处是圆润的玻璃卡片：文章列表、友链、分享的收藏与语录，都是同一套「玻璃拟态」骨架。这篇聊聊它的实现，以及那个跟着指针跑的聚光效果。

## 玻璃卡片本体

卡片的核心在 `src/styles/global.css` 的 `.glass-card`：

```css
.glass-card {
  border-radius: var(--radius-card);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  box-shadow: 0 10px 30px rgba(246, 165, 184, 0.16);
}
```

几个值得说的点：

- **半透明白底 + 白边**，让卡片看起来是「悬浮在画面上的毛玻璃」，而不是一块实心色块。
- **`backdrop-filter: blur()` 给背景做模糊**，这是玻璃质感的来源。后面的暖色氛围光斑（`aurora-blob`）被它一模糊，立刻变得柔和。
- 记得加 `-webkit-` 前缀，因为部分浏览器还需要它。

## 聚光效果：跟着指针走的光斑

列表卡片还有一个细节：鼠标移到哪里，哪里就亮起一圈玫瑰粉的柔光。它由两部分协作完成。

第一步，卡片本身做一个层叠上下文，让聚光层垫在玻璃背景之上、文字之下：

```css
.card-spotlight {
  position: relative;
  z-index: 0;
  overflow: hidden;
}
.card-spotlight::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;           /* 放在内容文字之下 */
  opacity: 0;
  pointer-events: none;
  border-radius: inherit;
  transition: opacity 0.5s var(--ease-soft);
  background: radial-gradient(
    280px circle at var(--mx, 50%) var(--my, 50%),
    rgba(246, 165, 184, 0.3),
    transparent 72%
  );
}
.card-spotlight:hover::before {
  opacity: 1;
}
```

注意 `::before` 用的是 `z-index: -1`，但它得落在卡片自身的背景之上。诀窍是**卡片建立 `z-index: 0` 的层叠上下文**，这样 `::before` 的 `-1` 是相对上下文内部的「最底层」，而不会掉到卡片后面去。

第二步，全局监听指针，把位置写成 `--mx` / `--my`（单位 px）：

```js
document.addEventListener('pointermove', function onMove(e) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const el = t.closest('.card-spotlight');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
  el.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
}, { passive: true });
```

我只在一个地方委托了一次（用 `window.__qCardSpotlight` 做标记防止重复注册），所以无论页面切到哪个路由（配合 `ClientRouter`），监听都不会叠加。聚光层则用 `var(--mx, 50%)` 这种带回退值的写法，即使 JS 还没跑，光斑也稳居中。

## 悬停的仪式感

`.glass-card.card-spotlight:hover` 还会把边框提亮、影子加深，让卡片整个「浮」起来一点：

```css
.glass-card.card-spotlight:hover {
  border-color: rgba(246, 165, 184, 0.55);
  box-shadow: 0 16px 40px rgba(246, 165, 184, 0.22);
}
```

## 该不该用

玻璃拟态好看，但也容易翻车——背景太花时，透明度叠多了会糊成一片。清吾的解法是：背景只有三团很软的大光斑，卡片再叠一层半透明白。光斑负责「暖」，卡片负责「透」，两者不打架，玻璃才真正透亮。

>做设计时的分寸感：玻璃是用来「透出暖色」的，不是用来抢戏的。所以要克制。

以上就是清吾卡片的实现思路。下一次可以再聊聊卡片之外的那些动效。
