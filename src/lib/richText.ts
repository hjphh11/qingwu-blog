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
 *   [文字](https://链接)
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

/** 行内：代码 → 粗体 → 链接 → 裸链 → 表情 */
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
  let t = esc(raw);

  t = t.replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>');

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

  return t;
}

const FENCE = /^```\s*([a-z0-9+#.-]*)\s*$/i;
const UL = /^\s*[-*+]\s+/;
const OL = /^\s*\d+[.)]\s+/;
const QUOTE = /^\s*>\s?/;

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

    // ③ 引用（连续 > 行合成一段）
    if (QUOTE.test(line)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        buf.push(lines[i]!.replace(QUOTE, ''));
        i += 1;
      }
      out.push(`<blockquote>${buf.map(inline).join('<br />')}</blockquote>`);
      continue;
    }

    // ④ 列表（连续同类行合成一个 ul/ol，不嵌套）
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
    .replace(/\[([^\]]{1,80})\]\((https?:\/\/[^\s)]+)\)/gi, '$1（$2）')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .trim();
}
