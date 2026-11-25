import { useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Bell, BellRing, MessageCircle, Search, X } from '../../lib/icons';
import { avatarFromHash } from '../../lib/avatar';
import type { SessionAccount } from '../../lib/auth';
import type { ChatMember } from '../../lib/chat';

/**
 * 长亭 · 左侧栏
 *
 * 2026-11-25 换版后只剩三块：品牌 / 搜索 / 频道 + 底部的「我」。
 * 相对设计稿做了两处删减（站长要求）：
 *   · 没有「在线私信」分组 —— 长亭是一间公共客厅，私聊留给站外
 *   · 频道只有一个「综合大厅」，所以不渲染新建频道按钮，也不做频道切换
 *
 * 「在线的人」搬到了右侧的「空间详情」（和公告、规则放一起），
 * 左栏因此不再需要每 30 秒刷一份成员列表。
 */

/** 「茶室须知」展开后的正文。改这里就能改须知 —— 内容归仓库，状态才归数据库 */
const NOTICE_BODY =
  '十里一长亭，路过就进来坐坐。发言会过一遍 AI 审核，违规的内容会被收走；两分钟内可以撤回，一分钟十五句是上限。';

export default function ChatAside({
  account,
  members,
  identityPending,
  online,
  notify,
  open,
  onToggleNotify,
  onSearch,
  onLogin,
  onClose,
}: {
  account: SessionAccount | null;
  /** 在线的人：左栏只露头像，名字和来源在右侧「空间详情」里 */
  members: ChatMember[];
  /** 身份未确认：画同高的占位块，别说「还没进门」 */
  identityPending: boolean;
  /** -1 = 还在数人 */
  online: number;
  notify: 'off' | 'on' | 'denied';
  /** 移动端抽屉是否展开（桌面恒定展开，这个类名不起作用） */
  open: boolean;
  onToggleNotify: () => void;
  onSearch: () => void;
  onLogin: () => void;
  /** 移动端抽屉的关闭 */
  onClose: () => void;
}) {
  const [openInfo, setOpenInfo] = useState(false);

  /**
   * 头像统一走 `avatarFromHash`（cravatar）。
   *
   * `account.avatar` 是 `avatar_url || avatarFromEmail(email)`，QQ 邮箱会走
   * `q.qlogo.cn` —— 和在线名单用的 cravatar 是两个域名，同一账号会出现
   * 「我这儿空白、名单里却有头像」。cravatar 对 QQ 邮箱同样回 QQ 头像。
   */
  const meAvatar = account
    ? account.emailHash
      ? avatarFromHash(account.emailHash)
      : account.avatar
    : '';

  const host = (account?.site || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0];

  return (
    <aside className={`q-side q-glass${open ? ' is-open' : ''}`} aria-label="长亭侧栏">
      {/* ——— 品牌 ——— */}
      <div className="q-side__brand">
        <span className="q-side__mark" aria-hidden="true">
          {/* 一盏茶：杯 + 热气（自绘，不用 emoji 顶图标） */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
            <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
            <path d="M6 2v2" />
            <path d="M10 2v2" />
            <path d="M14 2v2" />
          </svg>
        </span>
        <div className="q-side__titles">
          <h1 className="q-side__name">长亭</h1>
          <p className="q-side__sub">
            <span className="q-side__tag">清吾茶话</span>
            歇歇脚再说
          </p>
        </div>

        <button
          type="button"
          className={`q-iconbtn q-side__notify${notify === 'on' ? ' is-on' : ''}`}
          onClick={onToggleNotify}
          aria-pressed={notify === 'on'}
          aria-label={notify === 'on' ? '关闭桌面提醒' : '开启桌面提醒'}
          title={
            notify === 'on'
              ? '开着呢：页面在后台时，有人说话会弹一条系统提醒'
              : notify === 'denied'
                ? '浏览器拦了提醒，去地址栏左边放行'
                : '页面放后台时，有人说话弹一条系统提醒'
          }
        >
          <MorphIcon icon={notify === 'on' ? BellRing : Bell} size={15} color="currentColor" />
        </button>

        <button
          type="button"
          className="q-iconbtn q-side__close"
          onClick={onClose}
          aria-label="收起频道栏"
        >
          <MorphIcon icon={X} size={15} color="currentColor" />
        </button>
      </div>

      {/* ——— 搜索 ——— */}
      <div className="q-side__search">
        <button type="button" className="q-searchbtn" onClick={onSearch}>
          <MorphIcon icon={Search} size={15} color="currentColor" />
          搜索聊天记录…
        </button>
      </div>

      {/* ——— 频道（只有一个） ——— */}
      <div className="q-side__scroll">
        <section className="q-side__group">
          <div className="q-side__grouphead">
            <span>茶室频道</span>
            <span>1 个</span>
          </div>
          <button type="button" className="q-channel is-active" aria-current="true">
            <span className="q-channel__hash" aria-hidden="true">
              #
            </span>
            <span className="q-channel__name">综合大厅</span>
            <span className="q-channel__n">
              {/* 加载中传 -1：写「0 人」是假话，下一秒变 2 更奇怪 */}
              {online < 0 ? '…' : online > 0 ? `${online} 人` : '空着'}
            </span>
          </button>
        </section>

        <section className="q-side__group">
          <div className="q-side__grouphead">
            <span>这间屋子</span>
          </div>
          <button
            type="button"
            className={`q-channel${openInfo ? ' is-active' : ''}`}
            onClick={() => setOpenInfo((v) => !v)}
            aria-expanded={openInfo}
          >
            <span className="q-channel__hash" aria-hidden="true">
              <MorphIcon icon={MessageCircle} size={13} color="currentColor" />
            </span>
            <span className="q-channel__name">茶室须知</span>
          </button>
          {openInfo && <p className="q-side__notice">{NOTICE_BODY}</p>}
        </section>

        {/* 只开了一间屋子，频道列表很短 —— 这里补一条「此刻在长亭」，
            让左栏不至于空掉一半，也把「有人在场」这件事摆在第一屏。
            只露头像，名字和来源留给右侧「空间详情」。 */}
        <section className="q-side__group">
          <div className="q-side__grouphead">
            <span>此刻在长亭</span>
            <span>{online < 0 ? '…' : online > 0 ? `${online} 人` : '空着'}</span>
          </div>
          <div className="q-side__folk">
            {members.slice(0, 9).map((m) => (
              <span key={m.id} className="q-side__folkav" title={m.name}>
                {m.name.slice(0, 1)}
                {m.avatar && (
                  <img
                    src={m.avatar}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </span>
            ))}
            {members.length > 9 && <span className="q-side__folkmore">+{members.length - 9}</span>}
            {members.length === 0 && (
              <p className="q-side__folkempty">
                {online < 0 ? '正在看看谁在…' : '只有你在。说句话，就有人循声过来。'}
              </p>
            )}
          </div>
        </section>
      </div>

      {/* ——— 我 ——— */}
      <div className="q-side__me">
        {identityPending ? (
          <div className="q-me" aria-hidden="true">
            <span className="q-me__ghost q-me__ghost--av" />
            <div className="q-me__id">
              <i className="q-me__ghost q-me__ghost--line" style={{ width: '5rem' }} />
              <i
                className="q-me__ghost q-me__ghost--line"
                style={{ width: '3.2rem', marginTop: '0.35rem' }}
              />
            </div>
          </div>
        ) : account ? (
          <div className="q-me">
            <span className="q-me__avatar">
              <span aria-hidden="true">
                {account.name.slice(0, 1)}
                {meAvatar && (
                  <img
                    src={meAvatar}
                    alt=""
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </span>
              <i className="q-me__dot" aria-hidden="true" />
            </span>
            <div className="q-me__id">
              <p className="q-me__name">
                {account.name}
                {account.role === 'admin' && <span className="q-member__tag">站长</span>}
              </p>
              <p className="q-me__sub">{host ? `来自 ${host}` : '在这间茶室里'}</p>
            </div>
            <span className="q-me__pill" title="你正在这间茶室里">
              <i aria-hidden="true" />
              在线
            </span>
          </div>
        ) : (
          <div className="q-me q-me--guest">
            <b>还没进门</b>
            <p>登录之后就有一个位置，说过的话也会留下。</p>
            <button type="button" className="q-me__cta" onClick={onLogin}>
              坐下聊聊
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
