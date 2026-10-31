// 拆分等价性校验：原文件 vs 7 个拆分文件，规范化后逐字符比较。
const fs = require('fs');

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');

/** 把 @layercomponents{...} 解包成内部内容（只处理一层） */
function unwrapLayer(css) {
  const tag = '@layercomponents{';
  let out = '';
  let i = 0;
  while (i < css.length) {
    const k = css.indexOf(tag, i);
    if (k === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, k);
    i = k + tag.length;
    let depth = 1;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    out += css.slice(start, i); // 不含最外层闭合
    i++;
  }
  return out;
}

const origRaw = fs.readFileSync('src/styles/_orig.css', 'utf8').replace(
  /^\s*@import\s*"tailwindcss"\s*;?/,
  ''
);

const order = ['tokens', 'base', 'layout', 'ui', 'prose', 'effects', 'motion'];
const parts = order.map((f) => fs.readFileSync(`src/styles/${f}.css`, 'utf8'));

const A = strip(unwrapLayer(strip(origRaw)));
const B = strip(unwrapLayer(strip(parts.join('\n'))));

console.log('原文规则序列长度:', A.length);
console.log('拆分拼接后长度  :', B.length);
console.log('差值            :', B.length - A.length);

if (A === B) {
  console.log('\n✅ 两者完全一致 —— 拆分无损，规则顺序与内容都保住了');
  process.exit(0);
}

let p = 0;
while (p < Math.min(A.length, B.length) && A[p] === B[p]) p++;
console.log('\n❌ 首个差异位置:', p);
console.log('  原文:', JSON.stringify(A.slice(Math.max(0, p - 40), p + 120)));
console.log('  拆分:', JSON.stringify(B.slice(Math.max(0, p - 40), p + 120)));
process.exit(1);
