---
title: "403 不是 404：一次构建中断，让整站看起来挂了"
description: "有人跟我说「首页能进，其他页面 404」。我去看了一眼，首页也是 403。真正的原因既不是路由也没被墙 —— 是一条空字符串让 Astro 在渲染到第 31 个页面时断了，而后面的页面再也没写进磁盘。"
pubDate: 2026-11-24
category: tech
tags: ["运维", "nginx", "Astro", "事故复盘", "踩坑"]
---

上午十点半，收到一句反馈：

> 首页可以进去，然后其他有些页面 404。

很典型的描述。第一反应是路由问题 —— 改过路径、链接没跟着更新，或者某个页面被误删。于是先按页面挨个请求了一遍：

```
/                403
/links/          403
/music/          403
/about/          200
/articles/       404
/projects/       404
```

看到这组数字，第一反应就该丢掉「路由」这个假设了 —— **首页是 403**。

对方说「首页能进」，是因为他浏览器里那份缓存还在。缓存过期之后，首页和别的页面一样打不开。

## 403 和 404 完全不是一回事

这两个码经常被当成「页面打不开」的同义词，但它们指向的东西完全不同：

- **404** 是 nginx 找遍了 `try_files` 里列的候选，一个都不存在。
- **403** 是「找到了，但不给你」。

我这个站的静态路由长这样：

```nginx
location / {
    try_files $uri $uri/index.html $uri/ =404;
}
```

`/projects/` 返回 404，说明 `$uri`、`$uri/index.html`、`$uri/` 三个候选全落空 —— 连 `projects` 这个**目录**都不存在。

而 `/links/` 返回 403，说明前面几项也没中，但**最后一项 `$uri/` 命中了**：`links` 目录确实在，nginx 就去做目录索引，然后在里面找 `index.html` —— 没找到。

这时它的响应不是 404，而是 403：

```
directory index of "/data/qingwu/dist/client/links/" is forbidden
```

原因是 `autoindex` 默认关闭。目录存在、但没有默认索引文件、又不许列目录 —— 从 nginx 的角度看，这就是「存在但禁止访问」。

**这条差异就是全部线索**：有些页面连目录都没建出来，有些页面目录建出来了、里面的文件没写进去。

换句话说，不是「某个页面没了」，是**产物只生成了一半**。

## 数一下文件就够了

本地构建出来的东西是 346 个文件。服务器上：

```bash
$ find /data/qingwu/dist/client -type f | wc -l
335
```

少了 11 个。而缺的这几个很说明问题：

```
index.html          ← 首页
projects/           ← 整个目录
share/              ← 整个目录
rss.xml
sitemap-0.xml
sitemap-index.xml
```

再看 `links/` 目录里面：

```
links/
└── apply/          ← 只有一个子目录，没有 index.html
```

`music/` 更直接，只剩 `covers/`、`lrc/` 和一份 README —— 页面本体没了。

`about/` 和整个 `blog/` 都是好的。

如果按路由首字母排序，缺失的是**尾部那一段**：`link` 之后的页面全断，前面的都在。这个形状基本只有一个解释：构建是**按顺序写盘**的，写到某处就停了。

## 为什么只写了一半

Astro 的静态构建不是「全部渲染完再一次性落盘」，而是一页渲染、一页写进 `dist`。日志里看得很清楚：

```
├─ /links/apply/index.html (+67ms)
├─ /links/posts/index.html10:22:34 [ERROR] Error: src/data/links.json 内容不符合预期
```

`/links/posts` 这一页抛错了：

```
· friends.17.avatar：不能为空
· friends.17.avatar：需要是 http(s) 链接，或以 / 开头的站内路径
```

我在 `src/data/links.ts` 里用 zod 校验友链数据，其中 `avatar` 要求非空且是链接。后台加了一条友链，头像字段留了空字符串。

<figure>
  <img src="/images/blog/build-interrupt.svg" width="820" height="310" alt="示意图：Astro 按顺序逐页写盘，前 30 页成功，第 31 页 /links/posts 因头像校验抛错中断，后面的页面再没写；结果是目录存在但没有 index.html 的页面返回 403，连目录都没建出来的返回 404" loading="lazy" />
  <figcaption>断点在前 30 个页面之后。已经写进磁盘的留着，没轮到的连目录都没有 —— 这就是「有些页面 403、有些 404」的来源。</figcaption>
</figure>

校验在渲染 `/links/posts` 时才触发 —— 因为只有这一页会去 import 那份数据。于是它成了断点：前面 30 个页面已经写完了，后面 10 来个（包括首页）**再也没轮到**。

## 更糟的是，它不会自己恢复

服务器上有个 systemd timer，每两分钟检查一次仓库有没有新提交，有就拉下来构建。

日志里 10:22 那次是这样的：

```
10:22:03  Starting qingwu-deploy.service
10:22:34  Main process exited, code=exited, status=1/FAILURE
10:22:34  Failed to start
```

之后每两分钟都「成功」了：

```
10:24:06  Starting...
10:24:07  Deactivated successfully.
10:26:12  Starting...
10:26:13  Deactivated successfully.
```

一秒就结束，因为脚本第一件事是比较本地 HEAD 和远端：

```bash
[ "$LOCAL" = "$REMOTE" ] && exit 0
```

代码已经是最新的了（`git pull` 成功了，是构建失败的），所以后面每一轮都直接退出。**坏掉的产物就那么静静地躺着，直到有人手动触发一次构建。**

这套自愈机制的设计前提是「失败会自己重试」，但这里有个错位：**拉取成功 + 构建失败**，在「有没有新提交」这个判据下等于「已完成」。

## 那句注释是错的

最让我不爽的是脚本里这行：

```bash
if ! npm run build >>"$LOG" 2>&1; then
  log "构建失败，保持上一版"
  exit 1
fi
```

「保持上一版」这句话是我自己写的，**而它是假的**。

`npm run build` 的第一步会清空 `dist`。等它跑到中途失败，上一版早就没了 —— 剩下的只是这一版的残骸。所谓「保持上一版」，实际上是「保持一个残缺的新版本」。

这类注释比没有注释更糟。它给了我一种「这里已经考虑过了」的错觉，所以出事的时候我没往这个方向想。

## 三段修复

**一、先把数据和站点救回来。**

那条友链是真实存在的站点，头像确实有，只是地址没填。探测了一下 `/avatar.jpg`（几个常见路径里唯一 200 的），补上去，手动重建一次，346 个文件回来了，13 个路径全部 200。

**二、让构建失败不再等于站点报废。**

构建前先把旧产物搬走，成功才删：

```bash
PREV="$REPO/.dist-prev"
rm -rf "$PREV"
[ -d "$REPO/dist" ] && mv "$REPO/dist" "$PREV"

rollback() {
  log "$1，回滚上一版产物"
  rm -rf "$REPO/dist"
  [ -d "$PREV" ] && mv "$PREV" "$REPO/dist"
  exit 1
}

if ! npm run build >>"$LOG" 2>&1; then
  rollback "构建失败"
fi
```

同时把产物闸门从「只看 `index.html`」扩成四个关键页：

```bash
for f in index.html links/index.html music/index.html projects/index.html; do
  [ -s "$REPO/dist/client/$f" ] || rollback "构建产物缺 $f"
done
```

这里有个取舍：构建期间 `dist` 是不存在的，大约 30 秒。以前这 30 秒里访问会 404（`try_files` 全落空），现在也一样。但**这 30 秒是短暂的，而不是「一直坏到有人发现」**。用 30 秒的空窗换掉一次全天故障，值。

理论上还能更好 —— 构建到临时目录、成功后原子 `rename`，连空窗都没有。但 Astro 的 `outDir` 是配置里写死的，旁边还挂着 vercel adapter 往 `.vercel/output` 写东西，改它牵连太多。先把这个洞堵上。

**三、从入口拦住坏数据。**

真正该被修的是「空头像为什么能进仓库」。

后台提交友链的那个接口，校验是这样的：

```ts
const bad = friends.findIndex((f) => !f.name || !f.url);
if (bad >= 0) return json({ ok: false, reason: 'incomplete', index: bad }, 400);
```

`name` 和 `url` 是必填，`avatar` 不在里面。于是它一路畅通无阻地进了 `links.json`，然后在构建时才炸 —— 一个「提交时能过、部署时必炸」的字段。

补上：

```ts
const LINK_LIKE = /^(https?:\/\/|\/)/;
const noAvatar = friends.findIndex((f) => !LINK_LIKE.test(f.avatar));
if (noAvatar >= 0) {
  return json({
    ok: false,
    reason: 'no_avatar',
    index: noAvatar,
    message: `第 ${noAvatar + 1} 条「${friends[noAvatar].name}」的头像地址为空或格式不对 —— 空头像会让整站构建失败，请补上再提交`,
  }, 400);
}
```

提示里带上位置和名字，是因为下次未必是我自己在用这个后台。

## 三条留下来的判断

**一、403 和 404 必须分开看。** 404 说明「东西不在」，403 说明「东西在，但拿不到」。静态站里出现 403，八成是「目录存在但没有 `index.html`」—— 这不是权限问题，是产物不完整。以后见到 403，我第一件事是数文件，而不是查权限和限流。

**二、构建不是原子操作。** 只要产物是按页逐个写的，任何中途失败都会留下半套。所以「构建成功」这件事不能交给退出码来判断，得在构建完**实际检查关键文件在不在**。`exit 0` 只说明进程没崩，不说明产物是完整的。

**三、校验要放在最近的那个入口。** 数据在 `links.json`、在 zod schema、在构建时都有校验，但那些都在**下游**。下游校验的代价是「整站挂掉」；上游校验的代价是「一条提示」。同一个规则，写在越靠后越贵。

至于那句「构建失败，保持上一版」的注释 —— 我删了。注释写得再肯定，也改变不了一句 shell 命令实际做了什么。
