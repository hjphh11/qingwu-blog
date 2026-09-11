---
title: "做一个纯前端、离线可用的 Python 刷题网页"
description: "备考二级 Python 的时候，我给自己写了一个单文件刷题页：零依赖、离线可用、题库可换。这篇记录它的设计取舍与几个实现细节。"
pubDate: 2026-09-23
category: tech
tags: ["JavaScript", "前端", "单文件", "开源"]
---

备考二级 Python 的那段时间，我在纸上刷题、在网页上刷题，都不太顺手：纸质的不好统计错题，在线题库又要登录、要联网，还不一定能自己加题。

于是我干脆给自己写了一个：**一个 `index.html` 就是完整应用**，双击就能刷题。

## 一个 HTML 文件就是全部

这个项目（我把它开源在 [python-exam-quiz](https://github.com/hjphh11/python-exam-quiz)）刻意守住了几条底线：

- **零依赖**：没有框架、没有 npm、没有构建步骤。
- **零网络请求**：字体用系统字体栈，图标全部是内联 SVG，连题库都是内嵌在 HTML 里的。
- **离线可用**：双击文件就能跑，断网也一样。

功能上它并不简陋：随机抽题、限时作答、自动判分、逐题解析、错题本、成绩趋势，都有。

## `file://` 逼出来的两个决定

这个项目里有两个决定，完全是被「双击打开」这个使用方式逼出来的。

**第一，不能用 ES module。** 浏览器在 `file://` 协议下会拦截 ES module 的加载（同源策略）。所以我用的是最传统的 `<script>` 标签，整个应用包在一个 IIFE 里：

```js
(function () {
  'use strict';
  // ... 全部逻辑
})();
```

**第二，不能 `fetch` 本地 JSON。** 同样在 `file://` 下，`fetch('./questions.json')` 会被拦。所以题库直接以纯 JSON 形式内嵌在页面里：

```html
<!--BANK-START-->
<script type="application/json" id="questionBank">[{"set":1,...}]</script>
<!--BANK-END-->
```

读取时把它当文本解析出来就好，不需要任何请求：

```js
window.BUILTIN_BANK = JSON.parse(document.getElementById('questionBank').textContent);
```

`<script type="application/json">` 不会被当作脚本执行，但又完整保留了原始数据——这大概是「离线单文件应用」最省事的题库容器。

## 题库可以换成你自己的

内嵌是为了能双击就跑，但如果题库不能换，这个页面就只是个玩具。所以我留了两条路。

**一、页面上直接导入（推荐）。** 选一个 JSON 文件，用 `FileReader` 读出来，逐题校验，通过后写进 `localStorage`，刷新即可用；想换回去点「恢复内置」就行。

校验逻辑写得比较严，因为它决定了后面的判分可不可信：

```js
if (typeof q.stem !== 'string' || !q.stem.trim()) return { ok: false, error: at + ' 缺少题干 stem' };
if (!Array.isArray(q.options) || q.options.length < 2) return { ok: false, error: at + ' 的 options 至少要 2 个' };
// ... key 重复、答案不在选项里等
```

报错会明确告诉你**是第几项错的**（「第 12 项 的答案「E」不在选项 key 中」），而不是笼统地说一句「格式错误」。不合格的题库不会写进去，避免把页面搞坏。

**二、永久写进 HTML。** 用 `tools/embed_bank.py` 把题库替换进上面那个 `<!--BANK-START-->` 区块，这样把**单个 HTML 文件**发给别人，对方拿到就是完整题库：

```python
payload = json.dumps(bank, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
```

这里有两个小细节：`ensure_ascii=False` 保留中文可读；把 `<` 转义成 `\u003c`，是为了防止题干里出现 `</script>` 把脚本块提前闭合——JSON 里这样转义后语义完全不变，但不会再被 HTML 解析器误伤。

## 抽题：加权不如分层

抽题逻辑没有做复杂的权重，而是拆成两步：先算题池，再排序取前 N 个。

```js
function poolFor(config) {
  var pool = BANK.slice();
  if (config.rangeMode === 'custom') {
    pool = pool.filter(function (q) { return setSet[q.set]; });
  }
  if (config.source === 'wrong') {
    pool = pool.filter(function (q) { return wrongBook[q.id]; });
  }
  return pool;
}
```

「优先做没做过的题」也没有用权重，而是直接分成两组再拼接——这样「优先」是确定性的，不会出现偶发地抽到一堆做过的题：

```js
var fresh = shuffle(pool.filter(function (q) { return !seen[q.id]; }));
var old = shuffle(pool.filter(function (q) { return seen[q.id]; }));
picked = fresh.concat(old);
```

`shuffle` 用的是 Fisher–Yates，避免 `sort(() => Math.random() - 0.5)` 那种分布不均匀的写法。

## 计时：用时间差而不是累加

限时模式的计时器每秒 tick 一次。关键在于 `elapsed` 不是简单 `+1`，而是按真实时间差累加：

```js
var now = Date.now();
q.elapsed += Math.round((now - q.lastTick) / 1000);
q.lastTick = now;
```

因为 `setInterval` 在后台标签页会被浏览器降频甚至暂停，如果直接 `elapsed++`，切走一会儿再回来，计时就会「少走」。用时间差算，才不会让用户凭空多出几分钟。

剩下的就是分级提醒：剩余 ≤300 秒加 `warn` 类，≤60 秒加 `crit` 类，归零就自动交卷；同时每 5 秒存一次进度。

## 刷新之后还能接着做

进度、错题本、成绩、设置全部存在 `localStorage`，用 `pyquiz.` 前缀分开：

```js
var LS = {
  wrong: 'pyquiz.wrong.v1',
  history: 'pyquiz.history.v1',
  progress: 'pyquiz.progress.v1',
  settings: 'pyquiz.settings.v1',
  seen: 'pyquiz.seen.v1',
  bank: 'pyquiz.bank.v1'
};
```

所有读写都包在 try/catch 里，`localStorage` 不可用（隐私模式、容量超限）时静默降级，不会让整个页面崩掉。答题中途关掉浏览器，下次打开会看到「继续」卡片，可以从中断处接着答。

## 键盘快捷键，以及一个容易踩的坑

刷题是个高频重复动作，所以键盘操作必须顺手：`A`–`D` 或 `1`–`9` 选选项、`←` `→` 换题、`F` 标记待定、`Enter` 下一题、`?` 看快捷键说明。

其中 `Enter` 有个坑：如果焦点正好停在某个按钮上，浏览器原生的「回车即点击」也会触发一次，两边一起跑就会跳两题。所以要先判断焦点：

```js
if (ev.key === 'Enter') {
  // 焦点在按钮/链接上时交给原生激活，避免重复触发
  var ae = document.activeElement;
  if (ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A')) return;
  ev.preventDefault();
  if (q.index === q.items.length - 1) $('#btnSubmit').click();
  else gotoQuestion(q.index + 1);
}
```

另外，在输入框里按 `1` 不应该被当成选选项，所以处理前先让 `INPUT` / `TEXTAREA` 直接返回。

## 几个「故意不做」的决定

写这个小工具的过程中，我拒绝了几件看起来很自然的事：

- **选项不乱序。** 因为解析里经常写「本题选择 B 选项」、「A 选项的 `int` 是……」，一旦乱序，解析就对不上了。题库顺序即显示顺序。
- **不用 emoji，全部内联 SVG。** emoji 在不同系统上字形差异极大，一个工具界面不该靠 emoji 撑。
- **不做账号、云同步、排行榜。** 定位是「练习与自测」，加这些只会让它变重。
- **错题本用「答对即移出」。** 这样它是一张「待攻克清单」，而不是一本越记越厚的流水账；完整历史交给成绩记录。

## 最后一点体会

这个小工具大概是我做过的「性价比」最高的项目之一：技术难度不高，但每一处取舍都直接对着自己的使用习惯。做给自己用的东西，需求最清楚，也最能较真。

>零依赖、离线可用、数据全在本地——它不联网，也不上传任何东西。这一点，是我觉得它比在线题库更让人安心的地方。

源码在 [hjphh11/python-exam-quiz](https://github.com/hjphh11/python-exam-quiz)，MIT 协议。题库格式按「题干 + 选项」设计，其实不限于 Python，也不限于单选题——`options` 有几个就渲染几个。
