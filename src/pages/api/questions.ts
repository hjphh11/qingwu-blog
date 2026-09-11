import type { APIRoute } from 'astro';

// 题库代理:博客源码/HTML 里不含任何题目。
// 访客打开刷题页时,由这个服务端函数带着 token 去「私有仓库」取题库再返回。
// 需要配置的环境变量(Vercel → Settings → Environment Variables):
//   BANK_TOKEN  必填,细粒度 PAT,仅授予该私有仓库的 Contents: Read
//   BANK_REPO   选填,默认 hjphh11/python-exam-quiz-bank
//   BANK_PATH   选填,默认 questions.json
//   BANK_REF    选填,默认 master
export const prerender = false;

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
  return json(body, 200, {
    // 交给 Vercel 边缘缓存,减少对 GitHub API 的调用
    'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    'x-robots-tag': 'noindex, nofollow',
  });
};
