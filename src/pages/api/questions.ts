import type { APIRoute } from 'astro';

// 题库代理:博客源码/HTML 里不含任何题目。
// 访客打开刷题页时,由这个服务端函数带着 token 去「私有仓库」取题库再返回。
// 需要配置的环境变量(Vercel → Settings → Environment Variables):
//   BANK_TOKEN  必填,细粒度 PAT,仅授予该私有仓库的 Contents: Read
//   BANK_REPO   选填,默认 hjphh11/python-exam-quiz-bank
//   BANK_PATH   选填,默认 questions.json
//   BANK_REF    选填,默认 master
/**
 * ⚠️ 构建期生成，**不是运行时函数**。
 *
 * 原来这里是 `prerender = false`：每打开一次刷题页就跑一次 Serverless，
 * 带 token 去 GitHub 拉 677KB 题库再转发。虽然加了 CDN 缓存，
 * 但 Vercel 的 Fluid Active CPU 是按函数实际占用 CPU 计费的（免费版 4 小时/月），
 * 这类「只为转发一个文件」的函数最不该占那份额度。
 *
 * 改成 true 之后：部署时取一次，产物是静态 JSON，访客/CDN 直接拿文件，
 * 函数调用次数归零。代价是题库更新要重新部署一次 —— 题库本来就不常变，划得来。
 *
 * 构建环境（Vercel）需要 BANK_TOKEN；本地没有该变量时这里会返回一段说明，
 * 本地刷题页会显示为空，属预期行为。
 */
export const prerender = true;

// 本地开发读 .env(Vite 注入 import.meta.env);线上读 Vercel 环境变量(process.env)。
const env = (key: string): string =>
  (import.meta.env[key] as string | undefined) || process.env[key] || '';

const REPO = env('BANK_REPO') || 'hjphh11/python-exam-quiz-bank';
const PATH = env('BANK_PATH') || 'questions.json';
const REF = env('BANK_REF') || 'master';
const TOKEN = env('BANK_TOKEN');

const json = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });

export const GET: APIRoute = async () => {
  if (!TOKEN) {
    return json(JSON.stringify({ error: 'BANK_TOKEN 未配置' }), 500);
  }

  const url = `https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${encodeURIComponent(REF)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/vnd.github.raw',
        'user-agent': 'qingwu-blog',
        'x-github-api-version': '2022-11-28',
      },
    });
  } catch (err) {
    return json(JSON.stringify({ error: '取题库请求失败' }), 502);
  }

  if (!res.ok) {
    return json(JSON.stringify({ error: `GitHub 返回 ${res.status}` }), 502);
  }

  const body = await res.text();
  // 静态文件由 CDN 直接给，这里只需要一个合理的协商缓存
  return json(body, 200, {
    'cache-control': 'public, max-age=300',
    'x-robots-tag': 'noindex, nofollow',
  });
};
