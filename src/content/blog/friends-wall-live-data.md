---
title: "给友链墙通上电：实测速度、真实点击、最近更新"
description: "友链页这一轮加了三样「活的数据」：用 favicon 探 RTT、用 sendBeacon 记点击、由 Worker 每天抓对方的 RSS。附多列布局、hover 浮层和一串静默失败的坑。"
pubDate: 2026-11-07
category: tech
tags: ["前端", "无障碍", "性能", "踩坑"]
---

友链页原本是一面静态的墙：头像、名字、一句话、域名，完。

这一轮我想让它「有信息」一点 —— 别只是好看，得告诉我点进去会不会卡、这个站还活着吗、我点过几次。于是加了三样东西：**实测访问速度、累计点击数、最近更新时间**。

三样数据都来自真实测量，没有一个是写死的。这篇记一下它们各自是怎么做的，以及中间那些不报错、只是「数字不涨」的坑。

## 先把它排成一面墙

要做「有流动感」的墙，第一反应是 CSS multi-column：`column-count: 4`，加 `break-inside: avoid`，就错落了。

实测不行。

因为 hover 浮层要探出卡片上方，卡片必须是 `overflow: visible`。而 `overflow: visible` 会打乱多列的分列计算 —— 8 张卡片**全部挤进了第一列**（抓出来 `x` 全是 219px）。

改成「grid 定列宽 + 每列内部 flex 竖排」，问题消失：

```html
<div class="q-links-wall">
  <div class="q-links-col">…</div>  <!-- 4 个 -->
</div>
```

分列在服务端就做完，`overflow` 怎么改都不影响布局。

```css
.q-links-wall {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.1rem;
  align-items: start; /* 每列自己往下长，不等高 —— 这就是错落的来源 */
}
```

列数固定 4 也是试出来的：8 个友链刚好两排。试过 5 列，多列平衡会把卡片塞成 2/1/2/2/1，中间空出一大块，看着像漏了一张。

### 高度错落是故意的

方卡片看着像表格，竖长条才像「贴在墙上的纸条」。所以每张卡按 `--tall` 给不同最小高度：

```
--tall: 1 / 0.86 / 1.18 / 0.94
```

再配一点固定的倾斜：

```css
.q-links-card:nth-child(3n + 1) { --tilt: -0.55deg; }
.q-links-card:nth-child(3n + 2) { --tilt:  0.42deg; }
.q-links-card:nth-child(3n + 3) { --tilt: -0.26deg; }
```

角度都不超过 0.6°。再大就不是「贴上去的」，而是「没贴好」。

### 滚动时的「风」

想让往下滑的时候，这面墙像有风穿过。`animation-timeline: view()` 能做，但 Safari 还不支持 —— 而这条墙的观感几乎全靠它，不支持就等于没做。所以手写 rAF：

```js
const rect = wall.getBoundingClientRect();
const p = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
const base = (Math.min(1, Math.max(0, p)) - 0.5) * TRAVEL;

cards.forEach((el, i) => {
  // 四列轮流 -1.5 / -0.5 / 0.5 / 1.5：相邻列反向，才有「层」的错觉
  const k = (i % 4) - 1.5;
  el.style.setProperty('--shift', `${base + k * p * AMP}px`);
});
```

两个关键决定：

- **用「墙在视口里的进度」而不是 `scrollY`。** `scrollY` 会一直累加，滚到页面底部位移就偏出去了；进度是 0→1 的，卡片进来时略微坠后、离开时略微拖上，来回滚都不会漂走。
- **幅度只有十几像素**（`AMP = 8`，总行程 `TRAVEL = 26`）。大了就变成「卡片在乱飘」，会盖住旁边的东西。

`transform` 里必须同时带上 `--shift` 和 `--tilt`。分开写会互相覆盖 —— 这个坑在立绘那三层上已经吃过一次了。

`prefers-reduced-motion` 下直接不挂监听，`--shift` 不写，卡片停在原位。

## 测速：用 favicon 当探针

要显示「点进去卡不卡」，最直接的办法是量一次请求耗时。

但跨域 `fetch` 会被 CORS 挡在 response 之外，拿不到时间。于是换成 `<img>`：它是 no-cors 请求，`load` 和 `error` 都会触发。

这里有个反直觉的点：**`error` 也算通。**

对方的 `/favicon.ico` 404 了，说明那台服务器应答了 —— 我们要的就是往返时间。所以：

```js
img.onload = done;
img.onerror = done;
```

两个都指向同一个函数。

另外两件事同样重要：

**必须加随机 query。** 不加的话第二次进来全是缓存命中，显示 0~2ms —— 这等于撒谎。

```js
img.src = `${origin}/favicon.ico?_=${Date.now()}`;
```

**必须进视口才测。** 一屏 8 张卡同时打 8 个外站，会把友链页自己拖慢。用 `IntersectionObserver` 加 150px 预判，测过的卡打上 `data-measured`，不重复测。

分档阈值是 **500 / 1200ms**（绿 / 琥珀 / 红）。试过 300/900，结果国内访问境外站几乎全落在琥珀 —— 等于没有信息量。

还有个 6 秒兜底：站点彻底挂掉时 `load` / `error` 都不来，得自己显示「超时」。

最后，这个数要说得清楚它是什么：

> 它是「从我这台机器到对方站」的往返，不是对方的真实负载。代理、跨境线路都会算进去。它只能回答「现在点进去会不会卡」。

不许把它包装成「网站性能监测」，那不是它。

## 点击数：那个静默不涨的 bug

点击统计是读 + 写两条路：`GET /link-stats` 拿每个域名的累计数，点击时 `POST /link-click` 上报一次。

上报用 `sendBeacon`，因为页面马上要跳走，普通请求会被取消。

但 `sendBeacon` 有个硬约束：**它走的是「简单请求」通道，不能处理 CORS 预检。**

而 `application/json` 恰好会触发预检 —— beacon 直接被丢掉，连报错都没有。所以 Content-Type 得是 `text/plain`：

```js
const payload = new Blob([JSON.stringify({ url })], {
  type: 'text/plain;charset=UTF-8',
});
navigator.sendBeacon(`${LINK_API}/link-click`, payload);
```

服务端用 `request.json()` 照样能解析 —— 它不看 Content-Type。

然后是我踩得最深的一个坑。

上线跑了大半天，点击数一直是 0。接口不报错、前端不报错、卡片上就是那个空格子。

原因：前端上报时传的是 `data-host`（`ragnote.top` 这种纯域名），而后端第一件事是 `new URL(url)` 取主机名。`new URL('ragnote.top')` 直接抛错，接口回了 **200 + `{ ok: false, error: 'bad_request' }`**。

HTTP 200，前端 `catch` 也不会触发，数字就永远不涨。

修法就一行：传完整 URL，让后端自己归一。

```js
const url = card.dataset.url || card.dataset.host;
```

顺手还加了个体验细节：点完**立刻 +1**。不然点完这一下页面上什么都不变，要等下次进页面才看得到 —— 用户会以为坏了。

### 另一个坑：请求被自己掐断

首屏有两个入口都会调用初始化函数（`astro:page-load` 和 `DOMContentLoaded`），`/link-stats` 会被打两次。

于是加了个标记去重。但第一次写反了顺序：

```js
// 错：先 teardown 再判断
teardownStats();
if (cards[0].dataset.statsBound === '1') return;

// 对：先判断再 teardown
if (cards[0].dataset.statsBound === '1') return;
teardownStats();
```

写反的后果很微妙：第二次调用先把第一次刚发出的 `fetch` 用 `AbortController.abort()` 掐掉，然后自己因为标记 `return` 了。结果**一次都没成**，而且悄无声息。

## 悬停才浮出的站点图

第三样是「放上去才显示」的站点预览图。

最初想自动截图，试了两条路都不行：mShots 直接 403，thum.io 截到的是 Cloudflare 验证页。又想「没填就自动捞对方的 og:image」，结果每张卡都冒出别人的图 —— 和「放上去才显示」正好相反。

最后定成：**只认 `links.json` 里手填的 `shot`，没填就什么都没有。** 宁可少，不要错。

浮层的 CSS 里有三个决定它像不像「浮起来的卡」的细节：

```css
.q-links-card__preview {
  position: absolute;
  left: -0.7rem;
  right: -0.7rem;
  bottom: calc(100% - 3px); /* 与卡片重叠 3px，不能留缝 */
  z-index: 20;
  opacity: 0;
  transform: translateY(6px) scale(0.98);
  transform-origin: 50% 100%;
  pointer-events: none;
}
```

- 左右各比卡片宽 0.7rem，视觉上才托得住、有层次。
- **`bottom: calc(100% - 3px)` 与卡片重叠 3px。** 留缝的话，鼠标从卡片往上移会先离开卡片，浮层当场消失 —— 看着像闪一下。
- hover 时卡片自己 `z-index: 10`，否则浮层会被后面那张卡压住。

浮层 `pointer-events: none`：纯展示，不抢点击，也不影响卡片的 hover 判定。

但这两条 CSS 差点互相坑死。

卡片本身挂着 `.card-spotlight`，那个类在文件更后面，同优先级下它那条 `overflow: hidden` 会把卡片的 `visible` 盖回去 —— 浮层就永远探不出卡片。

所以必须显式提权：

```css
.q-links-card.card-spotlight {
  overflow: visible;
}
```

还有一条更阴的：

```css
/* 把内容抬到氛围底之上 */
.q-links-card > :not(.q-links-card__bg):not(.q-links-card__preview) {
  position: relative;
  z-index: 1;
}
```

这条规则里**必须排除浮层**。`not()` 让选择器优先级变高，如果不排除，它会把浮层的 `absolute` 改成 `relative` —— 浮层掉进文档流、压在卡片内容顶上，看着像「图挤进了卡里」。

## 最近更新：Worker 每天抓一次

第四样是「N 天前更新」。

前端不做任何抓取。Worker 有个定时任务，每天扫一遍所有友链，读对方的 RSS 或 sitemap，把最近一篇文章的日期写进 D1 的 `link_feeds` 表。

前端只是读：

```js
const iso = data.feeds?.[host];
if (iso && up) {
  up.textContent = relativeUpdate(iso);
  up.hidden = false;
}
```

两个约定：

- **抓不到就不显示。** 那个 `span` 默认 `hidden`，拿不到数据就一直是空的。显示「不明」比不显示更吵。
- **如果 `link_feeds` 表还没建（迁移没跑），接口只回点击数。** 前端照样不报错，只是没有更新日期 —— 这个功能的失败模式是「安静地没有」，不是「报错」。

`relativeUpdate()` 把 `2026-10-28` 说成人话：今天 / 昨天 / N 天前 / N 个月前。超过一年就直接给日期。

## 小结

这一轮加的四样东西（速度、点击、更新、悬停图），技术上都不复杂。真正花时间的是那几个**不报错**的问题：

- `application/json` 触发预检 → beacon 被丢，静默
- 传裸域名 → 后端 `new URL()` 抛错 → 200 + bad_request，静默
- 先 teardown 再判断 → 请求被自己 abort，静默
- `not()` 选择器把 `absolute` 改成了 `relative`，静默

它们的共同点是：**失败长得像「还没数据」**。而「还没数据」是我自己设计的——空格子不显示，是为了不闪一个 0。

这个设计本身没错，但它把所有错误都藏起来了。所以后来我的做法是：每个「安静失败」的地方都要能手动验一次 —— 点一下卡，看数字动不动；打开接口，看回的是不是 `ok: true`。

好看的前提是准。一个撒谎的「12ms」，不如什么都不显示。
