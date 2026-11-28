import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import { Bell, BellRing, Search, X } from '../../lib/icons';
import { avatarFromHash } from '../../lib/avatar';
import type { SessionAccount } from '../../lib/auth';
import type { ChatMember, ChatPeer } from '../../lib/chat';
import { SITE } from '../../config';
import linksData from '../../data/links.json';

/**
 * 长亭 · 左侧栏
 *
 * 2026-11-25 换版后只剩三块：品牌 / 搜索 / 房间 + 底部的「我」。
 * 相对设计稿做了两处删减（站长要求）：
 *   · 没有「在线私信」分组 —— 长亭是一间公共客厅，私聊留给站外
 *   · 频道只有一个「综合大厅」，所以不渲染新建频道按钮，也不做频道切换
 *
 * 「在线的人」搬到了右侧的「空间详情」（和公告、规则放一起），
 * 左栏因此不再需要每 30 秒刷一份成员列表。
 */

/** `https://www.qingwu.ink/foo` → `qingwu.ink`：只留能一眼认出是谁的主机名 */
function hostOf(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]!
    .toLowerCase();
}

/** 本站主机名：没人在线时「互联」里也至少有它，否则那块会空着 */
const HOME_HOST = hostOf(SITE.url);

/**
 * 注册域（最后两段）：`daily.yybb.us` 和 `yybb.us` 是同一个站。
 * 友链里填的是主域，大厅消息里带的可能是子域 —— 不归一就配不上头像。
 */
function siteKey(host: string): string {
  const parts = host.replace(/^www\./, '').split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : host;
}

/**
 * 友链头像表：**人在友链申请里填的那张**，比 favicon 好认。
 * 构建时从 `src/data/links.json` 打进来，零请求；匹配不上再退回 favicon。
 */
const PEER_AVATARS = new Map<string, string>();
for (const f of linksData.friends ?? []) {
  try {
    PEER_AVATARS.set(siteKey(new URL(f.url).host), f.avatar);
  } catch {
    /* 友链里手写的怪 URL 跳过，不影响别人 */
  }
}

/**
 * 站点的「头像」。
 *
 * 优先级：本站头像 → 友链里填过的头像 → 该站 `/favicon.ico`。
 * 最后一步不引第三方图标代理（那又是一个会挂、也会看见访客 IP 的外部服务），
 * 加载失败就退回下面那个首字母方块。
 */
function peerIcon(p: ChatPeer): string {
  // 名册（federated-chat/members.json）里对方自己填的图标最准，先用它
  if (p.icon) return p.icon;
  if (p.home) return '/images/avatar.webp';
  return PEER_AVATARS.get(siteKey(p.host)) || `https://${p.host}/favicon.ico`;
}

export default function ChatAside({
  account,
  members,
  peers,
  people,
  identityPending,
  online,
  notify,
  open,
  onToggleNotify,
  onSearch,
  onLogin,
  onClose,
  onPick,
}: {
  account: SessionAccount | null;
  /** 在线的人：左栏只露头像，名字和来源在右侧「空间详情」里 */
  members: ChatMember[];
  /** 互联站点（由 /chat/who 从远端消息反推，本站排第一） */
  peers: ChatPeer[];
  /** 所有来过的人（带发言数、首末发言时间）；「我」的人卡从这里取一行 */
  people: ChatMember[];
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
  /** 点了某个头像 / 「我」那张卡：打开他的个人主页 */
  onPick: (m: ChatMember) => void;
}) {
  /**
   * 头像：自己传的那张 > cravatar（按邮箱算）。
   *
   * 不用 `account.avatar` 兜底里的 `avatarFromEmail`：QQ 邮箱会走 `q.qlogo.cn`，
   * 和在线名单用的 cravatar 是两个域名，同一账号会出现「我这儿空白、名单里却有头像」。
   * 但**自己传的头像优先** —— 换完之后左栏要跟着变，否则看着像没换成功。
   */
  const meAvatar = account
    ? account.avatarCustom
      ? account.avatar
      : account.emailHash
        ? avatarFromHash(account.emailHash)
        : account.avatar
    : '';

  const host = hostOf(account?.site || '');

  /**
   * 「我」的成员条目 —— 点底部那张卡就是看自己的个人主页。
   *
   * 优先用 `/chat/who` 的 `people` 里那一条（它带 posts / firstPost / lastPost，
   * 人卡才有「说过几句」）。刚坐下那一瞬间 presence 可能还没写上，
   * 名单里查不到我，就用 session 兜底：名字头像都对，只是数字是空的。
   */
  const me: ChatMember | null = account
    ? (people.find((p) => p.id === account.id) ?? {
        id: account.id,
        name: account.name,
        avatar: meAvatar,
        site: account.site,
        admin: account.role === 'admin',
        online: true,
      })
    : null;

  /**
   * 互联站点：这间屋子里实际收到过消息的站。
   *
   * 数据来自服务端（`/chat/who` 的 `peers`，按远端消息的 `remote_site` 归并），
   * **不再从成员表的 `site_url` 推** —— 那张表只有我们自己的账号，
   * 结果永远是「只有本站 1 个」，就是侧栏一直只显示一行 qingwu.ink 的原因。
   *
   * 服务端没给（老 worker / 查询失败）时退回「只有本站」，不至于空一块。
   */
  const peerList: ChatPeer[] = peers.length ? peers : [{ host: HOME_HOST, n: 0, home: true }];

  /**
   * 「要去外站吗」的二次确认。
   *
   * 为什么不在点了就直接跳：这个列表混着博客、聊天室、甚至应用页，
   * 有的是别人的站、有的是别人的 Matrix 前端。一次误触就把人送走，
   * 回来还得重新翻到这儿 —— 先问一句成本极低。
   */
  const [askPeer, setAskPeer] = useState<ChatPeer | null>(null);

  const peerName = (p: ChatPeer) => p.name || p.host;

  useEffect(() => {
    if (!askPeer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAskPeer(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [askPeer]);

  const goPeer = () => {
    const p = askPeer;
    if (!p) return;
    /**
     * 跳哪儿：名册里对方填的 `siteUrl` 优先 —— 有几个站的**站点**和 **homeserver/聊天室**
     * 不同域（比如 `chat.gbk.ink` 的站是 `somoe.xyz`），拿 host 拼会把人送到 Element 首页。
     * 名册没给才退回 `https://host`。
     */
    const target = p.url || `https://${p.host}`;
    // 新标签打开：长亭可以不关，回来还在原位置
    window.open(target, '_blank', 'noopener,noreferrer');
    setAskPeer(null);
  };

  return (
    <>
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
            <span>长亭频道</span>
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

        {/* 互联：这间屋子连到了哪些站。数据来自成员自己的 `site`，
            所以以后接了别的站，这里会自动多一行，不用改代码。 */}
        <section className="q-side__group">
          <div className="q-side__grouphead">
            <span>互联站点</span>
            <span>{peerList.length} 个</span>
          </div>
          <ul className="q-peers">
            {peerList.map((p) => (
              <li key={p.host}>
                <button
                  type="button"
                  className={`q-peer${p.home ? ' is-home' : ''}`}
                  /* 本站没什么可跳的：点它只会回到同一个页面 */
                  disabled={p.home}
                  onClick={() => setAskPeer(p)}
                  title={p.home ? '你就在这里' : p.desc ? `${peerName(p)} · ${p.desc}` : `去「${peerName(p)}」看看（会离开长亭）`}
                  aria-label={p.home ? '本站' : `去「${peerName(p)}」看看`}
                >
                <span className="q-peer__ic" aria-hidden="true">
                  {/* 底下的首字母是兜底：外站 favicon 404 / 防盗链时露出来 */}
                  {p.host.slice(0, 1).toUpperCase()}
                  <img
                    src={peerIcon(p)}
                    alt=""
                    width={22}
                    height={22}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </span>
                {/* 有站名就显示站名（「冷汐的杂货铺」比域名好认），没有退回域名 */}
                <span className="q-peer__host">{p.home ? p.host : p.name || p.host}</span>
                {p.home && <span className="q-peer__n">本站</span>}
                </button>
              </li>
            ))}
          </ul>
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
              <button
                key={m.id}
                type="button"
                className="q-side__folkav"
                title={`看 ${m.name} 的个人主页`}
                aria-label={`看 ${m.name} 的个人主页`}
                onClick={() => onPick(m)}
              >
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
              </button>
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
          <button
            type="button"
            className="q-me q-me--self"
            onClick={() => me && onPick(me)}
            aria-label="看自己的个人主页"
            title="别人点你的头像，看到的就是这一页"
          >
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
                {account.role === 'admin' && <span className="q-member__tag">站长</span>}
                {account.name}
              </p>
              <p className="q-me__sub">{host ? `来自 ${host}` : '在长亭里'}</p>
            </div>
            <span className="q-me__pill" title="你正在长亭里">
              <i aria-hidden="true" />
              在线
            </span>
          </button>
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

    {/* 二次确认：去外站。portal 到 body —— 侧栏是 overflow 容器，
        弹层留在里面会被裁掉（站内弹层都按这个来）。 */}
    {askPeer &&
      createPortal(
        <div className="q-leave" role="dialog" aria-modal="true" aria-label="离开长亭去外站">
          <button
            type="button"
            className="q-leave__mask"
            aria-label="关掉"
            onClick={() => setAskPeer(null)}
          />
          <div className="q-leave__box">
            <span className="q-leave__ic" aria-hidden="true">
              {peerName(askPeer).slice(0, 1).toUpperCase()}
              <img
                src={peerIcon(askPeer)}
                alt=""
                width={40}
                height={40}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </span>
            <p className="q-leave__t">去看看「{peerName(askPeer)}」？</p>
            <p className="q-leave__s">
              会打开新的标签页，地址是 <b>{askPeer.host}</b>。
              那边的登录和这里互不相通，长亭这一页给你留着。
            </p>
            <div className="q-leave__opts">
              <button type="button" className="q-leave__go" onClick={goPeer}>
                去逛逛
              </button>
              <button type="button" className="q-leave__stay" onClick={() => setAskPeer(null)}>
                留在这儿
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
