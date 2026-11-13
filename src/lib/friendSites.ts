// 「这个站点是不是已经在友链里」—— 评论区那枚徽章的唯一判据。
//
// 为什么不拿评论的 `status` 当判据：
//   `status` 是**这条留言**的处理状态（visible = 已收录 / pending = 等我看看），
//   而新留言一律落 pending。于是「人家早就加进友链了、只是又留了句话」
//   也会显示「等我看看」—— 看起来像站长没处理，其实是判据用错了。
//   真正的依据只有一处：`links.json` 里有没有这个站点。
//
// ⚠️ 这里**直接读 `links.json`，不走 `src/data/links.ts`**：
//   那个文件带 zod 校验，一旦 import 进来，zod（90KB）就回到客户端 chunk 里了
//   （2026-11-11 才把 zod 摘出去，别又加回来）。

import raw from '../data/links.json';

interface LinkRow {
  url?: string;
  visible?: boolean;
}

/**
 * 归一化到「域名」再比。
 *
 * 留言里大家填什么的都有：`n0v0rland.xyz`、`https://www.n0v0rland.xyz/`、
 * 带尾斜杠、带子路径……按字符串直接比永远会对不上，所以只留 host。
 * 友链都是站点根，按 host 比不会误判；宁可宽容一点，也别让人明明在友链里却显示「等我看看」。
 */
function hostOf(url: string): string {
  let s = (url || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // 协议
  s = s.replace(/^www\./, ''); // www 前缀
  s = s.split('/')[0] ?? ''; // 路径
  s = s.split('?')[0] ?? ''; // 查询串
  s = s.split('#')[0] ?? ''; // 锚点
  s = s.replace(/:\d+$/, ''); // 端口
  return s;
}

/** 已收录的站点（`visible === false` 的是后台草稿，不算「已加」） */
const SITES = new Set(
  ((raw as { friends?: LinkRow[] }).friends ?? [])
    .filter((l) => l.visible !== false)
    .map((l) => hostOf(l.url || ''))
    .filter(Boolean),
);

export function isFriendSite(url?: string | null): boolean {
  const h = hostOf(url || '');
  return Boolean(h) && SITES.has(h);
}
