import fs from 'node:fs';

/**
 * 从 public/images/emoji/<包>/ 里的图片生成 src/lib/emojis.ts 的清单。
 *
 *   node scripts/gen-emojis.mjs
 *
 * 加一套表情：把图丢进 public/images/emoji/<id>/，在下面 PACKS 里加一行，跑这个脚本。
 * 素材来自 https://github.com/walinejs/emojis（MIT），文件名保持不变 ——
 * token 就是文件名（`:[bb_doge]`），改名会让历史留言里的表情全部失效。
 */
const PACKS = [
  { id: 'noto', label: '平滑', ext: '.webp' },
  { id: 'alus', label: '阿鲁', ext: '.png' },
  { id: 'bilibili', label: '小电视', ext: '.png' },
];

const out = PACKS.map((p) => {
  const dir = `public/images/emoji/${p.id}`;
  const items = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(p.ext))
    .sort()
    .map((f) => f.slice(0, -p.ext.length));
  return { id: p.id, label: p.label, base: `/images/emoji/${p.id}`, ext: p.ext, items };
});

const body = out
  .map(
    (p) =>
      `  {\n    id: '${p.id}',\n    label: '${p.label}',\n    base: '${p.base}',\n    ext: '${p.ext}',\n    items: [\n${p.items
        .map((i) => `      '${i}',`)
        .join('\n')}\n    ],\n  },`,
  )
  .join('\n');

const file = `/**
 * 表情包清单 —— 素材来自 https://github.com/walinejs/emojis（MIT）。
 *
 * 三套风格互补，面板里切 tab：
 *   · noto      Google Noto 动画表情（webp，42 个）—— 干净、通用
 *   · alus      阿鲁小人（png，60 个）—— 日系，和爱弥斯一个气质
 *   · bilibili  小电视（png，51 个）—— 国内一眼认得
 *
 * **token 就是文件名**：\`:[文件名]\`，例如 \`:[bb_doge]\`、\`:[alus_happy]\`、\`:[rofl]\`。
 * 文件名天然唯一（bb_ / alus_ 前缀），所以不用另做命名空间。
 * 图放在 public，不走外链 —— 表情是留言的一部分，不能因为第三方 CDN 挂掉就开天窗。
 *
 * ⚠️ 这个文件由 scripts/gen-emojis.mjs 生成，别手改。
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
