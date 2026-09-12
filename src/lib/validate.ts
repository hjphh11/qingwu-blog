// JSON 数据的校验工具。
//
// 内容数据从 TS 源码改成 JSON 之后,弱类型的 JSON 就需要一道校验 ——
// 否则后台写错一个字段,前台会以很奇怪的方式坏掉(而不是构建时就明确报错)。
import { z } from 'astro/zod';

/** 站内路径(/images/…)与 http(s) 链接都算合法 */
export const urlLike = z
  .string()
  .min(1, '不能为空')
  .regex(/^(https?:\/\/|\/)/, '需要是 http(s) 链接，或以 / 开头的站内路径');

/** 校验并返回；失败时抛出**带文件名与字段路径**的错误，方便一眼定位 */
export function parseJson<T extends z.ZodType>(
  schema: T,
  raw: unknown,
  file: string,
): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `  · ${i.path.length ? i.path.join('.') : '(根)'}：${i.message}`)
      .join('\n');
    throw new Error(`${file} 内容不符合预期，请修正后再构建：\n${issues}`);
  }
  return r.data;
}
