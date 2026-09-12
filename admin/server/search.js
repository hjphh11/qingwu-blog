// 全局搜索（阶段 K · 方案 §4.14 + 第 44 条）：给 Cmd/Ctrl+K 那个搜索框提供数据。
//
// 一次搜：文章 / 分类 / 友链 / 分享·语录 / 音乐 / 友链申请 / 页面 / 动作。
// 每条结果都带一个 `route`（前端用它跳转），动作类还带 `download` 之类的标记。
//
// 数据都在本地（除了友链申请要走私有仓库，失败就跳过 —— 搜索不能因为 GitHub 抖一下就整个挂掉）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { listArticles } from './articles.js';
import { listCategories } from './categories.js';
import { listLinks } from './links.js';
import { listShares } from './shares.js';
import { listMusic } from './music.js';

/**
 * 文章正文（搜正文用的）。
 * 文章列表接口只给元数据 + 摘要，搜「Astro」这种正文词就搜不到 —— 所以这里读一遍 .md 原文。
 * 缓存 10 秒，免得连打几个字就把磁盘读穿（单用户后台，文章也就几十篇）。
 */
let bodyCache = { at: 0, map: new Map() };
async function articleBodies() {
  if (Date.now() - bodyCache.at < 10_000) return bodyCache.map;
  const dir = path.join(config.repoPath, 'src', 'content', 'blog');
  const map = new Map();
  try {
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith('.md')) continue;
      map.set(name.replace(/\.md$/, ''), await fs.readFile(path.join(dir, name), 'utf8'));
    }
  } catch {
    /* 目录不在就当没有正文可搜 */
  }
  bodyCache = { at: Date.now(), map };
  return map;
}

/** 页面（和 Shell 的 NAV key 一致）*/
const PAGES = [
  { title: '概览', subtitle: '内容与发布', route: { name: 'dash' }, keys: 'gailan overview 首页 数据总览' },
  { title: '文章', subtitle: '管理文章', route: { name: 'posts' }, keys: 'wenzhang posts 写作 列表' },
  { title: '分类', subtitle: '前台筛选按钮跟着它变', route: { name: 'cats' }, keys: 'fenlei categories' },
  { title: '友链', subtitle: '朋友列表', route: { name: 'links' }, keys: 'youlian friends' },
  { title: '友链申请', subtitle: '通过 → 写进友链', route: { name: 'apply' }, keys: 'shenqing apply 审批' },
  { title: '分享 · 语录', subtitle: '收藏与摘录', route: { name: 'share' }, keys: 'fenxiang shares quote 语录' },
  { title: '关于页', subtitle: '主页信息 / 信息条目 / 爱弥斯 / 联系方式', route: { name: 'about' }, keys: 'guanyu about 联系方式' },
  { title: '音乐', subtitle: '歌曲与歌词时间轴', route: { name: 'music' }, keys: 'yinyue music 歌词 lrc' },
  { title: '回收站', subtitle: '可恢复的已删除内容', route: { name: 'trash' }, keys: 'huishouzhan trash 删除' },
  { title: '操作日志', subtitle: '发布 / 回滚 / 审批记录', route: { name: 'logs' }, keys: 'caozuorizhi logs 日志' },
  { title: '发布', subtitle: '构建校验 → 提交 → 推送', route: { name: 'publish' }, keys: 'fabu publish 上线 部署 推送' },
];

/** 动作（搜到了直接做）*/
const ACTIONS = [
  { title: '新建文章', subtitle: '开一篇新文章', route: { name: 'edit', params: {} }, keys: 'xinjian xiewenzhang new post' },
  { title: '下载备份（zip）', subtitle: '文章 + 数据 + 歌词，可完整还原', download: '/api/backup', keys: 'beifen backup 导出 下载 zip 保存' },
  { title: '去发布', subtitle: '构建校验并发布待发布内容', route: { name: 'publish' }, keys: 'fabu publish 上线' },
  { title: '找待发布', subtitle: '看看有哪些改动了还没发布', route: { name: 'publish' }, keys: 'daifabu 待发布 未发布' },
];

const norm = (s) => String(s ?? '').toLowerCase();

/** 命中打分：越靠前越靠上；标题命中优于正文命中 */
function score(hay, q) {
  if (!hay) return -1;
  const i = hay.indexOf(q);
  if (i < 0) return -1;
  return i === 0 ? 0 : 100 + i;
}

function pick(candidates, q) {
  let best = -1;
  for (const c of candidates) {
    const s = score(norm(c), q);
    if (s >= 0 && (best < 0 || s < best)) best = s;
  }
  return best;
}

/** 搜一次：返回 { q, groups: [{kind,label,items:[...]}] } */
export async function searchAll(rawQuery, { limit = 6 } = {}) {
  const q = norm(rawQuery).trim();
  if (!q) return { q: '', groups: [] };

  const [articles, categories, links, shares, music] = await Promise.all([
    listArticles().catch(() => []),
    listCategories().catch(() => ({ categories: [] })),
    listLinks().catch(() => ({ friends: [] })),
    listShares().catch(() => ({ shares: [] })),
    listMusic().catch(() => ({ songs: [] })),
  ]);

  const groups = [];
  const push = (kind, label, items) => {
    if (items.length > 0) groups.push({ kind, label, items: items.slice(0, limit) });
  };

  // 正文命中要排在「标题/分类/标签」命中后面，所以给个固定的大惩罚
  const bodies = await articleBodies();

  // ——— 文章 ———
  push(
    'post',
    '文章',
    articles
      .map((a) => {
        const meta = Math.min(
          ...[
            pick([a.title], q),
            pick([a.slug, a.id], q),
            pick(a.tags ?? [], q),
            pick([a.category], q),
            pick([a.excerpt], q),
          ].filter((x) => x >= 0).concat([9999]),
        );
        const bodyRaw = bodies.get(a.id);
        const bodyHit = bodyRaw ? score(norm(bodyRaw), q) : -1;
        const body = bodyHit >= 0 ? bodyHit + 1000 : 9999;
        return { item: a, s: Math.min(meta, body), bodyOnly: meta === 9999 && bodyHit >= 0 };
      })
      .filter((r) => r.s < 9999)
      .sort((a, b) => a.s - b.s)
      .map(({ item: a, bodyOnly }) => ({
        title: a.title,
        subtitle: [
          a.category,
          a.draft ? '草稿' : '已发布',
          (a.tags ?? []).length ? (a.tags ?? []).map((t) => `#${t}`).join(' ') : '',
          a.date || '',
          bodyOnly ? '正文命中' : '',
        ]
          .filter(Boolean)
          .join(' · '),
        route: { name: 'edit', params: { id: a.id } },
        badge: a.draft ? '草稿' : '',
      })),
  );

  // ——— 分类 ———
  push(
    'category',
    '分类',
    (categories.categories ?? categories ?? [])
      .filter((c) => pick([c.label, c.id], q) >= 0)
      .map((c) => ({
        title: c.label ?? c.id,
        subtitle: `内部标识 ${c.id} · 图标 ${c.icon ?? '默认'}`,
        route: { name: 'cats' },
      })),
  );

  // ——— 友链 ———
  push(
    'friend',
    '友链',
    (links.friends ?? [])
      .filter((f) => pick([f.name, f.url, f.intro], q) >= 0)
      .map((f) => ({
        title: f.name || f.url,
        subtitle: [f.url, f.intro].filter(Boolean).join(' · '),
        route: { name: 'links' },
        badge: f.visible === false ? '已隐藏' : '',
      })),
  );

  // ——— 分享 / 语录 ———
  push(
    'share',
    '分享 · 语录',
    (shares.shares ?? [])
      .filter((s) => pick([s.title, s.text, s.author, s.url, s.note, ...(s.tags ?? [])], q) >= 0)
      .map((s) => ({
        title: s.type === 'quote' ? `「${s.text}」` : s.title || s.url,
        subtitle: [s.type === 'quote' ? s.author : s.url, (s.tags ?? []).map((t) => `#${t}`).join(' ')]
          .filter(Boolean)
          .join(' · '),
        route: { name: 'share' },
        badge: s.type === 'quote' ? '语录' : '收藏',
      })),
  );

  // ——— 音乐 ———
  push(
    'song',
    '音乐',
    (music.songs ?? [])
      .filter((s) => pick([s.title, s.artist, s.album, s.note], q) >= 0)
      .map((s) => ({
        title: s.title,
        subtitle: [s.artist, s.album, s.note].filter(Boolean).join(' · '),
        route: { name: 'music' },
      })),
  );

  // ——— 友链申请（走私有仓库；失败就跳过）———
  try {
    const { listApplications } = await import('./applications.js');
    const data = await listApplications();
    if (data.enabled) {
      push(
        'apply',
        '友链申请',
        data.items
          .filter((a) => pick([a.name, a.url, a.intro, a.email], q) >= 0)
          .map((a) => ({
            title: a.name,
            subtitle: [a.url, a.status === 'pending' ? '待审批' : a.status === 'approved' ? '已通过' : '已拒绝']
              .filter(Boolean)
              .join(' · '),
            route: { name: 'apply' },
            badge: a.status === 'pending' ? '待审批' : '',
          })),
      );
    }
  } catch {
    /* 私有仓库读不到就不参与搜索，不影响其它结果 */
  }

  // ——— 页面 / 动作 ———
  push(
    'page',
    '页面',
    PAGES.filter((p) => pick([p.title, p.subtitle, p.keys], q) >= 0).map((p) => ({
      title: p.title,
      subtitle: p.subtitle,
      route: p.route,
    })),
  );
  push(
    'action',
    '动作',
    ACTIONS.filter((a) => pick([a.title, a.subtitle, a.keys], q) >= 0).map((a) => ({
      title: a.title,
      subtitle: a.subtitle,
      route: a.route,
      download: a.download,
    })),
  );

  return { q: rawQuery, groups };
}
