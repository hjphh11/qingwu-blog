import fs from 'node:fs';

/**
 * 从 public/images/emoji/<包>/ 里的图片生成 src/lib/emojis.ts 的清单。
 *
 *   node scripts/gen-emojis.mjs
 *
 * 加一套表情：把图丢进 public/images/emoji/<id>/，在下面 PACKS 里加一行，跑这个脚本，
 * **再同步 `worker/src/chat/bridge.ts` 的 EMOJI_PACKS**（出站到 Matrix 时按目录/扩展名取图）。
 *
 * 素材来自 https://github.com/walinejs/emojis（仓库 MIT，但各套贴纸的图像版权归原平台），
 * 文件名保持不变 —— token 就是文件名（`:[bb_doge]`），改名会让历史留言里的表情全部失效。
 * 新加包时若原文件名带连字符/撇号/大写，**先改成 `[a-z0-9_]`**：token 正则只认这个字符集。
 */
const PACKS = [
  { id: 'noto', label: '平滑', ext: '.webp' },
  { id: 'alus', label: '阿鲁', ext: '.png' },
  { id: 'bilibili', label: '小电视', ext: '.png' },
  { id: 'qq', label: 'QQ', ext: '.gif' },
  { id: 'tieba', label: '贴吧', ext: '.png' },
  { id: 'coolapk', label: '酷安', ext: '.png' },
  { id: 'hi3', label: '崩坏3', ext: '.webp' },
  { id: 'douyin', label: '抖音', ext: '.png' },
];

const out = PACKS.map((p) => {
  const dir = `public/images/emoji/${p.id}`;
  const items = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(p.ext))
    .sort()
    .map((f) => f.slice(0, -p.ext.length));
  return { ...p, items };
});

/** 文档注释里的那一列：包名、张数、格式 —— 别手写数字，会跟实际脱节 */
const legend = out
  .map((p) => ` *   · ${p.id.padEnd(9)}${p.label}（${p.ext.slice(1)}，${p.items.length} 个）`)
  .join('\n');

const ZERO = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
const countCn = ZERO[out.length] ?? String(out.length);

const body = out
  .map(
    (p) =>
      `  {\n    id: '${p.id}',\n    label: '${p.label}',\n    base: '/images/emoji/${p.id}',\n    ext: '${p.ext}',\n    items: [\n${p.items
        .map((i) => `      '${i}',`)
        .join('\n')}\n    ],\n  },`,
  )
  .join('\n');

const file = `/**
 * 表情包清单 —— 素材来自 https://github.com/walinejs/emojis（仓库 MIT，贴纸版权归各平台）。
 *
 * ${countCn}套风格互补，面板里切 tab：
${legend}
 *
 * **token 就是文件名**：\`:[文件名]\`，例如 \`:[bb_doge]\`、\`:[qq_1]\`、\`:[rofl]\`。
 * 文件名天然唯一（都有包前缀，noto 那套是裸名），所以不用另做命名空间。
 * 图放在 public，不走外链 —— 表情是留言的一部分，不能因为第三方 CDN 挂掉就开天窗。
 *
 * ⚠️ 这个文件由 scripts/gen-emojis.mjs 生成，别手改。
 * ⚠️ 加包时别忘了同步 \`worker/src/chat/bridge.ts\` 的 \`EMOJI_PACKS\`：那边少一行，
 *    出站到 Matrix 就取不到图（站内显示正常，只有发到大厅才坏）。
 */

export interface EmojiPack {
  id: string;
  label: string;
  base: string;
  ext: string;
  /** 文件名（不含扩展名），同时就是 token 里的 key */
  items: string[];
}

export const EMOJI_PACKS: EmojiPack[] = [
${body}
];

/** key → 图片地址 + 所属包。渲染器只认这张表，表外的一律当普通文字 */
export const EMOJI_MAP: Record<string, { src: string; pack: string }> = (() => {
  const map: Record<string, { src: string; pack: string }> = {};
  for (const p of EMOJI_PACKS) {
    for (const it of p.items) map[it] = { src: \`\${p.base}/\${it}\${p.ext}\`, pack: p.id };
  }
  return map;
})();

/** token 形状：:[key] —— 只允许小写字母、数字、下划线（链接里的 :// 不会误伤） */
export const EMOJI_TOKEN = /:\\[([a-z0-9_]{1,32})\\]/g;
`;

fs.writeFileSync('src/lib/emojis.ts', file);
console.log('packs:', out.map((p) => `${p.id}=${p.items.length}`).join(' '));
