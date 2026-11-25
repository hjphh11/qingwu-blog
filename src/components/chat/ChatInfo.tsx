import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import { Bell, X } from '../../lib/icons';
import { avatarFromHash } from '../../lib/avatar';
import { useDialogFocus } from '../../lib/useDialogFocus';
import type { ChatMember, PinInfo } from '../../lib/chat';
import { hostOf } from './PersonCard';

/**
 * 长亭 · 右侧「空间详情」
 *
 * 三块：频道公告 / 空间成员 / 长亭的话。
 * 设计稿里第四块是「爱弥斯色板速览」—— 那是给设计核对用的，
 * 站长明确说不放，所以这里没有。
 *
 * 公告优先显示站长置顶的那条消息（`pin`）：置顶是本页唯一能随时间更新的公告位，
 * 没置顶时退回仓库里写死的那段欢迎语。
 */

const RULES = [
  '欢迎来长亭。这里是清吾的一角，路过就坐坐，不必客气。',
  '说话留点余地；被冒犯了也可以直说，不用忍着。',
  '两分钟内可以撤回；一分钟十五句是上限，再快会被请去喝口茶。',
  '发言会过一遍 AI 审核，违规的内容会被收走。',
];

/**
 * 卡片里先摆几个人。
 *
 * 5 是站长定的：再少这张卡就像一个「当前在线」小印章，看不出这是一间有人的屋子；
 * 再多右栏就得天天滚，而人一多的时候本来就该去看完整名单。
 */
const CARD_SLOTS = 5;

/**
 * 一个人一行。点一下看他的个人主页（居中小窗）。
 * 在线的是实心点，不在线的不画点 —— 空心点容易被当成「加载中」。
 */
function MemberRow({ m, onPick }: { m: ChatMember; onPick: (m: ChatMember) => void }) {
  const site = hostOf(m.site);
  const avatar = m.avatar || avatarFromHash('');
  return (
    <li>
      <button
        type="button"
        className={`q-member${m.online ? ' is-on' : ''}`}
        onClick={() => onPick(m)}
        aria-label={`看 ${m.name} 的个人主页`}
      >
        <span className="q-member__av" aria-hidden="true">
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
        <span className="q-member__body">
          <span className="q-member__name">
            {m.name}
            {m.admin && <span className="q-member__tag">站长</span>}
          </span>
          {site && <span className="q-member__site">来自 {site}</span>}
        </span>
        {m.online && <i className="q-member__dot" aria-label="在线" />}
      </button>
    </li>
  );
}

export default function ChatInfo({
  members,
  people,
  online,
  pin,
  loading,
  open,
  collapsed,
  onClose,
  onPick,
}: {
  /** 在线的人（用于标题里的计数兜底） */
  members: ChatMember[];
  /** 所有来过的人（进过门或说过话）；空数组时退回在线名单 */
  people: ChatMember[];
  /** -1 = 还在数人 */
  online: number;
  /** 站长置顶的那条；null = 没有置顶 */
  pin: PinInfo | null;
  loading: boolean;
  /** 窄屏抽屉是否展开（≥1200 时它常驻，这个类名不起作用） */
  open: boolean;
  /**
   * 宽屏上被「信息栏」按钮收起来了。
   *
   * 收起后这一列宽度是 0（要留给动画），DOM 还在 —— 所以必须 inert，
   * 否则 Tab 会跳进一个看不见的面板里。
   */
  collapsed?: boolean;
  onClose: () => void;
  /** 点了某个人：把「看谁」交给页面层，人卡在那儿统一渲染 */
  onPick: (m: ChatMember) => void;
}) {
  const [allOpen, setAllOpen] = useState(false);
  const allBoxRef = useDialogFocus<HTMLDivElement>(allOpen, () => setAllOpen(false));
  const list = people.length ? people : members;
  /**
   * 点一个人：先收起名单小窗再把「看谁」抛给页面层。
   *
   * 人卡现在由 `ChatRoom` 统一渲染（左栏的「我」和「此刻在长亭」也要开它），
   * 两个弹层若同时挂在这儿和那儿，会在 document 上各挂一个 Esc 监听 ——
   * 叠着按一次 Esc 会连关两层。
   */
  const openPerson = (m: ChatMember) => {
    setAllOpen(false);
    onPick(m);
  };
  const shown = list.slice(0, CARD_SLOTS);

  return (
    <aside
      id="q-chat-info"
      className={`q-info q-glass${open ? ' is-open' : ''}`}
      aria-label="空间详情"
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      <div className="q-info__head">
        <span className="q-info__title">
          <i aria-hidden="true" />
          空间详情
        </span>
        <button type="button" className="q-iconbtn" onClick={onClose} aria-label="收起空间详情">
          <MorphIcon icon={X} size={15} color="currentColor" />
        </button>
      </div>

      <div className="q-info__scroll">
        {/* ——— ① 公告：玫瑰粉大色块 ——— */}
        <section className="q-notice">
          <div className="q-notice__top">
            <span className="q-notice__badge">
              <MorphIcon icon={Bell} size={11} color="currentColor" />
              频道公告
            </span>
            {pin && <span className="q-notice__pin">置顶</span>}
          </div>
          <h2 className="q-notice__t">
            {pin ? (pin.excerpt || `${pin.name} 置顶了一条消息`) : '欢迎来到长亭'}
          </h2>
          <p className="q-notice__b">
            {pin
              ? `由 ${pin.name} 置顶。这里是温润柔和的交流客厅 —— 发一条消息试试，路过的人会回你；悬停任意一条还能点回应或引用。`
              : '这里是温润柔和的交流客厅。发一条消息试试看，路过的人会在片刻后回应你；悬停任意一条还能点回应或引用。'}
          </p>
        </section>

        {/* ——— ② 成员 ——— */}
        <section className="q-card">
          <div className="q-card__head">
            <span className="q-card__t">空间成员</span>
            <span className="q-card__n">
              {loading || online < 0
                ? '正在数人…'
                : list.length > online
                  ? `${list.length} 人来过 · ${online} 在线`
                  : `${online} 人在长亭`}
            </span>
          </div>

          {list.length === 0 ? (
            <p className="q-members__empty">
              {loading || online < 0
                ? '正在看看谁在…'
                : '此刻只有你在。说句话，就有人循声过来了。'}
            </p>
          ) : (
            <>
              <ul className="q-members">
                {shown.map((m) => (
                  <MemberRow key={m.id} m={m} onPick={openPerson} />
                ))}
              </ul>
              {list.length > shown.length && (
                <button type="button" className="q-members__more" onClick={() => setAllOpen(true)}>
                  显示全部 {list.length} 人
                </button>
              )}
            </>
          )}
        </section>

        {/* ——— ③ 规矩 ——— */}
        <section className="q-card">
          <div className="q-card__head">
            <span className="q-card__t">长亭的话</span>
          </div>
          <ul className="q-rules">
            {RULES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>

      {/* 全部成员：居中小窗。人一多就不能挤在右栏里，那会把公告和规矩顶下去 */}
      {allOpen &&
        createPortal(
          <div className="q-people" role="dialog" aria-modal="true" aria-label="空间成员">
            <button
              type="button"
              className="q-people__mask"
              aria-label="关掉成员名单"
              onClick={() => setAllOpen(false)}
            />
            <div className="q-people__box" ref={allBoxRef}>
              <div className="q-people__head">
                <span className="q-people__t">空间成员</span>
                <span className="q-people__n">
                  {list.length} 人来过 · {online} 在线
                </span>
                <button
                  type="button"
                  className="q-iconbtn"
                  onClick={() => setAllOpen(false)}
                  aria-label="关闭"
                >
                  <MorphIcon icon={X} size={15} color="currentColor" />
                </button>
              </div>
              <ul className="q-members q-members--all">
                {list.map((m) => (
                  <MemberRow key={m.id} m={m} onPick={openPerson} />
                ))}
              </ul>
            </div>
          </div>,
          document.body,
        )}

    </aside>
  );
}
