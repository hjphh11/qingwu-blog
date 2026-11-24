/**
 * 清吾 · 代码块高亮主题（暖棕）
 *
 * 为什么自己写一份：默认的 `github-dark` 底色是 #0d1117（偏冷的蓝黑），
 * 压在奶油纸张上像贴了一块别的站的东西 —— 深色本身没问题，问题在色相。
 * 这里把底色换成深暖棕（#241c18），语法色全部落在玫瑰 / 琥珀 / 陶土这一族，
 * 与全站的 rose / amber / brown token 同源，深色块才像「这本书里的插图」。
 *
 * 口径：
 *   · 底色只比正文的深棕 ink(#4a3728) 暗两档，不追纯黑 —— 纯黑与暖色系反差过大
 *   · 关键字用绯红系的浅色（不是纯正红），字符串用陶土黄，数字用琥珀
 *   · 注释压到 40% 亮度并加斜体：可读但不跟代码抢注意力
 *
 * 只放颜色，不写规则；.prose pre 的边框 / 圆角在 prose.css 里（两处底色要对齐）。
 * 改这里之后 Astro 会重新生成每篇文章的高亮 —— 需要重新 build，dev 下会自动热更新。
 */
export default {
  name: 'qingwu-warm',
  type: 'dark',
  colors: {
    'editor.background': '#241c18',
    'editor.foreground': '#ecdccb',
  },
  tokenColors: [
    {
      // 全局兜底：没被任何 scope 命中的 token 用正文色
      settings: {
        background: '#241c18',
        foreground: '#ecdccb',
      },
    },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: { foreground: '#8a7666', fontStyle: 'italic' },
    },
    {
      scope: [
        'keyword',
        'keyword.control',
        'keyword.operator.new',
        'storage',
        'storage.type',
        'storage.modifier',
        'punctuation.definition.keyword',
      ],
      settings: { foreground: '#e58f9f' },
    },
    {
      scope: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string'],
      settings: { foreground: '#d9a06f' },
    },
    {
      scope: ['constant.numeric', 'constant.language', 'constant.character', 'support.constant'],
      settings: { foreground: '#e8b04b' },
    },
    {
      scope: ['constant.character.escape', 'constant.other.symbol'],
      settings: { foreground: '#f0c9a0' },
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'],
      settings: { foreground: '#f2cba8' },
    },
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class'],
      settings: { foreground: '#e0b585' },
    },
    {
      scope: ['variable', 'variable.other', 'variable.parameter', 'meta.definition.variable'],
      settings: { foreground: '#e6d3c1' },
    },
    {
      scope: ['variable.other.property', 'support.variable.property', 'meta.object-literal.key'],
      settings: { foreground: '#dcb9a3' },
    },
    {
      scope: ['entity.name.tag', 'punctuation.definition.tag'],
      settings: { foreground: '#e58f9f' },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: { foreground: '#e8b04b' },
    },
    {
      scope: ['entity.name.section', 'markup.heading', 'punctuation.definition.heading'],
      settings: { foreground: '#f0b9a0', fontStyle: 'bold' },
    },
    {
      scope: ['markup.bold'],
      settings: { foreground: '#f0cba8', fontStyle: 'bold' },
    },
    {
      scope: ['markup.italic'],
      settings: { foreground: '#e9c3b5', fontStyle: 'italic' },
    },
    {
      scope: ['markup.inline.raw', 'markup.fenced_code', 'markup.raw'],
      settings: { foreground: '#d9a06f' },
    },
    {
      scope: ['markup.inserted', 'punctuation.definition.inserted'],
      settings: { foreground: '#b9c79a' },
    },
    {
      scope: ['markup.deleted', 'punctuation.definition.deleted'],
      settings: { foreground: '#d98a8a' },
    },
    {
      scope: ['markup.underline.link', 'string.other.link'],
      settings: { foreground: '#e2a3b0' },
    },
    {
      scope: ['punctuation', 'meta.brace', 'punctuation.separator', 'punctuation.terminator'],
      settings: { foreground: '#a08d7e' },
    },
    {
      scope: ['invalid', 'invalid.illegal'],
      settings: { foreground: '#ffd7d7', background: '#7a2e35' },
    },
  ],
};
