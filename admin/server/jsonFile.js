// 后台写 JSON 数据文件的公共工具。
//
// 约定（整个后台统一）：
//   · 一律 **LF 换行、不带 BOM**（仓库里有的是 CRLF，写回去会让整文件 diff 变形）
//   · **原子写**：先写临时文件再 rename，中途失败不会留下半个坏文件
//   · 格式统一 `JSON.stringify(data, null, 2)` —— 和 links.json / share.json 现有风格一致
import fs from 'node:fs/promises';

export async function readJsonFile(file) {
  const text = await fs.readFile(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    const e = new Error(`${file} 不是合法 JSON：${err.message}`);
    e.status = 400;
    e.code = 'bad_json';
    e.expose = true;
    throw e;
  }
}

export async function writeJsonFile(file, data) {
  // 换行沿用目标文件现有的（仓库在 Windows 上被检出成 CRLF、Linux 上是 LF；
  // 一律写 LF 的话，Windows 上每保存一次都会显示成"已修改"，内容其实没变）
  let eol = '\n';
  try {
    const old = await fs.readFile(file, 'utf8');
    if (old.includes('\r\n')) eol = '\r\n';
  } catch {
    /* 新文件用 LF */
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const text = `${JSON.stringify(data, null, 2)}\n`.replace(/\r?\n/g, eol);
  await fs.writeFile(tmp, text, { encoding: 'utf8' });
  await fs.rename(tmp, file);
}

/** 统一的 400 / 404 / 409 */
export function httpError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  e.code = code ?? (status === 400 ? 'bad_request' : status === 404 ? 'not_found' : 'conflict');
  e.expose = true;
  return e;
}

export const badRequest = (m, c) => httpError(400, m, c);
export const notFound = (m = '找不到这条内容') => httpError(404, m);
export const conflict = (m) => httpError(409, m);
