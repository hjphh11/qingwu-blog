/**
 * 邮箱头像 —— 和 Waline 用的是同一套思路：
 *   邮箱 → MD5 → Gravatar/Cravatar 头像
 *   QQ 邮箱（`123456@qq.com`）不走 MD5，直接用 QQ 号取 QQ 头像，国内更快也更像本人。
 *
 * 为什么必须自己实现 MD5：Web Crypto **不支持 MD5**（只有 SHA-1/256/384/512），
 * 而 Gravatar 的协议写死了要 MD5。这段是标准 RFC 1321 实现，只处理 UTF-8 字节。
 *
 * ⚠️ 隐私说明（也是 Waline 一直以来的口径）：邮箱本身不上公开列表，
 *    但「邮箱的 MD5」会随评论返回 —— 这是 Gravatar 机制决定的，
 *    别人能拿它去查这个哈希对应的头像，却推不回邮箱原文。
 */

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

const QQ_MAIL = /^(\d{5,11})@qq\.com$/i;

/**
 * 由邮箱算出头像地址。
 *
 * · QQ 邮箱 → QQ 头像（`q.qlogo.cn/headimg_dl`，国内直连）
 *   ⚠️ 别用老接口 `q1.qlogo.cn/g?b=sdk&nk=…` —— 实测现在直接 400（text/plain），
 *   headimg_dl 这个才 200 且能拿图。
 * · 其他邮箱 → Cravatar（Gravatar 的国内镜像；gravatar.com 在国内直连是 000，
 *   而 cravatar.cn 实测 200 / image/webp）。`d=mp` 是没设过头像时的默认剪影，不会 404。
 *
 * 传空串返回空串，调用方据此回落到名字首字。
 */
export function avatarFromEmail(email: string, size = 96): string {
  const e = (email || '').trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return '';
  const qq = e.match(QQ_MAIL);
  if (qq) return `https://q.qlogo.cn/headimg_dl?dst_uin=${qq[1]}&spec=${size}`;
  return `https://cravatar.cn/avatar/${md5(e)}?d=mp&s=${size}`;
}

/**
 * 只有哈希时拼 Cravatar —— 列表的兜底用。
 *
 * 为什么需要它：QQ 头像接口（q.qlogo.cn）在本机 headless Chrome 里实测返回 400，
 * curl 却是 200，说明是出口网络/风控层面的问题，真实访客未必能加载。
 * 所以 img 挂 onError：qlogo 挂了就换 Cravatar，都挂才回落到名字首字。
 */
export function avatarFromHash(hash: string, size = 96): string {
  const h = (hash || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(h)) return '';
  return `https://cravatar.cn/avatar/${h}?d=mp&s=${size}`;
}

/** 邮箱 → 32 位哈希（存库用，列表靠它兜底 Cravatar） */
export function emailHash(email: string): string {
  const e = (email || '').trim().toLowerCase();
  return e ? md5(e) : '';
}
