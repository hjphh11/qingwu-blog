import { useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { ChevronDown, MessageCircle, Sparkles, UserRound } from '../../lib/icons';
import type { ChatMe, ChatMember } from '../../lib/chat';

/**
 * 长亭 · 左侧栏
 *
 * 三块：我的卡 / 在线的人 / 长亭的话。
 *
 * 和参考对象（听雨茶室的侧栏）刻意不同的一处：**不做「Lv.2 + EXP 61/63」**。
 * 那套是副本面板的语言，长亭是歇脚的地方。这里换成一个称呼 + 进度 + 一句
 * 「再聊 8 句就是「煮茶的人」了」—— 进度感在，游戏味没有。
 *
 * 数据 30 秒刷一次（见 ChatRoom 的 whoTimer），不跟 2.5 秒的 poll 走。
 */

/** 在线列表默认露几个，超出折叠。6 个大约 15rem，和 .q-aside-list 的 max-height 对齐 */
const VISIBLE_MEMBERS = 6;

/**
 * 公告文案。**改这里就能改公告** —— 不落库是有意的：
 * 公告是站长的口吻，属于内容，归仓库；状态（谁在线、聊了几句）才归数据库。
 */
const NOTICE = [
  '欢迎来长亭。这里是清吾的一角，路过就坐坐，不必客气。',
  '说话留点余地；被冒犯了也可以直说，不用忍着。',
  '两分钟内的消息可以撤回；一分钟十五句是上限，再快会被请去喝口茶。',
  '站点已备案，违规内容会处理。',
];

function hostOf(url: string): string {
  return (url || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]!
    .toLowerCase();
}

export default function ChatAside({
  me,
  members,
  signedIn,
  online,
  onLogin,
  onJumpLatest,
}: {
  me: ChatMe | null;
  members: ChatMember[];
  signedIn: boolean;
  online: number;
  onLogin: () => void;
  onJumpLatest: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? members : members.slice(0, VISIBLE_MEMBERS);
  const rest = members.length - shown.length;

  return (
    <aside className="q-aside" aria-label="长亭侧栏">
      {/* ——— ① 我的卡 ——— */}
      {signedIn && me ? (
        <section className="q-aside-card q-aside-me">
          <div className="q-aside-me__top">
            <span
              className="q-aside-me__avatar"
              style={me.avatar ? { backgroundImage: `url("${me.avatar}")` } : undefined}
              aria-hidden="true"
            >
              {me.name.slice(0, 1)}
            </span>
            <div className="q-aside-me__id">
              <p className="q-aside-me__name">
                {me.name}
                {me.admin && <span className="q-aside-me__tag">站长</span>}
              </p>
              <p className="q-aside-me__title">{me.title}</p>
            </div>
          </div>

          <p className="q-aside-me__count">
            累计发言 <b>{me.messages}</b> 条
          </p>

          <div className="q-aside-me__bar" aria-hidden="true">
            <i style={{ width: `${me.progress}%` }} />
          </div>
          <p className="q-aside-me__next">
            {me.nextTitle ? (
              <>
                再聊 <b>{me.toNext}</b> 句就是「{me.nextTitle}」了
              </>
            ) : (
              <>已经走到最后一档，这亭子交给你了</>
            )}
          </p>

          <div className="q-aside-me__acts">
            <a href="/account/" className="q-aside-act">
              <MorphIcon icon={UserRound} size={13} color="currentColor" />
              个人主页
            </a>
            <button type="button" className="q-aside-act" onClick={onJumpLatest}>
              <MorphIcon icon={ChevronDown} size={13} color="currentColor" />
              回到最新
            </button>
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
            {online} 人在长亭
          </span>
        </header>

        {members.length === 0 ? (
          <p className="q-aside-empty">此刻只有你在。说句话，就有人循声过来了。</p>
        ) : (
          <ul className="q-aside-list">
            {shown.map((m) => {
              const site = hostOf(m.site);
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
                    {site && <span className="q-aside-person__site">来自 {site}</span>}
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
