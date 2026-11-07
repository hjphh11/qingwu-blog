---
title: "让一张立绘会呼吸：三层 DOM、一次落偏，和一件没做成的事"
description: "爱弥斯 2.5D 是怎么做的：三层各自管一件事、视线跟随为什么缓动只能做一次、开屏交接的时序门禁，以及那个最终被拿掉的发梢光影。"
pubDate: 2026-11-03
category: tech
tags: ["CSS", "动效", "React", "踩坑"]
---

首页右边那张爱弥斯立绘，重写之前是静态的。重写时我给她加了一点「活着」的感觉：会呼吸、会轻轻摆、视线跟着鼠标走。

但这篇真正想记的不是效果，而是中间那几次**落偏**和**失败**，因为它们才决定了最后长成什么样。

## 为什么不用 WebGL

第一个念头是上 Three.js：把立绘做成贴图，加个位移、加点镜面高光。技术上完全可行，但很快否掉了：

- 贴图采样之后，画面会比原图软一点。这张立绘是我唯一在乎「清晰度」的图。
- 开屏结束时要把立绘从幕布**归位**到页面里，这个 FLIP 动画用 DOM 是改 `transform` 的事，进了 canvas 就得自己做一套坐标换算。
- 为了「轻轻晃一下」引一整个渲染器，代价不划算。

所以：只用官方立绘，纯 DOM + CSS 动画 + 一点点 rAF。

## 三层，每层只干一件事

结构是这样的：

```html
<div class="q-emis">          <!-- perspective: 900px -->
  <div class="q-emis__gaze">  <!-- 视线跟随 -->
    <div class="q-emis__idle"> <!-- 呼吸 + 微摆 -->
      <picture>…立绘…</picture>
    </div>
  </div>
</div>
```

看起来啰嗦，但这三层是**必须拆**的。

原因是 CSS 里那个老规矩：**同一个元素上的多个 `transform` 会互相覆盖**。两个都写 `transform` 的动画，只有一个能生效。层次一拆，每个动画各管一个盒子，天然叠加，而且可以单独关掉 —— 比如减动效时只停呼吸、保留视线跟随。

这一条我踩过一次就知道疼：最早把呼吸和倾斜写在同一条 `transform` 上，调了半天发现倾斜永远不生效，因为被动画的 `transform` 整个替换掉了。

### 呼吸：一条动画表两个态

```css
.q-emis.is-idle .q-emis__idle {
  animation: q-emis-idle 9.2s var(--ease-soft) infinite;
}

@keyframes q-emis-idle {
  0%   { transform: scale(1)     rotate(0deg)   translateY(0); }
  25%  { transform: scale(1.007) rotate(0.4deg) translateY(-2px); }
  50%  { transform: scale(1.014) rotate(0deg)   translateY(-5px); }
  75%  { transform: scale(1.007) rotate(-0.4deg) translateY(-2px); }
  100% { transform: scale(1)     rotate(0deg)   translateY(0); }
}
```

缩放和倾斜共用一条动画、一个周期，相位锁在一起，看起来才像自然的重心转移。

幅度是刻意压死的：**scale 最大 1.4%、rotate 最大 0.45°、位移最大 5px**。再大一点，观感就从「活的」变成「在晃」。

还有一个容易忽略的：`transform-origin: 50% 100%`。以脚底为轴缩放，她是在原地呼吸；用默认的中心点，就变成气球在一胀一缩。

### 视线：缓动只做一次

指针位置归一化到 -1..1，然后每帧朝目标 lerp：

```js
const tick = () => {
  raf = 0;
  cx += (tx - cx) * 0.12;
  cy += (ty - cy) * 0.12;
  stage.style.setProperty('--emis-x', cx.toFixed(4));
  stage.style.setProperty('--emis-y', cy.toFixed(4));
  if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) {
    raf = requestAnimationFrame(tick);
  }
};
```

三个细节：

- **CSS 那边绝对不能再写 `transition`。** 两边都缓一次，会叠成明显的滞后 —— 鼠标停下半天，画面才跟上。
- **到位就停 rAF。** 常驻 rAF 是白烧 CPU，而这个值只在指针动的时候才有意义。
- **只在 `pointer: fine` 的设备上开。** 触屏没有指针，开了也没用。

输出幅度也很克制：位移 7px、转角 2.2°。

```css
.q-emis__gaze {
  transform:
    translate3d(calc(var(--emis-x, 0) * 7px), calc(var(--emis-y, 0) * 5px), 0)
    rotateY(calc(var(--emis-x, 0) * 2.2deg))
    rotateX(calc(var(--emis-y, 0) * -1.2deg));
  transform-origin: 50% 80%;
}
```

再大就不是「看过来」，而是「晃」。

## 那次落偏

这是整块里最值得记的一个 bug。

开屏结束时，幕布上的立绘要用 FLIP 平移到页面里的位置。做法是运行时量 `[data-emis-hero]` 的 `getBoundingClientRect()`，拿到落点矩形。

而 `getBoundingClientRect()` **包含 transform**。

也就是说：只要呼吸动画在交接之前跑起来，量出来的矩形就是「正在呼吸的那一帧」，落点必然偏。第一次看到的现象很迷惑 —— 交接那一瞬间画面轻微跳了一下，说不出哪不对，但就是不对。

解法是加一道门禁：等开屏广播完成事件，才开始活化。

```js
useEffect(() => {
  const start = () => setIdle(true);
  const root = document.documentElement;
  const splashOn =
    root.classList.contains('q-splash-pending') ||
    root.classList.contains('q-splash-running');

  if (!splashOn) {
    start();
    return;
  }
  window.addEventListener('qingwu:splash-done', start, { once: true });
  const t = window.setTimeout(start, 3600);
  return () => {
    window.removeEventListener('qingwu:splash-done', start);
    clearTimeout(t);
  };
}, []);
```

这里有两个坑，都是实测撞出来的：

**第一，两个 class 都要判。** 开屏接管的那一刻会把 `q-splash-pending` 换成 `q-splash-running`。如果只判前者，凡是水合发生在接管之后的，都会被判成「这次没开屏」而立刻开始动 —— 归位就落偏了。这个错我真的犯过一次。

**第二，必须有兜底计时器。** 开屏层万一挂了（脚本报错、被拦截），不能让立绘永远僵着。这里给 3.6s，比开屏自己的 5s 收幕兜底早一点。

另外，页面里的立绘和幕布上的立绘在交接时要重叠。两张图的 `drop-shadow` 必须一致，否则能看出来「换手」：

```html
<img class="drop-shadow-[0_18px_40px_rgba(246,165,184,0.35)]" />
```

这个值在 `Splash.tsx` 里也有一份常量，改一处必须改两处。

## 一个像素的 descender

有个特别无聊但很真实的坑：活化容器如果不写 `display: flex`，底部会多出几像素空白。

因为里面那层 `.q-media` 是 `inline-block`，放在块级容器里会落在一条 line box 上，行高的 descender 部分就露出来了。

```css
.q-emis__idle {
  display: flex; /* 不是可有可无的装饰 */
  width: fit-content;
}
```

改成 flex 之后，`picture` 重新变成 flex item，布局与改造前逐像素一致。这种问题不会报错，只会在两张截图叠在一起对比时露出一条缝。

## 没做成的那件事

原本我还想做「发梢光影」：用整张立绘的剪影当遮罩，叠一道暖白扫光，让头发边缘有点反光。

做了，也能通过验收，但**画面不成立**。

官方立绘本身是浅色暖调。`screen` 混合的扫光叠上去，只会把她的配色冲淡 —— 红领结变粉、棕裙发白。强度压到 0.28 才不伤画面，可那时候几乎看不见。**看得见就毁，看不见就白做。**

这已经不是第一次了。之前试过一版 WebGL 光场，也是同样的死法：加色光落在浅色画面上，只会让整页发白、发染色，和这个站「薄透轻」的调子完全不搭。

所以这条整条拿掉了。与其留一个「只能调到看不见」的开关，不如不写那段代码。

## 内容页的小陪伴

文章页里还有一个更小的版本：左下角一个小爱弥斯，三种形态随机出现 —— 待在角落、滚动时探头、读到 90% 后靠近结尾。

三种形态共用**同一个** `position: fixed` 元素，只换显隐时机。这一点是刻意的：如果在文档流里水合插入一个元素，会造成布局偏移（CLS）。固定的元素不占位，插不插都不影响排版。

```css
.q-companion {
  position: fixed;
  left: 18px;
  bottom: 0;
  z-index: 30;
  pointer-events: none;
  width: clamp(76px, 8vw, 118px);
}

@media (max-width: 767px) {
  .q-companion { display: none; }
}
```

- 左下角：右下角是迷你播放器，两个撞在一起会打架。
- `pointer-events: none`：它不挡任何东西。
- **手机上直接不显示**：一块固定的图在窄屏很容易压住正文。「不抢注意力」在手机上就等于「别出现」。

## 小结

这一块做完，我最大的感受是：**「活的」和「在晃」之间只有很小的距离。**

呼吸 1.4%、倾斜 0.45°、位移 5px、转角 2.2°、亮度 0 —— 这些数字都很小，但它们决定了她是「站在那里呼吸」还是「一个被加了动画的图片」。

而更难的部分不在参数，在时序：什么时候可以开始动，比动成什么样更容易出错。
