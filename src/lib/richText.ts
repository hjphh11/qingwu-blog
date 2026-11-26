/**
 * 留言正文的渲染：**Markdown 子集 + 表情 token**
 *
 * 为什么自己写而不上 markdown-it：只要代码块 / 列表 / 引用 / 链接四样，
 * 完整解析器要 30KB+，还要处理一堆本站用不到的语法（表格、脚注、HTML 内嵌……
 * 后者恰恰是 XSS 的主要入口）。这里 ~120 行，规则白名单，**先转义再拼标签**。
 *
 * 支持的写法（就这些，多的一律当普通文字）：
 *
 *   ```js          代码块（也可以只用 ``` 收尾）
 *   `code`         行内代码
 *   **粗体**
 *   *斜体*         只有单星号；`2*3` 这类两边都是字母数字的不算
 *   ~~删除线~~
 *   ## 小标题       `###` 再小一级；单个 `#` 不认（消息里不该出现 h1）
 *   [文字](https://链接)
 *   ![说明](https://图片)  站外图（对方站的音乐/链接卡片就是这么发的）
 *   https://裸链接  自动成链
 *   - 项 / * 项     无序列表
 *   1. 项           有序列表
 *   > 引用
 *   :[rofl]        表情（key 必须存在于 src/lib/emojis.ts 的清单里）
 *
 * ⚠️ 安全边界：整段先 `esc()`，之后只「往回加」固定几个标签。
 *    所有 URL 只认 http/https，属性值里的引号已被转义成 `&quot;`。
 *    表情只认清单内的 key，`url(javascript:...)` 这类文本不可能变成标签。
 */

import { EMOJI_MAP } from './emojis';

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

const SAFE_URL = /^https?:\/\//i;

/** 位图扩展名 —— 裸链接只有长成这样才当封面，`.html` / `.mp3` 不会被误认 */
const IMG_EXT = /\.(?:jpe?g|png|gif|webp|avif|bmp)(?:[?#]\S*)?$/i;

/**
 * 整行是不是「一张图」：`![说明](地址)`，或干脆一个裸图片直链。
 *
 * 为什么要认裸链接：其他站的卡片消息把封面当**普通一行**发出来，
 * 没有 `![]()` 包裹（冷汐的「文章分享」就是标题、摘要、文章链接、封面 URL 四行），
 * 不认的话最后那行就是一条又长又丑的红色链接。
 */
export function isImageLine(raw: string): boolean {
  const s = raw.trim();
  if (/^!\[[^\]\n]{0,200}\]\(https?:\/\/[^\s)]+\)$/.test(s)) return true;
  return /^https?:\/\/[^\s]+$/i.test(s) && IMG_EXT.test(s);
}

function imgTag(src: string, alt = '图片'): string {
  return `<img class="q-rich__img" src="${src}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
}

/** 行内：代码 → 斜体 → 粗体 → 删除线 → 链接 → 裸链 → 表情 */
function inline(raw: string): string {
  return raw
    .split(/(`[^`\n]+`)/g)
    .map((part) => {
      if (/^`[^`\n]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
      return inlineText(part);
    })
    .join('');
}

function inlineText(raw: string): string {
  const lineTrim = raw.trim();

  /**
   * 整行一张图（裸直链）先处理掉，别让它落到「裸链自动成链」那条规则里。
   * `![说明](url)` 不用在这里管，下面那条图片规则会接住。
   */
  if (/^https?:\/\/[^\s]+$/i.test(lineTrim) && IMG_EXT.test(lineTrim)) return imgTag(esc(lineTrim));

  /**
   * 整行一个类型标签：`[LX:文章分享]`。
   *
   * 这是其他站给消息打的类型前缀（冷汐的卡片都是 `[LX:文章分享]` / `[LX:友链分享]` /
   * `[LX:动态分享]`），对读者有用的只有后半截。渲染成一个小徽标，原文留在 title 里。
   * 必须整行匹配：`[ID:清吾];[URL:…]` 这种协议头后面还有东西，不会命中。
   */
  const tag = /^\[([A-Za-z0-9_]{2,8}):([^\]\n]{1,12})\]$/.exec(lineTrim);
  if (tag) return `<span class="q-rich__tag" title="${esc(lineTrim)}">${esc(tag[2]!)}</span>`;

  let t = esc(raw);

  /**
   * 斜体必须在粗体**之前**处理，而且必须带 flanking 限制。
   *
   * 为什么不能直接 `\*([^*]+)\*`：聊天里 `2*3*4`、`a*b*c` 太常见，
   * 那样写会把半条消息变成斜体。这里照 Markdown 的左右边界规则取了个简化版：
   * 开头那颗星前面不能紧跟字母数字（`2*` 排除），结尾那颗星后面同理，
   * 且两侧都不能是空白（`* 星号 *` 这种排版写法不当斜体）。
   *
   * `**粗**` 不受影响：开星后紧跟的仍是 `*`，`[^*\n]` 至少要吃一个非星字符，匹配不上。
   */
  t = t.replace(
    /(^|[^\w*])\*(?!\s)([^*\n]{1,200}?)(?<!\s)\*(?![\w*])/g,
    (_m, pre: string, body: string) => `${pre}<em>${body}</em>`,
  );

  t = t.replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>');

  // 删除线：`~~` 在日常输入里几乎没有歧义，不需要额外边界
  t = t.replace(/~~([^~\n]{1,200})~~/g, '<del>$1</del>');

  /**
   * 图片 `![说明](url)` —— **必须排在链接前面**。
   *
   * 排在后面的话 `[说明](url)` 会先被链接规则吃掉，只剩一个孤零零的 `!` 留在前面：
   * 对方站发来的音乐分享就是这样（`> ![](封面) > **🎵 曲名** …`），
   * 一串「!曲名」红链接，看着像解析坏了。
   *
   * 只认 http(s)；`referrerpolicy=no-referrer` 是给对方的域名省一个来路，
   * 我们这边的 CSP 本来就是 `img-src https:`，站外封面能正常显示。
   */
  t = t.replace(
    /!\[([^\]\n]{0,200})\]\((https?:\/\/[^\s)]+)\)/g,
    (m, alt: string, url: string) => (SAFE_URL.test(url) ? imgTag(url, alt) : m),
  );

  // [文字](url) —— 只认 http(s)；非法的一律原样留着
  t = t.replace(/\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)/gi, (m, text, url) =>
    SAFE_URL.test(url) ? `<a href="${url}" target="_blank" rel="nofollow noopener noreferrer">${text}</a>` : m,
  );

  // 裸链：前面必须是行首/空白/左括号，避免把 a.com/b.com 粘成一串
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/gi, (_m, pre: string, url: string) => {
    // 句末标点不算链接的一部分
    const trimmed = url.replace(/[.,;:!?，。；：！？]+$/, '');
    const tail = url.slice(trimmed.length);
    return `${pre}<a href="${trimmed}" target="_blank" rel="nofollow noopener noreferrer">${trimmed}</a>${tail}`;
  });

  // 表情：只认清单里的 key，其余原样显示（写成 :[我不知道] 也不会变成破图）
  t = t.replace(/:\[([a-z0-9_]{1,32})\]/g, (m, key: string) => {
    const e = EMOJI_MAP[key];
    return e ? `<img class="q-emoji" src="${e.src}" alt=":[${key}]" loading="lazy" decoding="async" />` : m;
  });

  /**
   * 再认一种写法：`:key`（不带方括号）。
   *
   * 为什么加：手打比点面板快，站长实测就打了 `:sunglasses`，结果原样显示成文字。
   * **必须校验 key 存在**才替换 —— 否则 `12:30`、`https://a.com:8080`、
   * `note:this` 全会被误伤。查表之后这几类都查不到 key，自然原样留着。
   */
  t = t.replace(/:([a-z0-9_]{2,32})(?![a-z0-9_\]])(?!\/)/gi, (m, key: string) => {
    const e = EMOJI_MAP[key.toLowerCase()];
    return e ? `<img class="q-emoji" src="${e.src}" alt=":[${key}]" loading="lazy" decoding="async" />` : m;
  });

  return t;
}

const FENCE = /^```\s*([a-z0-9+#.-]*)\s*$/i;
const UL = /^\s*[-*+]\s+/;
const OL = /^\s*\d+[.)]\s+/;
const QUOTE = /^\s*>\s?/;
/** 小标题：`##` → h3、`###` → h4。单个 `#` 故意不认 —— 一条消息里出现 h1 会把整页大纲弄乱 */
const HEAD = /^(#{2,3})\s+(.+)$/;

/** 正文 → HTML（已转义，可安全交给 dangerouslySetInnerHTML） */
export function renderRich(raw: string): string {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';

  const lines = text.split('\n');
  const out: string[] = [];
  let para: string[] = [];

  const flush = () => {
    if (!para.length) return;
    out.push(`<p>${para.map(inline).join('<br />')}</p>`);
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // ① 围栏代码块
    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const lang = fence[1] ?? '';
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        buf.push(lines[i]!);
        i += 1;
      }
      i += 1; // 吃掉收尾的 ```
      const cls = lang ? ` class="language-${esc(lang)}"` : '';
      out.push(`<pre><code${cls}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // ② 空行 = 段落分隔
    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }

    // ③ 小标题（单行，不吃后续行 —— 标题后面该是空行或正文，不该被吞成一段）
    if (HEAD.test(line)) {
      flush();
      const hm = line.match(HEAD)!;
      const level = hm[1]!.length === 2 ? 3 : 4;
      out.push(`<h${level}>${inline(hm[2]!.trim())}</h${level}>`);
      i += 1;
      continue;
    }

    // ④ 引用（连续 > 行合成一段）
    if (QUOTE.test(line)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        buf.push(lines[i]!.replace(QUOTE, ''));
        i += 1;
      }
      /**
       * 卡片化：引用块里只要有一张图，就把它提到最前面。
       *
       * 其他站的卡片把封面当**最后一行**发（`> 标题 / > 摘要 / > 文章链接 / > 封面 URL`），
       * 原样渲染出来封面会压在卡片底部，像张贴纸。图的角色是这张卡的门面，
       * 放回去——只在引用块里做，普通段落不动（那里顺序是作者有意排的）。
       */
      const imgAt = buf.findIndex((l, k) => k > 0 && isImageLine(l));
      if (imgAt > 0) buf.unshift(...buf.splice(imgAt, 1));

      /**
       * 以图片开头的引用 = 对方站的「卡片消息」（音乐分享 / 文章分享都是这个形状）。
       * 它本质是**一张卡片**，不是引一段话 —— 留着左边那根竖线和缩进，
       * 图会被竖线切一道，文字也灰一档。给个 class 让 CSS 把这层引用外观让开
       * （语义仍是 blockquote，读屏不受影响）。
       */
      const isCard = isImageLine(buf[0] ?? '');

      /**
       * 卡片第二行是标题。其他站发的原文里**不带 `**`**（他们是在前端当标题渲染的），
       * 我们这边不补就整张卡从封面到链接一个字重，读起来像一坨散文。
       * 只对「短、不是链接、本来也没加粗」的行动手，正常引用块不受影响。
       */
      if (isCard && buf[1]) {
        const t = buf[1].trim();
        if (t && t.length <= 80 && !/^(?:https?:\/\/|!\[)/i.test(t) && !/\*\*/.test(t)) buf[1] = `**${t}**`;
      }

      const cls = isCard ? ' class="q-rich__quote--card"' : '';
      out.push(`<blockquote${cls}>${buf.map(inline).join('<br />')}</blockquote>`);
      continue;
    }

    // ⑤ 列表（连续同类行合成一个 ul/ol，不嵌套）
    if (UL.test(line) || OL.test(line)) {
      flush();
      const ordered = OL.test(line);
      const marker = ordered ? OL : UL;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i]!)) {
        items.push(lines[i]!.replace(marker, ''));
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }

    para.push(line);
    i += 1;
  }
  flush();

  return out.join('');
}

/**
 * 纯文本版本 —— 邮件里不能塞标签。
 * 只去掉标记符号，正文与表情 token 保留（收件人看到 `:[bb_doge]` 也不难懂）。
 */
export function toPlain(raw: string): string {
  return String(raw ?? '')
    .replace(/```[a-z0-9+#.-]*\n?/gi, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    // 单星斜体：和渲染侧用同一条边界规则，别把 `2*3*4` 剥成 `234`
    .replace(/(^|[^\w*])\*([^*\n]{1,200}?)\*(?![\w*])/g, '$1$2')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/^\s*#{2,3}\s+/gm, '')
    // 图片语法要在链接规则**之前**剥，否则 `![说明](url)` 会剩下一个孤零零的 `!`
    .replace(/!\[([^\]]{0,200})\]\((https?:\/\/[^\s)]+)\)/gi, '$1')
    .replace(/\[([^\]]{1,80})\]\((https?:\/\/[^\s)]+)\)/gi, '$1（$2）')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .trim();
}
