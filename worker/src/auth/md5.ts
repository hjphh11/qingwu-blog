// MD5 —— 只为算 Gravatar 头像与邮箱指纹
//
// Web Crypto **不支持 MD5**（只有 SHA-1/256/384/512），而 Gravatar 协议写死了要 MD5。
// 这段与 `src/lib/avatar.ts` 的实现逐行同构：**两边算出来的必须是同一个值**，
// 否则前台头像和库里 `email_hash` 会对不上（迁移脚本也因此能用 Node 的 crypto 直接核验）。
//
// 输入先做 `trim().toLowerCase()` 归一 —— 调用方负责，或直接用 `emailHashOf()`。

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
  21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** K[i] = floor(abs(sin(i+1)) * 2^32) —— RFC 里的常量表，算一次就够 */
const K = (() => {
  const k = new Int32Array(64);
  for (let i = 0; i < 64; i += 1) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  return k;
})();

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

/** 算 32 位小写十六进制 MD5 */
export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;

  // 补 0x80 + 补零到 56 (mod 64) + 8 字节长度
  const total = (((bytes.length + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;

  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, bitLen >>> 0, true);
  view.setUint32(total - 4, Math.floor(bitLen / 4294967296) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;

  for (let off = 0; off < total; off += 64) {
    const m = new Int32Array(16);
    for (let i = 0; i < 16; i += 1) m[i] = view.getInt32(off + i * 4, true);

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i]! + m[g]!) | 0;
      b = (b + rotl(sum, S[i]!)) | 0;
      a = tmp;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const hex = (n: number) => {
    let out = '';
    for (let i = 0; i < 4; i += 1) out += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    return out;
  };
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

/** 邮箱 → 指纹。**归一化顺序必须与 avatar.ts 一致**（trim → lowercase） */
export function emailHashOf(email: string): string {
  const e = (email || '').trim().toLowerCase();
  return e ? md5(e) : '';
}
