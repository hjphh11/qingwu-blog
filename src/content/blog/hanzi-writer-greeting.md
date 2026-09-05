---
title: "用 Hanzi Writer 做笔顺问候动画"
description: "首页那句「欢迎来到清吾的小屋」是一笔一划写出来的。记录我用 hanzi-writer 实现字逐字笔顺动画的过程，以及为了降级和体验做的处理。"
pubDate: 2026-09-20
category: tech
tags: ["HanziWriter", "动画", "React", "首页"]
---

清吾首页最打动我的，是那句一笔一划写出来的「欢迎来到清吾的小屋」。它是 `src/components/Hero.tsx` 里用 `hanzi-writer` 实现的。这篇文章记录实现思路。

## 思路：一个字一个字地写

汉字笔顺动画，`hanzi-writer` 已经帮我把最难的部分（笔画数据、动效）做好了。我要做的只是：**把字符串拆成单字，逐个创建写字的容器，写完一个字再开始下一个。**

核心逻辑在 `useEffect` 里：

```tsx
const startNext = (index: number) => {
  if (index >= chars.length) return;
  const cell = document.createElement('div');
  cell.className = 'char-cell';
  container.appendChild(cell);

  const writer = HanziWriter.create(cell, chars[index], {
    width: CELL,
    height: CELL + 12,
    padding: 4,
    delayBetweenStrokes: 30,
    strokeAnimationSpeed: 3,
    strokeFadeDuration: 150,
    strokeWidth: 4,
    showCharacter: false,
    showOutline: false,
    strokeColor: '#4a3728',
    outlineColor: 'rgba(74, 55, 40, 0.25)',
    charDataLoader: loadData,
  });
  writer
    .animateCharacter({
      onComplete: () => startNext(index + 1),
    })
    .catch(() => startNext(index + 1));
};
```

几个选项的含义：

- `delayBetweenStrokes: 30` —— 每一笔之间的停顿，让「写」的动作更有呼吸感。
- `strokeAnimationSpeed` —— 笔画书写的速度，数值越小越慢。配合上面的停顿，节奏很像真的在写字。
- `showCharacter: false`、`showOutline: false` —— 一开始不显示整个字和轮廓，让每笔都是从无到有地长出来。
- `strokeColor` / `outlineColor` —— 用 `#4a3728`（暖棕文字色）和它的半透明，跟全站配色保持一致。

## 笔画数据从哪来

`hanzi-writer` 默认会去 CDN 拉取每个字的笔画数据。为了不依赖外部网络、也让首页更快，我把需要的汉字笔顺 JSON 放到了本地：

```ts
const loadData = (char: string, onLoad: (data: any) => void, onError: (err?: any) => void) => {
  fetch(`/hanzi/${char}.json`)
    .then((r) => r.json())
    .then((data) => onLoad(data))
    .catch((err) => onError(err));
};
```

这里用 `charDataLoader` 告诉 `hanzi-writer`：去 `/hanzi/<字>.json` 拿这份数据。全站的字就 `欢 迎 来 到 清 吾 的 小 屋` 这几个，本地放好即可。因为字数固定，加载量很小，动画开始前也不用等网络。

## 写完这个字，再写下一个

`animateCharacter` 的 `onComplete` 回调里调用 `startNext(index + 1)`，于是九个字就像排队一样，一个写完接着写下一个。为了防止某个字数据异常导致动画卡死，我还在 `catch` 里让它直接跳到下一个字，保证永远能写完。

## 照顾「减少动效」的用户

跟全站其它动效一样，这里也做了降级。`useEffect` 里先判断 `prefers-reduced-motion`：

```ts
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduce) {
  const span = document.createElement('span');
  span.className = 'font-hand text-[88px] leading-none text-ink';
  span.textContent = chars[index];
  cell.appendChild(span);
  startNext(index + 1);
  return;
}
```

如果用户设置了「减少动态效果」，就不再播放笔顺动画，而是直接渲染静态的手写字——用 `Ma Shan Zheng` 字体呈现，信息一点不少，只是不转了。

## 细节：容器与语义

每个字放进一个 `char-cell`，宽度固定（`CELL`），高度略微加一点以容纳行内空隙，用 `flex-wrap` 让整句在手机上也自然换行。外层容器还加了 `role="text"` 和 `aria-label`，因为这里的字是被拆开逐个渲染的，需要把整句的语义补回来给读屏用户。

>一个小执念：连笔顺这么细的东西，也想让它既精致、又对每个人都友好。可能就是做这个站的意义吧。

## 小结

`hanzi-writer` 把最复杂的笔画数据与动效封装好了，剩下的是节奏、配色和降级这些「体验」的活。把一句问候写成一次温柔的落笔，是我挺喜欢的一个开头。
