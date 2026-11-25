import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import { X } from '../../lib/icons';
import { avatarFromHash } from '../../lib/avatar';
import { useDialogFocus } from '../../lib/useDialogFocus';
import type { SessionAccount } from '../../lib/auth';
import type { ChatMember } from '../../lib/chat';
import PersonEditor from './PersonEditor';

/**
 * 长亭 · 个人主页（居中小窗）
 *
 * 从 `ChatInfo` 里抽出来的：现在三个入口都能开 —— 右侧「空间成员」的每一行、
 * 左栏「此刻在长亭」的头像、左栏底部「我」那张卡。
 *
 * 站内没有「账号主页」这种页面（账号不是文章作者，没有作品列表可看），
 * 所以把「他在这间屋子里的痕迹」摆出来就够：头像、名字、站长标、
 * 从哪个站来、在不在、说过几句、第一句 / 最后一句什么时候。
 * **没有简介就不编**：账号表里没有 bio 字段。
 *
 * 挂 portal 是因为右栏与左栏都是 `overflow: hidden` 的卡片，弹层留在里面会被裁。
 */

/** `https://www.qingwu.ink/foo` → `qingwu.ink`：只留能一眼认出是谁的主机名 */
export function hostOf(url: string): string {
  return (url || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]!
    .toLowerCase();
}

/** 毫秒时间戳 → 「刚刚 / 12 分钟前 / 3 小时前 / 5 天前」 */
export function relTime(ms?: number): string {
  if (!ms) return '很久以前';
  const d = Math.max(0, Date.now() - ms);
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} 小时前`;
  return `${Math.round(d / 86_400_000)} 天前`;
}

/** 时间戳 → 「11/24 21:40」（人卡里报时间用，年不显示：这间屋子不会跨年还挂着） */
export function stampOf(ms?: number): string {
  if (!ms) return '某天';
  return new Date(ms).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PersonCard({
  m,
  self,
  account,
  onAccount,
  onClose,
}: {
  m: ChatMember;
  /** 这张卡是不是在看自己（多一枚「是你」标 + 一个「编辑资料」） */
  self?: boolean;
  /** 自己的会话账号；self 时才有，编辑资料要用它 */
  account?: SessionAccount | null;
  /** 资料存成功：把新账号抛给页面（同步会话、刷新成员名单） */
  onAccount?: (a: SessionAccount | null) => void;
  onClose: () => void;
}) {
  const boxRef = useDialogFocus<HTMLDivElement>(true, onClose);
  const site = hostOf(m.site);
  const avatar = m.avatar || avatarFromHash('');
  const posts = m.posts ?? 0;
  /** 正在编辑自己的资料（只在 self + 有 account 时可能为 true） */
  const [editing, setEditing] = useState(false);

  // 焦点落在盒子上而不是右上角那个 ×：一打开就给 × 画一圈焦点框，
  // 看着像报错。落在盒子上读屏一样会念标题，Tab 再进 ×。
  useEffect(() => {
    boxRef.current?.focus({ preventScroll: true });
  }, [boxRef]);

  /**
   * 「关于」优先用他自己写的那句（bio）。
   *
   * 没写的时候才退回自动文案 —— 只用真实数据拼，不编：说过话就报第一次的时间，
   * 没说过就直说没说过。
   */
  const about =
    (m.bio || '').trim() ||
    (posts > 0
      ? `${stampOf(m.firstPost)} 在这里说了第一句。`
      : self
        ? '还没在这间屋子里说过话，也没写简介。'
        : '还没在这间屋子里说过话，大概只是路过。');

  return createPortal(
    <div className="q-person" role="dialog" aria-modal="true" aria-label={`${m.name} 的个人主页`}>
      <button type="button" className="q-person__mask" aria-label="关掉个人主页" onClick={onClose} />
      <div className={`q-person__box${editing ? ' is-editing' : ''}`} ref={boxRef} tabIndex={-1}>
        <div className="q-person__hero" aria-hidden="true" />
        <button type="button" className="q-person__x" onClick={onClose} aria-label="关闭">
          <MorphIcon icon={X} size={15} color="currentColor" />
        </button>

        <div className="q-person__id">
          <span className="q-person__av" aria-hidden="true">
            {m.name.slice(0, 1)}
            {avatar && (
              <img
                src={avatar}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
          </span>
          <p className="q-person__name">
            {m.name}
            {m.admin && <span className="q-person__tag">站长</span>}
            {self && <span className="q-person__tag q-person__tag--me">是你</span>}
          </p>
          <p className={`q-person__state${m.online ? ' is-on' : ''}`}>
            {m.online ? (
              <>
                <i aria-hidden="true" />
                此刻在长亭
              </>
            ) : (
              `最近来过 · ${relTime(m.seen)}`
            )}
          </p>
        </div>

        <div className="q-person__body">
          {editing && account ? (
            <PersonEditor
              account={account}
              onAccount={(a) => onAccount?.(a)}
              onDone={() => setEditing(false)}
            />
          ) : (
            <>
              <h3 className="q-person__h">{self ? '关于你' : '关于这位茶友'}</h3>
              <p className="q-person__about">{about}</p>
              {site && (
                <a
                  className="q-person__link"
                  href={`https://${site}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  访问 {site} ↗
                </a>
              )}

              <dl className="q-person__stats">
                <div>
                  <dt>发言</dt>
                  <dd>
                    {posts}
                    <em>条</em>
                  </dd>
                </div>
                <div>
                  <dt>最后发言</dt>
                  <dd className="q-person__when">{posts > 0 ? stampOf(m.lastPost) : '—'}</dd>
                </div>
              </dl>

              {self && account && (
                <button type="button" className="q-person__edit" onClick={() => setEditing(true)}>
                  编辑资料
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
