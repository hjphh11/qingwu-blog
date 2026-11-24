import { useCallback, useEffect, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import {
  ChevronDown,
  CircleAlert,
  ImageUp as ImageIcon,
  LoaderCircle,
  Search,
  Send,
  Smile,
  X,
} from '../lib/icons';
import EmojiPicker from './EmojiPicker';
import LoginDialog from './auth/LoginDialog';
import ChatAside from './chat/ChatAside';
import ChatSearch from './chat/ChatSearch';
import { renderRich } from '../lib/richText';
import { EMOJI_MAP } from '../lib/emojis';
import { fetchMe, type AuthConfig, type SessionAccount } from '../lib/auth';
import {
  fetchWho,
  loadHistory,
  markRead,
  mediaSrc,
  poll,
  react,
  recall,
  send,
  typing,
  uploadMedia,
  type ChatMedia,
  type ChatMember,
  type ChatMessage,
  type SearchHit,
} from '../lib/chat';

/**
 * 长亭 · 聊天室
 *
 * 三件事决定了它的形状：
 *
 * ① **轮询 2.5 秒，不用 WebSocket**。生产是香港机的 `wrangler dev` 常驻，
 *    service 一 restart，所有长连接同时断；轮询只是静默重试一次。
 *    用 `setTimeout` 递归而不是 `setInterval` —— 请求慢的时候不堆叠。
 *
 * ② **消息按 id 合并，不整体替换**。poll 会重复下发「刚转正的消息」
 *    （pending → visible 时 id 早已小于游标，不做补发别人永远看不到），
 *    所以合并必须按 id 幂等，且用新状态覆盖旧状态。
 *
 * ③ **不在底部就不硬滚**。用户正往上翻旧消息时，被拽回底部是最招人烦的行为；
 *    改成给一个「↓ N 条新消息」的浮标。
 */

/** poll 间隔。2.5 秒是「体感即时」和「不把库写热」的平衡点 */
const POLL_MS = 2_500;

/** 相邻消息超过这个间隔就插一条时间分割 */
const GROUP_GAP_MS = 5 * 60 * 1000;

/** 离底部多近算「在底部」 */
const BOTTOM_SLACK = 80;

const DRAFT_KEY = 'qingwu:chat-draft';

/** 图片上传前压到长边这么多 */
const IMAGE_MAX_SIDE = 1600;
/** 压缩后的目标体积（解码后）。服务端上限 1MB，留点余量 */
const IMAGE_MAX_BYTES = 900 * 1024;
/** 视频原样上传的上限 */
const VIDEO_MAX_BYTES = 5 * 1024 * 1024;

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('read_failed'));
    fr.readAsDataURL(file);
  });
}

/**
 * 图片压缩：长边 1600、webp，不够小就继续降质量。
 *
 * GIF **不压**：canvas 只取第一帧，压完动画就没了 —— 动态表情是这个站的常用物料，
 * 压成静图比不压更糟。GIF 直接原样传（限 1MB）。
 */
async function shrinkImage(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (file.type === 'image/gif') {
    if (file.size > 1024 * 1024) return null;
    return { dataUrl: await readAsDataURL(file), width: 0, height: 0 };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    let quality = 0.86;
    let dataUrl = canvas.toDataURL('image/webp', quality);
    // data URL 的长度 ≈ base64，解码后是 0.75 倍
    while (dataUrl.length * 0.75 > IMAGE_MAX_BYTES && quality > 0.45) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/webp', quality);
    }
    return { dataUrl, width: w, height: h };
  } catch {
    return null;
  }
}

/**
 * 「轻回应」的一组固定表情。
 *
 * 为什么不做完整表情面板：轻回应的意思是「不必回一句话，点一下就好」，
 * 挑一个比挑一个「从 153 个里选」快得多。要发表情进正文，输入框那边有完整面板。
 * （听雨那边用的六只小猫也是同一个思路，只是他们有自己画的素材。）
 */
const REACT_SET = [
  { key: 'clap', label: '赞' },
  { key: 'heart_eyes', label: '喜欢' },
  { key: 'rofl', label: '笑到了' },
  { key: 'cry', label: '哭了' },
  { key: 'eyes', label: '围观' },
  { key: 'partying_face', label: '庆祝' },
  { key: 'sparkles', label: '好看' },
  { key: 'pray', label: '谢啦' },
] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** HH:mm（本地时区）。服务端给的是 ISO/UTC，交给 Date 转 */
function clockOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 时间分割上显示什么：今天只给时刻，跨天给日期 */
function stampOf(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = dayOf(iso) === dayOf(today.toISOString());
  if (sameDay) return clockOf(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${clockOf(iso)}`;
}

/** 按 id 合并：新状态覆盖旧状态，被撤回的不删（要留一行提示） */
function mergeMessages(
  prev: ChatMessage[],
  incoming: ChatMessage[],
  recalled: number[],
): ChatMessage[] {
  if (!incoming.length && !recalled.length) return prev;

  const map = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  for (const id of recalled) {
    const old = map.get(id);
    if (old && old.status !== 'recalled') map.set(id, { ...old, status: 'recalled' });
  }
  // 新消息可能插在中间（补发），统一按 id 排 —— 前端不再费心维护顺序
  return [...map.values()].sort((a, b) => a.id - b.id);
}

export default function ChatRoom() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [online, setOnline] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  /** 侧栏数据：在线的人（「我是谁」直接用会话里的 account，服务端不再算一遍） */
  const [account, setAccount] = useState<SessionAccount | null>(null);
  const [members, setMembers] = useState<ChatMember[]>([]);

  /** 是否停在底部 —— 控制「回到最新 / N 条新消息」浮标的显隐 */
  const [atBottom, setAtBottom] = useState(true);

  /** 正在回哪一条（引用） */
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  /** 这条消息里已经 @ 了谁（发出去时一并提交） */
  const [mentionIds, setMentionIds] = useState<number[]>([]);
  /** 输入框里正在打的那个 @（null = 没在选人） */
  const [mention, setMention] = useState<{ at: number; q: string } | null>(null);

  /** 别人正在打字 */
  const [typingNames, setTypingNames] = useState<string[]>([]);
  /** 我最新那条被读了几次 */
  const [reads, setReads] = useState<{ id: number; n: number } | null>(null);

  /** 搜索面板 */
  const [searchOpen, setSearchOpen] = useState(false);
  /** 从搜索结果跳过去之后，临时高亮的那条 */
  const [highlightId, setHighlightId] = useState(0);

  /** 「正在输入」上报节流 */
  const lastTypingRef = useRef(0);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [tip, setTip] = useState<{ kind: 'warn' | 'ok'; text: string } | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  /** 已经传好、还没发出去的那张图 / 那段视频 */
  const [pendingMedia, setPendingMedia] = useState<ChatMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 已见过的最新 id —— poll 的游标 */
  const lastIdRef = useRef(0);
  /** 「上次看到这里」只画一次：记录读进来时的 lastRead */
  const readMarkRef = useRef(0);
  /** 用户不在底部时，攒下来的新消息条数 */
  const [pendingNew, setPendingNew] = useState(0);
  /** 页面在后台时攒的新消息数 —— 只用来改页签标题 */
  const [unread, setUnread] = useState(0);
  const atBottomRef = useRef(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setPendingNew(0);
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  /** 侧栏刷新：只刷在线名单，不动消息流 */
  const refreshWho = useCallback(async () => {
    setMembers(await fetchWho());
  }, []);

  /** 首屏：翻历史 + 认身份 + 侧栏 */
  const init = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [page, who, list] = await Promise.all([
        loadHistory({ limit: 30 }),
        fetchMe(),
        fetchWho(),
      ]);
      setMessages(page.messages);
      setHasMore(page.hasMore);
      setOnline(page.online);
      setSignedIn(page.signedIn);
      setConfig(who.config);
      setAccount(who.account);
      setMembers(list);
      lastIdRef.current = page.messages.reduce((max, m) => Math.max(max, m.id), 0);
      readMarkRef.current = page.lastRead;
      // 首屏一定在底部：进来要看的是最新的
      requestAnimationFrame(() => scrollToBottom());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    void init();
  }, [init]);

  /** 轮询：setTimeout 递归，页面不可见时暂停 */
  useEffect(() => {
    let alive = true;
    let timer = 0;

    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === 'visible') {
        try {
          const r = await poll(lastIdRef.current);
          if (!alive) return;

          setOnline(r.online);
          setSignedIn(r.signedIn);
          setTypingNames(r.typing);
          setReads(r.reads);

          if (r.messages.length || r.recalled.length) {
            const incoming = r.messages;
            const atBottom = atBottomRef.current;
            setMessages((prev) => mergeMessages(prev, incoming, r.recalled));
            for (const m of incoming) lastIdRef.current = Math.max(lastIdRef.current, m.id);

            // 自己发的那条不算「新消息」—— 发送路径已经滚到底了
            const others = incoming.filter((m) => !m.mine).length;
            if (others > 0) {
              if (document.visibilityState !== 'visible') {
                // 人在别的标签页：只累加页签数字，别在他回来时再滚一次屏
                setUnread((n) => n + others);
              } else if (!atBottom) {
                setPendingNew((n) => n + others);
              }
            }
          }
        } catch {
          /* 静默：2.5 秒后自然重试，弹错误只会让人以为聊天坏了 */
        }
      }
      if (alive) timer = window.setTimeout(tick, POLL_MS);
    };

    timer = window.setTimeout(tick, POLL_MS);

    // 切回前台立刻补一次，别等下一个 tick
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setUnread(0);
        window.clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  /**
   * 侧栏 30 秒刷一次。
   *
   * 不跟 poll 的 2.5 秒走：在线名单和称号变化极慢，跟着轮询只会让每条
   * 消息的请求都多一次 JOIN。切回前台时 refreshWho 会由 poll 之外的
   * 时机补一次（见 doSend 与 init），这里只管「一直开着页面」的场景。
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshWho();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshWho]);

  /**
   * 页签标题带未读数。
   *
   * 为什么值得做：长亭是「有人在场」的地方，但没人会一直盯着这一页。
   * 切去写文章、听音乐时，标题栏那个「(3)」就是唯一能把你叫回来的东西。
   *
   * 每次都「先剥掉旧前缀再加」，所以连续收到消息不会叠成 `(1) (2) 长亭`。
   */
  useEffect(() => {
    const clean = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${clean}` : clean;
  }, [unread]);

  /** 读到哪了：有新消息且自己在底部时，把游标推上去 */
  useEffect(() => {
    if (!signedIn || !messages.length || !atBottomRef.current) return;
    const newest = messages[messages.length - 1];
    if (newest && newest.status === 'visible') void markRead(newest.id);
  }, [messages, signedIn]);

  /** 草稿：刷新不丢字。只存本机，不同步设备（和阅读位置不同） */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (saved) setDraft(saved);
    } catch {
      /* 隐私模式下 localStorage 会抛异常，忽略 */
    }
  }, []);

  useEffect(() => {
    try {
      if (draft) window.localStorage.setItem(DRAFT_KEY, draft);
      else window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* 同上 */
    }
  }, [draft]);

  /**
   * 输入框随内容长高。
   *
   * 不依赖 `field-sizing: content`（Chrome 123+ 才有，Safari 还没跟），
   * 手动「先设 auto 再读 scrollHeight」是最稳的写法：不先归 auto，
   * 删字时高度不会回缩。
   */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft, signedIn]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setPendingNew(0);
  };

  const loadMore = async () => {
    const oldest = messages[0];
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await loadHistory({ before: oldest.id, limit: 30 });
      setMessages((prev) => mergeMessages(prev, page.messages, []));
      setHasMore(page.hasMore);
      // 往上翻的时候要「停在原处」：补完高度差，否则内容会跳一下
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      setTip({ kind: 'warn', text: '更早的消息没拉到，稍后再试' });
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * 处理一个文件：压图 → 上传 → 挂到「待发送」上。
   *
   * 为什么不直接发出去：图片经常要配一句话（「你看这个」），
   * 上传完先挂着、等用户按发送，比「先发图再补文字」自然。
   */
  const attachFile = async (file: File) => {
    if (!signedIn) {
      setLoginOpen(true);
      return;
    }
    if (uploading) return;
    setTip(null);
    setUploading(true);

    try {
      if (file.type.startsWith('image/')) {
        const shrunk = await shrinkImage(file);
        if (!shrunk) {
          setTip({ kind: 'warn', text: '这张图压不动，换一张试试（gif 请控制在 1MB 内）' });
          return;
        }
        const up = await uploadMedia(shrunk.dataUrl, {
          width: shrunk.width,
          height: shrunk.height,
        });
        if (up.ok) setPendingMedia(up.media);
        else setTip({ kind: 'warn', text: up.message });
        return;
      }

      if (file.type.startsWith('video/')) {
        if (file.size > VIDEO_MAX_BYTES) {
          setTip({ kind: 'warn', text: '视频不要超过 5 MB，先剪短一点' });
          return;
        }
        const dataUrl = await readAsDataURL(file);
        const up = await uploadMedia(dataUrl);
        if (up.ok) setPendingMedia(up.media);
        else setTip({ kind: 'warn', text: up.message });
        return;
      }

      setTip({ kind: 'warn', text: '只能发图片或视频' });
    } finally {
      setUploading(false);
    }
  };

  const doSend = async () => {
    const text = draft.trim();
    // 纯图消息允许没有文字
    if ((!text && !pendingMedia) || sending || uploading) return;
    setSending(true);
    setTip(null);
    const res = await send(text, {
      replyTo: replyTo?.id ?? 0,
      mentions: mentionIds,
      mediaId: pendingMedia?.id ?? 0,
    });
    setSending(false);

    if (res.ok) {
      setDraft('');
      // 发出去之后引用、@、待发媒体都该清掉 —— 留着会让下一条莫名其妙也带上
      setReplyTo(null);
      setMentionIds([]);
      setMention(null);
      setPendingMedia(null);
      setMessages((prev) => mergeMessages(prev, [res.message], []));
      lastIdRef.current = Math.max(lastIdRef.current, res.message.id);
      setEmojiOpen(false);
      requestAnimationFrame(() => scrollToBottom(true));
      inputRef.current?.focus();
      // 发言数变了 —— 侧栏的「累计发言 / 再聊几句」要跟着走，别等 30 秒
      void refreshWho();
      return;
    }

    if (res.reason === 'login') {
      setLoginOpen(true);
      setTip({ kind: 'warn', text: res.message });
      return;
    }
    // screened = 本地清单拦下的，服务端已经给了中性提示
    setTip({ kind: 'warn', text: res.message });
  };

  const doRecall = async (id: number) => {
    const res = await recall(id);
    if (res.ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: 'recalled' as const } : m)),
      );
    } else {
      setTip({ kind: 'warn', text: res.message });
    }
  };

  /**
   * 表情回应。
   *
   * 用服务端回的整份汇总替换本地那份 —— 自己加减的话，
   * 两个人同时点会出现「本地看着 2、实际是 3」的分叉。
   */
  const doReact = async (id: number, emoji: string) => {
    if (!signedIn) {
      setLoginOpen(true);
      return;
    }
    const res = await react(id, emoji);
    if (res.ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, reactions: res.reactions } : m)),
      );
    } else {
      setTip({ kind: 'warn', text: res.message });
    }
  };

  const pickEmoji = (key: string) => {
    setDraft((d) => `${d}:${key}`);
    inputRef.current?.focus();
  };

  /**
   * 从 @ 候选里选一个人。
   *
   * 把输入框里「@已经打了一半的名字」整段换成「@完整名字 」，光标落到后面 ——
   * 不这么做的话，选完人光标会跳回开头，接着打字就全插到最前面了。
   */
  const pickMention = (m: ChatMember) => {
    if (!mention) return;
    const el = inputRef.current;
    const pos = el?.selectionStart ?? draft.length;
    const insert = `@${m.name} `;
    const next = (draft.slice(0, mention.at) + insert + draft.slice(pos)).slice(0, 500);
    setDraft(next);
    setMentionIds((ids) => [...new Set([...ids, m.id])]);
    setMention(null);
    requestAnimationFrame(() => {
      el?.focus();
      const p = Math.min(mention.at + insert.length, next.length);
      el?.setSelectionRange(p, p);
    });
  };

  /** @ 候选：在线的人里名字包含当前输入的那几个字 */
  const mentionList =
    mention && members.length
      ? members
          .filter((m) => !mention.q || m.name.toLowerCase().includes(mention.q.toLowerCase()))
          .slice(0, 5)
      : [];

  /**
   * 从搜索结果跳过去。
   *
   * 那条可能比当前页更早（还没加载），所以先把它的精简形态并进列表再滚过去；
   * 已经在列表里就**不覆盖** —— 覆盖会把它身上的回应和引用一起抹掉。
   */
  const jumpToMessage = (hit: SearchHit) => {
    setSearchOpen(false);
    setMessages((prev) => {
      if (prev.some((m) => m.id === hit.id)) return prev;
      return mergeMessages(
        prev,
        [
          {
            id: hit.id,
            name: hit.name,
            avatar: hit.avatar,
            site: '',
            admin: false,
            body: hit.body,
            at: hit.at,
            status: hit.recalled ? ('recalled' as const) : ('visible' as const),
            mine: hit.mine,
            origin: 'local' as const,
            reactions: [],
            quote: null,
            mentionedMe: false,
            media: null,
          },
        ],
        [],
      );
    });
    setHighlightId(hit.id);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-mid="${hit.id}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    window.setTimeout(() => setHighlightId(0), 2400);
  };

  /**
   * 「上次看到这里」插在哪个 id 之后。
   *
   * 只在**存在比它更新的消息**时才画 —— 否则进来看到的第一个分割线就是
   * 「上次看到这里」，等于什么也没说明。0 = 不画。
   */
  const readMarkId =
    readMarkRef.current > 0 && messages.some((m) => m.id > readMarkRef.current)
      ? readMarkRef.current
      : 0;

  // —— 渲染 ——
  //
  // 左栏在三个分支里都渲染：加载骨架如果只有右边一列，加载完一变两列会横向跳一下。
  // 加载阶段登录按钮点了没反应（LoginDialog 要等 config 才有），属于必然，不是 bug。

  /** 侧栏（三个分支共用一份配置，避免 props 写三遍） */
  const aside = (
    <ChatAside
      account={account}
      members={members}
      online={online}
      onLogin={() => setLoginOpen(true)}
    />
  );

  if (loading) {
    return (
      <div className="q-chat-layout">
        {aside}
        <section className="q-chat" aria-busy="true">
          <div className="q-chat__empty">
            <MorphIcon icon={LoaderCircle} size={18} color="currentColor" />
            <span>正在推开长亭的门…</span>
          </div>
        </section>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="q-chat-layout">
        {aside}
        <section className="q-chat">
          <div className="q-chat__empty">
            <MorphIcon icon={CircleAlert} size={18} color="currentColor" />
            <span>长亭的门暂时推不开，稍后再来看看</span>
          </div>
          <div className="q-chat__retry">
            <button type="button" onClick={() => void init()}>
              再试一次
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="q-chat-layout">
      {aside}
      <section
        className="q-chat"
        aria-label="长亭聊天室"
        onDragOver={(e) => {
          // 不 preventDefault 的话浏览器会直接打开这个文件，把聊天页面顶掉
          if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          const f = e.dataTransfer?.files?.[0];
          if (!f) return;
          e.preventDefault();
          void attachFile(f);
        }}
      >
        <div className="q-chat__bar">
          <span className="q-chat__live">
            <i aria-hidden="true" />
            {online > 0 ? `${online} 人在长亭` : '还没有人在'}
          </span>
          <button
            type="button"
            className="q-chat__searchbtn"
            onClick={() => setSearchOpen(true)}
            aria-label="搜索聊天记录"
          >
            <MorphIcon icon={Search} size={13} color="currentColor" />
            搜索
          </button>
        </div>

      <div className="q-chat__scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="q-chat__inner">
          {hasMore && (
            <div className="q-chat__more">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? '正在翻…' : '看看更早的'}
              </button>
            </div>
          )}

          {messages.length === 0 && (
            <p className="q-chat__blank">
              长亭刚开门，还没有人说话。
              <br />
              你可以是第一个。
            </p>
          )}

          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const prevTs = prev ? new Date(prev.at).getTime() : 0;
            const ts = new Date(m.at).getTime();
            const splitTime = !prev || ts - prevTs > GROUP_GAP_MS;
            const showReadMark =
              readMarkId > 0 && m.id > readMarkId && (!prev || prev.id <= readMarkId);
            // 「上次看到这里」这条线也算一次打断：它后面的那条要重新露头像，
            // 否则视觉上像是接着上一句说的（实际中间隔了一条时间线）
            const sameAuthor =
              prev && prev.name === m.name && prev.status !== 'recalled' && m.status !== 'recalled';
            const grouped = Boolean(sameAuthor) && !splitTime && !showReadMark;

            return (
              <div
                key={m.id}
                data-mid={m.id}
                className={highlightId === m.id ? 'q-chat__anchor' : undefined}
              >
                {splitTime && <div className="q-chat__time">{stampOf(m.at)}</div>}
                {showReadMark && <div className="q-chat__readmark">上次看到这里</div>}
                <MessageRow
                  m={m}
                  grouped={grouped}
                  canRecall={m.mine && m.status === 'visible' && Date.now() - ts < 2 * 60 * 1000}
                  onRecall={() => void doRecall(m.id)}
                  onReact={(emoji) => void doReact(m.id, emoji)}
                  onReply={() => setReplyTo(m)}
                  readCount={reads?.id === m.id ? reads.n : 0}
                />
              </div>
            );
          })}
        </div>
      </div>

      {!atBottom && (
        <button type="button" className="q-chat__jump" onClick={() => scrollToBottom(true)}>
          <MorphIcon icon={ChevronDown} size={13} color="currentColor" />
          {pendingNew > 0 ? `${pendingNew} 条新消息` : '回到最新'}
        </button>
      )}

      {tip && (
        <p className="q-chat__tip" role="status">
          {tip.text}
        </p>
      )}

      {(replyTo || typingNames.length > 0 || pendingMedia) && (
        <div className="q-chat__above">
          {replyTo && (
            <div className="q-chat__replybar">
              <span className="q-chat__replybar__t">
                回 <b>{replyTo.name}</b>
                {replyTo.body ? `：${replyTo.body.replace(/\s+/g, ' ').slice(0, 40)}` : ''}
              </span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="取消引用">
                <MorphIcon icon={X} size={11} color="currentColor" />
              </button>
            </div>
          )}
          {typingNames.length > 0 && (
            <p className="q-chat__typing">
              {typingNames.slice(0, 2).join('、')}
              {typingNames.length > 2 ? ` 等 ${typingNames.length} 人` : ''} 正在输入
              <i />
              <i />
              <i />
            </p>
          )}
          {pendingMedia && (
            <div className="q-chat__pendingmedia">
              {pendingMedia.kind === 'image' ? (
                <img src={mediaSrc(pendingMedia)} alt="待发送的图片" />
              ) : (
                <video src={mediaSrc(pendingMedia)} muted playsInline preload="metadata" />
              )}
              <button
                type="button"
                onClick={() => setPendingMedia(null)}
                aria-label="不用这张了"
              >
                <MorphIcon icon={X} size={11} color="currentColor" />
              </button>
            </div>
          )}
        </div>
      )}

      {signedIn ? (
        <div className="q-chat__composer">
          <div className="q-chat__inputwrap">
            {mention && mentionList.length > 0 && (
              <div className="q-chat__mentions" role="listbox" aria-label="选一个人">
                {mentionList.map((p) => (
                  <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => pickMention(p)}>
                    <span
                      className="q-chat__mentions__av"
                      style={p.avatar ? { backgroundImage: `url("${p.avatar}")` } : undefined}
                      aria-hidden="true"
                    >
                      {p.name.slice(0, 1)}
                    </span>
                    <span className="q-chat__mentions__n">{p.name}</span>
                    {p.admin && <em>站长</em>}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="q-chat__input"
              value={draft}
              onChange={(e) => {
                const v = e.target.value.slice(0, 500);
                setDraft(v);
                // 光标前是不是一个「刚打了一半的 @」
                const pos = e.target.selectionStart ?? v.length;
                const hit = /@([^\s@]{0,20})$/.exec(v.slice(0, pos));
                setMention(hit ? { at: pos - hit[0].length, q: hit[1] ?? '' } : null);
                // 「正在输入」上报：3 秒一次，别把接口打成 DoS
                if (v.trim() && Date.now() - lastTypingRef.current > 3000) {
                  lastTypingRef.current = Date.now();
                  void typing();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && mention) {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  // 选人弹层开着时，Enter 先当作「选第一个」
                  if (mention && mentionList.length > 0) {
                    e.preventDefault();
                    pickMention(mentionList[0]!);
                    return;
                  }
                  e.preventDefault();
                  void doSend();
                }
              }}
              onPaste={(e) => {
                // 截图直接 Ctrl+V —— 聊天里这是最常用的发图方式
                const items = e.clipboardData?.items;
                if (!items) return;
                for (const it of items) {
                  if (it.kind !== 'file') continue;
                  const f = it.getAsFile();
                  if (f) {
                    e.preventDefault();
                    void attachFile(f);
                    return;
                  }
                }
              }}
              rows={1}
              placeholder="说点什么…（@ 可以叫个人）"
              title="Enter 发送，Shift + Enter 换行，@ 提及"
              aria-label="说点什么"
            />
            <div className="q-chat__tools">
              <button
                type="button"
                className="q-chat__tool"
                aria-label="表情"
                aria-expanded={emojiOpen}
                onClick={() => setEmojiOpen((v) => !v)}
              >
                <MorphIcon icon={Smile} size={15} color="currentColor" />
              </button>
              <button
                type="button"
                className="q-chat__tool"
                aria-label="发图片或视频"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <MorphIcon icon={LoaderCircle} size={15} color="currentColor" />
                ) : (
                  <MorphIcon icon={ImageIcon} size={15} color="currentColor" />
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  // 清空 value：不然连选同一张图不会触发 change
                  e.target.value = '';
                  if (f) void attachFile(f);
                }}
              />
              {emojiOpen && (
                <EmojiPicker
                  open
                  placement="top"
                  onPick={pickEmoji}
                  onClose={() => setEmojiOpen(false)}
                />
              )}
            </div>
          </div>
          <button
            type="button"
            className="q-chat__send"
            onClick={() => void doSend()}
            disabled={sending || !draft.trim()}
            aria-label="发送"
          >
            {sending ? (
              <MorphIcon icon={LoaderCircle} size={15} color="currentColor" />
            ) : (
              <MorphIcon icon={Send} size={15} color="currentColor" />
            )}
          </button>
          {draft.length > 380 && <span className="q-chat__count">{draft.length}/500</span>}
        </div>
      ) : (
        <div className="q-chat__guest">
          <p>登录之后就能一起聊了 ~</p>
          <button type="button" onClick={() => setLoginOpen(true)}>
            登录
          </button>
        </div>
      )}

      {config && (
        <LoginDialog
          open={loginOpen}
          config={config}
          onClose={() => setLoginOpen(false)}
          onDone={(account) => {
            setLoginOpen(false);
            setSignedIn(Boolean(account));
            void init();
          }}
        />
      )}

      {searchOpen && <ChatSearch onClose={() => setSearchOpen(false)} onPick={jumpToMessage} />}
      </section>
    </div>
  );
}

/** 一条消息。自己的靠右、别人的靠左，和 IM 的肌肉记忆一致 */
function MessageRow({
  m,
  grouped,
  canRecall,
  onRecall,
  onReact,
  onReply,
  readCount,
}: {
  m: ChatMessage;
  grouped: boolean;
  canRecall: boolean;
  onRecall: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  /** 这条被多少人读完（只对「我最新那条」有意义，其余传 0） */
  readCount: number;
}) {
  // ⚠️ hook 必须在下面那个「撤回消息直接 return」之前 —— 否则两种状态的 hook
  //    数量不同，React 会报 "Rendered fewer hooks than expected"。
  const [pickOpen, setPickOpen] = useState(false);

  if (m.status === 'recalled') {
    return (
      <p className="q-chat__recalled">
        {m.mine ? '你' : m.name} 撤回了一条消息
      </p>
    );
  }

  const mine = m.mine;
  return (
    <div className={`q-chat__row${mine ? ' is-mine' : ''}${grouped ? ' is-grouped' : ''}`}>
      {!mine && (
        /**
         * 头像用 background-image 而不是 <img>：
         * 外链头像挂掉时 background 不会有「破图」占位符，底下的首字自然露出来 ——
         * 用 <img> + onError 切首字要多写一层状态，而且图还在 pending 的那几秒里
         * 会是一个空白圆（实测：本地无网时十几个空圆，很难看）。
         */
        <span
          className="q-chat__avatar"
          aria-hidden="true"
          style={m.avatar ? { backgroundImage: `url("${m.avatar}")` } : undefined}
        >
          {m.name.slice(0, 1)}
        </span>
      )}

      <div className="q-chat__body">
        {!grouped && (
          <div className="q-chat__meta">
            <span className="q-chat__name">{m.name}</span>
            {m.admin && <span className="q-chat__tag">站长</span>}
            {m.mentionedMe && <span className="q-chat__tag q-chat__tag--at">@了你</span>}
            {m.origin === 'remote' && m.site && (
              <span className="q-chat__site">来自 {m.site}</span>
            )}
            <time className="q-chat__clock" dateTime={m.at}>
              {clockOf(m.at)}
            </time>
          </div>
        )}

        <div className="q-chat__bubblewrap">
          {m.media && (
            <div className={`q-chat__media is-${m.media.kind}`}>
              {m.media.kind === 'image' ? (
                <img
                  src={mediaSrc(m.media)}
                  alt="图片"
                  loading="lazy"
                  decoding="async"
                  onClick={() => window.open(mediaSrc(m.media!), '_blank', 'noopener')}
                />
              ) : (
                <video src={mediaSrc(m.media)} controls playsInline preload="metadata" />
              )}
            </div>
          )}
          {/* 纯图消息的 body 是空串，不画空气泡 */}
          {m.body && (
            <div
              className={`q-rich q-chat__bubble${m.status === 'pending' ? ' is-pending' : ''}`}
              // renderRich 先整段转义再拼固定标签（见 src/lib/richText.ts 顶部）
              dangerouslySetInnerHTML={{ __html: renderRich(m.body) }}
            />
          )}
          {/* 引用放在正文**下面**（和微信一致）：先看谁说了什么，再看他在回哪句 */}
          {m.quote && (
            <div className="q-chat__quote" title="引用的是更早的一条">
              <b>{m.quote.name}：</b>
              <span>{m.quote.excerpt || '（空）'}</span>
            </div>
          )}
          {m.status === 'pending' && (
            <span className="q-chat__pending" title="正在过一遍审核，稍等一下">
              等一等
            </span>
          )}

          {m.reactions.length > 0 && (
            <div className="q-chat__reacts">
              {m.reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  className={`q-chat__react${r.mine ? ' is-mine' : ''}`}
                  onClick={() => onReact(r.emoji)}
                  title={r.mine ? '再点一下取消' : '也点一个'}
                >
                  <img src={EMOJI_MAP[r.emoji]?.src} alt="" loading="lazy" decoding="async" />
                  <span>{r.n}</span>
                </button>
              ))}
            </div>
          )}

          {/* 操作条：贴在气泡右侧同一水平带（自己的消息镜像到左侧）。
              位置、尺寸和「为什么不做悬停下方的窄条」见 chat.css 里 .q-chat__acts 的注释 */}
          <div className={`q-chat__acts${pickOpen ? ' has-open' : ''}`}>
            <button type="button" className="q-chat__recall" onClick={onReply}>
              回复
            </button>
            {canRecall && (
              <button type="button" className="q-chat__recall" onClick={onRecall}>
                撤回
              </button>
            )}
            {m.status === 'visible' && (
              <span className="q-chat__addreact">
                <button
                  type="button"
                  className="q-chat__plus"
                  aria-label="回应一下"
                  aria-expanded={pickOpen}
                  onClick={() => setPickOpen((v) => !v)}
                >
                  +
                </button>
                {pickOpen && (
                  <span className="q-chat__reactpop" role="group" aria-label="选一个回应">
                    {REACT_SET.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        title={r.label}
                        aria-label={r.label}
                        onClick={() => {
                          onReact(r.key);
                          setPickOpen(false);
                        }}
                      >
                        <img src={EMOJI_MAP[r.key]?.src} alt="" loading="lazy" decoding="async" />
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {readCount > 0 && <span className="q-chat__reads">已读 {readCount}</span>}
      </div>
    </div>
  );
}
