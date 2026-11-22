// 清吾 · 友链评论区（留言 / 回复 / 点赞 / 邮件通知）
//
// 路由：
//   GET  /friends-board                  公开列表（含回复与点赞数，**不含邮箱**）
//   POST /friends-board                  留言（可带站点地址、头像、邮箱）
//   POST /friends-board/:id/reply        回复某条（自动 @ 对方，并邮件通知他）
//   POST /friends-board/:id/like         点赞（同一访客只算一次）
//   DELETE /friends-board/:id            留言人删自己的（账号或本机删除凭证）
//
// ⚠️ 2026-11-22 起**实现整体搬到 `comments.ts`**：文章评论（`/blog/<slug>`）要的
//    回复、点赞、删除、审核、限流跟这里一模一样，两份代码迟早跑偏。
//    本文件只剩一层薄包装，把 `post_slug='friends'` 钉死，别的什么都不做。
//    友链独有的两件事（识别「这是一条友链申请」、小爱自动回一句）也留在核心，
//    由 `kind === 'friends'` 决定，见 comments.ts。
//
// 落库复用 0001 的 `comments` 表（post_slug='friends'，楼中楼用 parent_id），
// 0007 给它补了 email / author_url / avatar 三列，点赞另开 `friend_likes`。

import type { Env } from './types';
import { FRIENDS_SLUG, deleteComment, getBoard, postComment, postLike, postReply } from './comments';

/** 留言板的所有操作只认这一个分区 */
const matchFriends = (slug: string) => slug === FRIENDS_SLUG;

const FRIENDS_CFG = {
  slug: FRIENDS_SLUG,
  /** 审核提示词里的页面标识（原来就写的 /friends/） */
  path: '/friends/',
  kind: 'friends' as const,
};

export function getFriendsBoard(request: Request, env: Env): Promise<Response> {
  return getBoard(request, env, FRIENDS_SLUG);
}

export function postFriendsBoard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return postComment(request, env, ctx, FRIENDS_CFG);
}

export function postFriendReply(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  idParam: string,
): Promise<Response> {
  return postReply(request, env, ctx, idParam, matchFriends);
}

export function postFriendLike(request: Request, env: Env, idParam: string): Promise<Response> {
  return postLike(request, env, idParam, matchFriends);
}

export function deleteFriendComment(request: Request, env: Env, idParam: string): Promise<Response> {
  // 删除按账号 / 删除凭证判，不按分区判 —— /auth/my-comments 里文章评论也要能删
  return deleteComment(request, env, idParam);
}
