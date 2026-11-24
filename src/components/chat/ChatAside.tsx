import { useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { MessageCircle, Sparkles, UserRound } from '../../lib/icons';
import { avatarFromHash } from '../../lib/avatar';
import type { SessionAccount } from '../../lib/auth';
import type { ChatMember } from '../../lib/chat';

/**
 * 长亭 · 左侧栏
 *
 * 三块：我 / 在线的人 / 长亭的话。
 *
 * 2026-11-24 按站长的意见瘦过一次：
 *   · 整套「称号 · 经验条 · 累计发言 · 再聊 N 句」删掉了 ——
 *     那是副本面板的语言，长亭是歇脚的地方，进来坐坐不需要「你还差 11 句」。
 *     剩下头像和昵称，直接从会话里拿，服务端不再算一遍。
 *   · 「回到最新」挪进了聊天框（那本来就是聊天区的操作，放在侧栏要跨半屏点）
 *
 * 数据 30 秒刷一次（见 ChatRoom 的 whoTimer），不跟 2.5 秒的 poll 走。
 */

/** 在线列表默认露几个，超出折叠。6 个大约 15rem，和 .q-aside-list 的 max-height 对齐 */
const VISIBLE_MEMBERS = 6;

/**
 * 公告文案。**改这里就能改公告** —— 不落库是有意的：
 * 公告是站长的口吻，属于内容，归仓库；状态（谁在线）才归数据库。
 */
const NOTICE = [
  '欢迎来长亭。这里是清吾的一角，路过就坐坐，不必客气。',
  '说话留点余地；被冒犯了也可以直说，不用忍着。',
  '两分钟内的消息可以撤回；一分钟十五句是上限，再快会被请去喝口茶。',
  '发言会过一遍 AI 审核，违规的内容会被收走。',
];

function hostOf(url: string): string {
  return (url || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]!
    .toLowerCase();
}

export default function ChatAside({
  account,
  members,
  online,
  onLogin,
}: {
  account: SessionAccount | null;
  members: ChatMember[];
  online: number;
  onLogin: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? members : members.slice(0, VISIBLE_MEMBERS);
  const rest = members.length - shown.length;

  const site = hostOf(account?.site || '');

  /**
   * 侧栏头像统一走 `avatarFromHash`（cravatar）。
   *
   * 为什么不用 `account.avatar`：那是 `avatar_url || avatarFromEmail(email)`，
   * 而 QQ 邮箱会走 `q.qlogo.cn` —— 和在线列表里用的 cravatar 是两个域名。
   * 实测后果就是「同一个账号，我的卡是空白首字、在线列表有头像」。
   * cravatar 对 QQ 邮箱同样会回 QQ 头像，所以统一到它这里信息一点不少。
   */
  const meAvatar = account
    ? account.emailHash
      ? avatarFromHash(account.emailHash)
      : account.avatar
    : '';


  return (
    <aside className="q-aside" aria-label="长亭侧栏">
      {/* ——— ① 我 ——— */}
      {account ? (
        <section className="q-aside-card q-aside-me">
          <div className="q-aside-me__top">
            <span
              className="q-aside-me__avatar"
              style={meAvatar ? { backgroundImage: `url("${meAvatar}")` } : undefined}
              aria-hidden="true"
            >
              {account.name.slice(0, 1)}
            </span>
            <div className="q-aside-me__id">
              <p className="q-aside-me__name">
                {account.name}
                {account.role === 'admin' && <span className="q-aside-me__tag">站长</span>}
              </p>
              {site && <p className="q-aside-me__site">来自 {site}</p>}
            </div>
            <a href="/account/" className="q-aside-me__link" aria-label="个人主页">
              <MorphIcon icon={UserRound} size={14} color="currentColor" />
            </a>
          </div>
        </section>
      ) : (
        <section className="q-aside-card q-aside-guest">
          <p className="q-aside-guest__t">还没进门</p>
          <p className="q-aside-guest__s">登录之后就有一个位置，说话也能攒下来。</p>
          <button type="button" onClick={onLogin}>
            坐下聊聊
          </button>
        </section>
      )}

      {/* ——— ② 在线的人 ——— */}
      <section className="q-aside-card q-aside-people">
        <header className="q-aside-head">
          <span className="q-aside-head__t">
            <MorphIcon icon={MessageCircle} size={13} color="currentColor" />
            在线的人
          </span>
          <span className="q-aside-head__n">
            <i aria-hidden="true" />
            {/* 加载中传 -1：写「0 人在长亭」是假话，下一秒变 2 更奇怪 */}
            {online < 0 ? '正在数人…' : `${online} 人在长亭`}
          </span>
        </header>

        {members.length === 0 ? (
          <p className="q-aside-empty">
            {online < 0 ? '正在看看谁在…' : '此刻只有你在。说句话，就有人循声过来了。'}
          </p>
        ) : (
          <ul className="q-aside-list">
            {shown.map((m) => {
              const mSite = hostOf(m.site);
              return (
                <li key={m.id} className="q-aside-person">
                  <span
                    className="q-aside-person__avatar"
                    style={m.avatar ? { backgroundImage: `url("${m.avatar}")` } : undefined}
                    aria-hidden="true"
                  >
                    {m.name.slice(0, 1)}
                  </span>
                  <span className="q-aside-person__body">
                    <span className="q-aside-person__name">
                      {m.name}
                      {m.admin && <em>站长</em>}
                    </span>
                    {mSite && <span className="q-aside-person__site">来自 {mSite}</span>}
                  </span>
                  <span className="q-aside-person__dot" aria-label="在线" />
                </li>
              );
            })}
          </ul>
        )}

        {rest > 0 && (
          <button type="button" className="q-aside-more" onClick={() => setExpanded(true)}>
            显示全部（{members.length}）
          </button>
        )}
        {expanded && members.length > VISIBLE_MEMBERS && (
          <button type="button" className="q-aside-more" onClick={() => setExpanded(false)}>
            收起
          </button>
        )}
      </section>

      {/* ——— ③ 长亭的话 ——— */}
      <section className="q-aside-card q-aside-notice">
        <header className="q-aside-head">
          <span className="q-aside-head__t">
            <MorphIcon icon={Sparkles} size={13} color="currentColor" />
            长亭的话
          </span>
        </header>
        <ul className="q-aside-notice__list">
          {NOTICE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
