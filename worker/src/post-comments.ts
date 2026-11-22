// 清吾 · 文章评论
//
// 路由：
//   GET    /post-comments?path=/blog/<slug>       公开列表（含回复与点赞数）
//   POST   /post-comments                         发一条（body.path 指定文章）
//   POST   /post-comments/:id/reply               回复某条
//   POST   /post-comments/:id/like                点赞（同一访客只算一次）
//   DELETE /post-comments/:id                     删自己的那条
//
// 数据落在 `comments` 表，`post_slug = '/blog/<slug>'` —— 和「友链评论区」共表不同区，
// 所以一篇文章的评论不会和留言板串在一起。实现全在 `comments.ts`，这里只做
// 「解出 slug / 校验 slug / 钉死分区」这三件事。
//
// ⚠️ 登录、限流、审核、头像兜底、删除授权都与留言板同一套（同一个 REQUIRE_LOGIN、
//    同一个 /auth/* 会话、同一张 friend_likes）。这就是「登录对齐」的全部含义 ——
//    没有第二套账号体系，也不需要。
// ⚠️ 文章评论**不触发**小爱自动回复，也不做友链申请识别（见 comments.ts 的 kind 分叉）。

import type { Env } from './types';
import { json } from './util';
import { POST_PREFIX, deleteComment, getBoard, isPostSlug, postComment, postLike, postReply } from './comments';

/**
 * 把访客给的路径收敛成 `/blog/<slug>`。
 *
 * 只认字母数字和 `-_.`（本站的 slug 就是这么生成的，见 src/content/blog），
 * 去掉结尾斜杠；`/blog/` 这种空 slug 直接拒。
 */
function normalizePath(raw: unknown): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  const trimmed = t.replace(/\/+$/, '');
  return isPostSlug(trimmed) ? trimmed : '';
}

export function getPostComments(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const slug = normalizePath(url.searchParams.get('path'));
  if (!slug) {
    return Promise.resolve(json({ ok: false, error: 'bad_request', message: '文章路径不对' }, 400));
  }
  return getBoard(request, env, slug);
}

export async function postPostComment(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  /**
   * 先偷看一眼 body 里的 `path` —— 核心要按分区建行，slug 必须在进核心之前定下来。
   *
   * 用 `clone()` 读：原请求的 body 流不能被消耗掉，核心自己还要再读一遍。
   * 多解析一次 JSON 的代价可以忽略，换来的是「核心完全不知道文章路径从哪来」。
   */
  let slug = '';
  try {
    const peek = (await request.clone().json()) as { path?: unknown };
    slug = normalizePath(peek?.path);
  } catch {
    return json({ ok: false, error: 'bad_request', message: '请求格式不对' }, 400);
  }
  if (!slug) return json({ ok: false, error: 'bad_request', message: '文章路径不对' }, 400);

  return postComment(request, env, ctx, { slug, path: slug, kind: 'post' });
}

const matchPost = (slug: string) => isPostSlug(slug);

export function postPostReply(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  idParam: string,
): Promise<Response> {
  return postReply(request, env, ctx, idParam, matchPost);
}

export function postPostLike(request: Request, env: Env, idParam: string): Promise<Response> {
  return postLike(request, env, idParam, matchPost);
}

export function deletePostComment(request: Request, env: Env, idParam: string): Promise<Response> {
  return deleteComment(request, env, idParam, matchPost);
}

/** 供路由层判断「这个路径是不是文章评论分区」 */
export { isPostSlug, POST_PREFIX };
