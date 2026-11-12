/**
 * 表情包清单 —— 素材来自 https://github.com/walinejs/emojis（MIT）。
 *
 * 三套风格互补，面板里切 tab：
 *   · noto      Google Noto 动画表情（webp，42 个）—— 干净、通用
 *   · alus      阿鲁小人（png，60 个）—— 日系，和爱弥斯一个气质
 *   · bilibili  小电视（png，51 个）—— 国内一眼认得
 *
 * **token 就是文件名**：`:[文件名]`，例如 `:[bb_doge]`、`:[alus_happy]`、`:[rofl]`。
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
  {
    id: 'noto',
    label: '平滑',
    base: '/images/emoji/noto',
    ext: '.webp',
    items: [
      '100',
      'blush',
      'bug',
      'bulb',
      'clap',
      'cry',
      'dart',
      'exploding_head',
      'eyes',
      'fearful',
      'fire',
      'flushed',
      'handshake',
      'heart_eyes',
      'heart_hands',
      'joy',
      'kissing_heart',
      'melting_face',
      'muscle',
      'ok_hand',
      'partying_face',
      'pensive',
      'pleading_face',
      'pray',
      'rocket',
      'rofl',
      'saluting_face',
      'scream',
      'smiling_face_with_three_hearts',
      'sob',
      'sparkles',
      'sparkling_heart',
      'star_struck',
      'sunglasses',
      'sweat_smile',
      'tada',
      'thinking',
      'thumbsup',
      'warning',
      'white_check_mark',
      'x',
      'yum',
    ],
  },
  {
    id: 'alus',
    label: '阿鲁',
    base: '/images/emoji/alus',
    ext: '.png',
    items: [
      'alus_astonished',
      'alus_awkward',
      'alus_blush',
      'alus_bystand',
      'alus_candle',
      'alus_clap',
      'alus_cucumber',
      'alus_dark',
      'alus_die',
      'alus_embarrassed',
      'alus_expect',
      'alus_expressionless',
      'alus_flower',
      'alus_fu',
      'alus_grass',
      'alus_greddy',
      'alus_grin',
      'alus_gunshot',
      'alus_happy',
      'alus_helpless',
      'alus_hide',
      'alus_high_five',
      'alus_hocho',
      'alus_huge_sweat',
      'alus_injured',
      'alus_kiss',
      'alus_knockdown',
      'alus_observe',
      'alus_observe_dark',
      'alus_persevere',
      'alus_pick_nose',
      'alus_ponder',
      'alus_rage',
      'alus_rich',
      'alus_satisfied',
      'alus_shit',
      'alus_shy',
      'alus_silent',
      'alus_slap',
      'alus_small_eye',
      'alus_smirk',
      'alus_smoke',
      'alus_sob',
      'alus_stare',
      'alus_sunglasses',
      'alus_surrender',
      'alus_sweat',
      'alus_sweat_smile',
      'alus_think',
      'alus_thumbsup',
      'alus_unamused',
      'alus_unhappy',
      'alus_vomit',
      'alus_vomit_blood',
      'alus_vomit_water',
      'alus_wait',
      'alus_whatever',
      'alus_wise',
      'alus_wound',
      'alus_yum',
    ],
  },
  {
    id: 'bilibili',
    label: '小电视',
    base: '/images/emoji/bilibili',
    ext: '.png',
    items: [
      'bb_annoyed',
      'bb_antic',
      'bb_awkward',
      'bb_bye',
      'bb_chuckle',
      'bb_clap',
      'bb_confused',
      'bb_crazy',
      'bb_cry',
      'bb_cute',
      'bb_dizzy_face',
      'bb_doge',
      'bb_face_cry',
      'bb_flushed',
      'bb_greddy',
      'bb_grievance',
      'bb_heart_eyes',
      'bb_kiss',
      'bb_look_down',
      'bb_lovely',
      'bb_mask',
      'bb_miantian',
      'bb_money',
      'bb_no_mouth',
      'bb_nosebleed',
      'bb_not_care',
      'bb_pick_nose',
      'bb_question_mask',
      'bb_rage',
      'bb_rolling_eyes',
      'bb_sad',
      'bb_scared',
      'bb_shy',
      'bb_slap',
      'bb_sleep',
      'bb_sleepy',
      'bb_slient',
      'bb_smirk',
      'bb_sob',
      'bb_spit_blodd',
      'bb_sunglasses',
      'bb_sweat',
      'bb_test',
      'bb_think',
      'bb_thumbsup',
      'bb_tiaokan',
      'bb_trollface',
      'bb_vomit',
      'bb_yum',
      'bb_yum1',
      'bb_zhoumei',
    ],
  },
];

/** key → 图片地址 + 所属包。渲染器只认这张表，表外的一律当普通文字 */
export const EMOJI_MAP: Record<string, { src: string; pack: string }> = (() => {
  const map: Record<string, { src: string; pack: string }> = {};
  for (const p of EMOJI_PACKS) {
    for (const it of p.items) map[it] = { src: `${p.base}/${it}${p.ext}`, pack: p.id };
  }
  return map;
})();

/** token 形状：:[key] —— 只允许小写字母、数字、下划线（链接里的 :// 不会误伤） */
export const EMOJI_TOKEN = /:\[([a-z0-9_]{1,32})\]/g;
