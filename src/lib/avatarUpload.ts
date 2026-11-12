/**
 * 头像上传：把用户选的图压成一张小方图。
 *
 * 为什么在浏览器里压：
 *   手机相册随手一张就是 3–8MB、4000px 宽。直接传上去，服务端要解码、
 *   存进 D1（一行一条记录），既慢又占地方；而头像最大也就显示 96px。
 *   客户端先裁成 192×192，十 KB 上下，传得快、存得省。
 *
 * 服务端仍会再校验一遍格式与体积（`worker/src/auth/avatar-store.ts`）——
 * 前端压缩是可以被绕过的，这道不能省。
 */

/** 输出边长。显示最大 96px，192 在 2× 屏上依然清晰，再大就是浪费 */
const SIZE = 192;

/** 原图上限。超过这个基本是没裁剪的相机原片，先劝一句比等它慢慢解码好 */
const MAX_INPUT = 12 * 1024 * 1024;

export type ShrinkResult = { ok: true; dataUrl: string } | { ok: false; message: string };

export async function fileToAvatar(file: File): Promise<ShrinkResult> {
  if (!file.type.startsWith('image/')) return { ok: false, message: '选一张图片吧（jpg / png / webp）' };
  // SVG 不接：它能在某些场景里带脚本，而且放大缩小的「清晰」对头像没意义
  if (file.type === 'image/svg+xml') return { ok: false, message: '不支持 SVG，换张 jpg 或 png' };
  if (file.size > MAX_INPUT) return { ok: false, message: '这张图有点大，先裁剪或压缩一下再传' };

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadImage(file);
  } catch {
    return { ok: false, message: '这张图读不出来，换一张试试' };
  }

  const w = 'width' in bitmap ? bitmap.width : 0;
  const h = 'height' in bitmap ? bitmap.height : 0;
  if (!w || !h) return { ok: false, message: '这张图读不出来，换一张试试' };

  // 居中裁成正方形：头像都是圆的，先裁好再缩，比整张压扁好看
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, message: '这个浏览器画不了图，换一个试试' };

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);
  if ('close' in bitmap) bitmap.close();

  // webp 体积最小；老浏览器不支持会自己回落到 png（toDataURL 的行为）
  let dataUrl = canvas.toDataURL('image/webp', 0.86);
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/png');

  return { ok: true, dataUrl };
}

function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // 首选 createImageBitmap：不占主线程解码，也不会因为 EXIF 方向把图转歪
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadViaTag(file));
  }
  return loadViaTag(file);
}

function loadViaTag(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}
