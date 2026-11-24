import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import {
  Bell,
  BellRing,
  ChevronDown,
  Download,
  FileText,
  Pencil,
  Pin,
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
  report as reportApi,
  send,
  setPin as setPinApi,
  typing,
  uploadMedia,
  edit as editApi,
  type ChatMedia,
  type ChatMember,
  type ChatMessage,
  type PinInfo,
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
/**
 * 页面在后台时的轮询间隔。
 *
 * 原来后台是**完全暂停**的，代价是两个功能其实一直是死的：
 * 页签标题的未读数字永远等不到新消息（poll 不跑就没有「新消息」），
 * 桌面通知也没有触发源。而这页恰恰是「人不在看」的时候才需要提醒。
 * 10 秒一次，空转响应 117 字节 ≈ 42 KB/小时，换来「切回来数字是对的」。
 */
const POLL_HIDDEN_MS = 10_000;
/** 连续失败几次才认定「断了」—— 偶发一次超时不该闪提示 */
const LINK_FAIL_TOLERANCE = 2;
/** 举报理由：和审核的五类同一套口径，外加一个「其他」 */
const REPORT_REASONS = [
  { key: 'spam', label: '广告 / 刷屏' },
  { key: 'abuse', label: '骂人 / 攻击' },
  { key: 'porn', label: '色情低俗' },
  { key: 'illegal', label: '违法内容' },
  { key: 'privacy', label: '泄露隐私' },
  { key: 'other', label: '其他' },
] as const;

/** 桌面提醒开关存在本机（权限是浏览器级的，偏好是本机级的） */
const NOTIFY_KEY = 'qingwu:chat-notify';

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
/** 文档上限（服务端 FILE_MIME 白名单之外的一律拒收） */
const FILE_MAX_BYTES = 5 * 1024 * 1024;

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

/**
 * 首屏快照。
 *
 * 为什么需要：`ChatRoom` 是 `client:only` 岛，Astro 的 ClientRouter 每次从别的页
 * 切回 `/chat/` 都会**重建整个岛** —— 重新拉 30 条、重新算 who，中间 250~350ms 是白屏。
 * 把上一次的首屏存进 sessionStorage，回来时先按快照铺满，再整份替换校正。
 *
 * 三条边界，写清楚免得以后被当成「数据缓存」用歪：
 *   · sessionStorage 是**本标签页**的，关掉标签就没了 —— 不做跨会话的历史缓存
 *   · TTL 90 秒。聊天内容变得快，旧快照的价值衰减得比加载耗时掉得还快
 *   · 只加速**渲染**，不改数据来源：`init()` 回来永远是整份 `setMessages` 覆盖，
 *     撤回、审核状态、已读线都由它校正。快照最多让旧内容多存在一帧
 */
const SNAP_KEY = 'qingwu:chat-snap';
const SNAP_TTL = 90 * 1000;
const SNAP_MAX = 30;

interface Snapshot {
  v: 1;
  at: number;
  /** 写快照时的账号 id。换人登录时靠它判断「这份不是我看到的」 */
  accountId: number | null;
  hasMore: boolean;
  lastId: number;
  lastRead: number;
  messages: ChatMessage[];
}

function readSnapshot(): Snapshot | null {
  try {
    const raw = window.sessionStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Snapshot;
    if (s?.v !== 1 || !Array.isArray(s.messages) || s.messages.length === 0) return null;
    if (!Number.isFinite(s.at) || Date.now() - s.at > SNAP_TTL) return null;
    return s;
  } catch {
    return null;
  }
}

function writeSnapshot(s: Omit<Snapshot, 'v' | 'at'>): void {
  try {
    window.sessionStorage.setItem(
      SNAP_KEY,
      JSON.stringify({ v: 1, at: Date.now(), ...s, messages: s.messages.slice(-SNAP_MAX) }),
    );
  } catch {
    /* 隐私模式 / 配额满：加速失效而已，功能不受影响 */
  }
}

export default function ChatRoom() {
  /**
   * 读快照。`client:only` 保证了这里不会在服务端跑，可以直接碰 window。
   * 用 ref 只读一次 —— 每次 render 都读 sessionStorage 是没必要的 IO。
   */
  const bootRef = useRef<Snapshot | null | undefined>(undefined);
  if (bootRef.current === undefined) bootRef.current = readSnapshot();
  const boot = bootRef.current;

  const [messages, setMessages] = useState<ChatMessage[]>(boot?.messages ?? []);
  const [loading, setLoading] = useState(!boot);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(boot?.hasMore ?? false);
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

  /**
   * 桌面提醒。三态：
   *   · off      —— 用户没开（默认，不主动骚扰）
   *   · on       —— 开了且浏览器已授权
   *   · denied   —— 浏览器层面被拒，再点也没用，只能去地址栏解除
   * 权限申请**必须由用户手势发起**（浏览器规则），所以只能做成一个按钮，
   * 不能在进页面时偷偷弹窗。
   */
  const [notify, setNotify] = useState<'off' | 'on' | 'denied'>('off');
  /** 轮询里读的镜像值：写在 ref 里，免得每次开关都重建 setTimeout 链 */
  const notifyOnRef = useRef(false);

  /** 连接状态：连续失败两次才显示提示条；恢复后自动收回 */
  const [link, setLink] = useState<'ok' | 'down'>('ok');
  const linkFailRef = useRef(0);

  /** 当前置顶（null = 没有）。poll 每次都带，所以站长一改，两秒内所有人可见 */
  const [pin, setPinState] = useState<PinInfo | null>(null);
  /** 正在编辑的那条（null = 不是编辑态）。输入区复用，取消就回到发新消息 */
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  /** 举报弹层的目标消息 */
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  /**
   * 拖文件进来时的投放态。
   *
   * 用计数器而不是布尔：`dragenter` / `dragleave` 在嵌套元素之间会成对狂发，
   * 直接置 true/false 会在鼠标划过一个气泡的瞬间闪一下。
   */
  const [dragging, setDragging] = useState(0);
  /**
   * 进来那一刻的最大 id。比它大的都算「新到的」，才做入场动画；
   * 首屏那批（含快照里的）不动，否则一进页面十几条一起浮上来。
   */
  const firstMaxRef = useRef(boot ? boot.lastId : -1);

  /** 「正在输入」上报节流 */
  const lastTypingRef = useRef(0);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [tip, setTip] = useState<{ kind: 'warn' | 'ok'; text: string } | null>(null);

  /**
   * 提示的寿命：**成功类 4 秒自动收，警告类留着**。
   *
   * 「开着页面放后台，有人说话会提醒你」这种话挂在输入框上方不走，
   * 会一直占一行高度；而「没连上」「太长了」这类警告得让人看清再消失。
   */
  useEffect(() => {
    if (tip?.kind !== 'ok') return;
    const t = window.setTimeout(() => setTip(null), 4000);
    return () => window.clearTimeout(t);
  }, [tip]);
  const [emojiOpen, setEmojiOpen] = useState(false);

  /** 已经传好、还没发出去的那张图 / 那段视频 */
  const [pendingMedia, setPendingMedia] = useState<ChatMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 已见过的最新 id —— poll 的游标（有快照就从快照续上，第一条 poll 才不会重复拉） */
  const lastIdRef = useRef(boot?.lastId ?? 0);
  /** 「上次看到这里」只画一次：记录读进来时的 lastRead */
  const readMarkRef = useRef(boot?.lastRead ?? 0);
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

  /**
   * 首屏：翻历史 + 认身份 + 侧栏
   *
   * `quiet` = 已经有快照铺在屏幕上，这一趟是「悄悄校正」，不该再翻白屏。
   */
  const init = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!quiet) setLoading(true);
      setFailed(false);
      try {
        const [page, who, list] = await Promise.all([
          loadHistory({ limit: 30 }),
          fetchMe(),
          fetchWho(),
        ]);
        // 整份覆盖（不是合并）—— 快照里的旧状态在这一步被彻底校正
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setOnline(page.online);
        setSignedIn(page.signedIn);
        setConfig(who.config);
        setAccount(who.account);
        setMembers(list);
        setPinState(page.pin);
        lastIdRef.current = page.messages.reduce((max, m) => Math.max(max, m.id), 0);
        readMarkRef.current = page.lastRead;
        // 冷启动（没有快照）时，首批消息不该有入场动画
        if (firstMaxRef.current < 0) firstMaxRef.current = lastIdRef.current;
        writeSnapshot({
          accountId: who.account?.id ?? null,
          hasMore: page.hasMore,
          lastId: lastIdRef.current,
          lastRead: page.lastRead,
          messages: page.messages,
        });
        // 首屏一定在底部：进来要看的是最新的
        requestAnimationFrame(() => scrollToBottom());
      } catch {
        /**
         * 有快照的时候**不切到整屏错误页**：屏幕上已经有内容了，
         * 把它换成一个「推不开门」会比什么都不做更糟。留一行小字说明它是旧的，
         * 轮询和下次进入会自己恢复正常。
         */
        if (quiet) setTip({ kind: 'warn', text: '这会儿没连上，先给你看上次的内容' });
        else setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [scrollToBottom],
  );

  useEffect(() => {
    void init({ quiet: Boolean(boot) });
  }, [init, boot]);

  /** 读本机保存的提醒偏好（权限是浏览器级的，偏好是本机级的，两个都对上才算「开」） */
  useEffect(() => {
    try {
      const wanted = window.localStorage.getItem(NOTIFY_KEY) === '1';
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'denied') setNotify('denied');
      else if (wanted && Notification.permission === 'granted') setNotify('on');
    } catch {
      /* 隐私模式读不了 localStorage：当作没开 */
    }
  }, []);

  useEffect(() => {
    notifyOnRef.current = notify === 'on';
  }, [notify]);

  /**
   * 发一条桌面提醒。**只在页面不可见时调用** —— 人就在页面上时，
   * 系统通知是噪音，标题数字和浮标已经够了。
   *
   * 用 `tag: 'changting'` 让同一段时间的提醒互相替换而不是排队；
   * 点一下就回到页面并贴底，比只把窗口提到前台更有用。
   */
  const fireNotify = useCallback(
    (income: ChatMessage[]) => {
      if (!notifyOnRef.current) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const others = income.filter((m) => !m.mine && m.status !== 'recalled');
      if (!others.length) return;
      const last = others[others.length - 1]!;
      const plain = last.body.replace(/\s+/g, ' ').trim();
      const excerpt = plain || (last.media ? (last.media.kind === 'video' ? '[视频]' : '[图片]') : '');
      const title = others.length === 1 ? `长亭 · ${last.name}` : `长亭 · ${others.length} 条新消息`;
      const body =
        others.length === 1 ? excerpt.slice(0, 60) : `最后一条来自 ${last.name}：${excerpt.slice(0, 40)}`;
      try {
        const n = new Notification(title, {
          body,
          tag: 'changting',
          icon: last.avatar || undefined,
        });
        n.onclick = () => {
          window.focus();
          scrollToBottom(true);
          n.close();
        };
      } catch {
        /* 少数浏览器要求走 ServiceWorker；失败就静默，不该因此弹错误 */
      }
    },
    [scrollToBottom],
  );

  const toggleNotify = async () => {
    if (typeof Notification === 'undefined') {
      setTip({ kind: 'warn', text: '这个浏览器不支持桌面提醒' });
      return;
    }
    if (notify === 'on') {
      try {
        window.localStorage.setItem(NOTIFY_KEY, '0');
      } catch {
        /* 忽略 */
      }
      setNotify('off');
      return;
    }
    if (Notification.permission === 'denied') {
      setTip({ kind: 'warn', text: '浏览器已经拦了提醒，去地址栏左边放行一下' });
      setNotify('denied');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      try {
        window.localStorage.setItem(NOTIFY_KEY, '1');
      } catch {
        /* 忽略 */
      }
      setNotify('on');
      setTip({ kind: 'ok', text: '开着页面放后台，有人说话会提醒你' });
    } else {
      setNotify('denied');
    }
  };

  /**
   * 快照保鲜：收到新消息 / 自己发完，把快照重写一次，3 秒节流。
   *
   * 不写的话会出现一个很怪的现象：刚收到的话，切页回来瞬间「消失」，
   * 三百毫秒后又冒出来 —— 因为快照还停在进入页面那一刻。
   * mergeMessages 在没有新内容时返回原数组，所以这个 effect 只在真有变化时触发。
   */
  const snapAtRef = useRef(boot?.at ?? 0);
  useEffect(() => {
    if (!messages.length) return;
    const now = Date.now();
    if (now - snapAtRef.current < 3000) return;
    snapAtRef.current = now;
    writeSnapshot({
      accountId: account?.id ?? null,
      hasMore,
      lastId: lastIdRef.current,
      lastRead: readMarkRef.current,
      messages,
    });
  }, [messages, hasMore, account]);

  /** 轮询：setTimeout 递归；前台 2.5 秒，后台降到 10 秒（不再完全停） */
  useEffect(() => {
    let alive = true;
    let timer = 0;

    const tick = async () => {
      if (!alive) return;
      const hidden = document.visibilityState !== 'visible';
      try {
        const r = await poll(lastIdRef.current);
        if (!alive) return;

        // 通了就把断线计数清掉；提示条只在「真断了」时出现
        linkFailRef.current = 0;
        setLink((prev) => (prev === 'ok' ? prev : 'ok'));

        setOnline(r.online);
        setSignedIn(r.signedIn);
        setTypingNames(r.typing);
        setReads(r.reads);
        setPinState((prev) => (prev?.id === r.pin?.id ? prev : r.pin));

        if (r.messages.length || r.recalled.length) {
          const incoming = r.messages;
          const atBottom = atBottomRef.current;
          setMessages((prev) => mergeMessages(prev, incoming, r.recalled));
          for (const m of incoming) lastIdRef.current = Math.max(lastIdRef.current, m.id);

          // 自己发的那条不算「新消息」—— 发送路径已经滚到底了
          const others = incoming.filter((m) => !m.mine).length;
          if (others > 0) {
            if (hidden) {
              // 人在别的标签页：累加页签数字 + 发桌面提醒，别在他回来时再滚屏
              setUnread((n) => n + others);
              fireNotify(incoming);
            } else if (!atBottom) {
              setPendingNew((n) => n + others);
            }
          }
        }
      } catch {
        /* 不弹错误：偶发超时不该让人以为聊天坏了。
           连续两次失败才亮提示条，恢复后自动收回。 */
        linkFailRef.current += 1;
        if (linkFailRef.current >= LINK_FAIL_TOLERANCE) setLink('down');
      }
      if (alive) {
        timer = window.setTimeout(
          tick,
          document.visibilityState === 'visible' ? POLL_MS : POLL_HIDDEN_MS,
        );
      }
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

    // 系统层面恢复联网：不等 10 秒，立刻验一次
    const onOnline = () => {
      window.clearTimeout(timer);
      void tick();
    };
    window.addEventListener('online', onOnline);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [fireNotify]);

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

      /**
       * 其他文件：不压、不转，原样传。
       * 白名单在服务端（`FILE_MIME`），这里只管大小 —— 客户端的检查永远可绕过，
       * 真正的门在 worker 那边。
       */
      if (file.size > FILE_MAX_BYTES) {
        setTip({ kind: 'warn', text: '文件不要超过 5 MB' });
        return;
      }
      const dataUrl = await readAsDataURL(file);
      const up = await uploadMedia(dataUrl, { filename: file.name });
      if (up.ok) setPendingMedia(up.media);
      else setTip({ kind: 'warn', text: up.message });
    } finally {
      setUploading(false);
    }
  };

  const doSend = async () => {
    /**
     * 编辑态：这次「发送」其实是**保存修改**。
     * 复用同一个输入区（而不是弹个框）—— 改一句话不该换一个界面，
     * 而且 EmojiPicker / @ / 粘贴都在原位可用。
     */
    if (editing) {
      const text = draft.trim();
      if (!text || sending) return;
      setSending(true);
      setTip(null);
      const res = await editApi(editing.id, text);
      setSending(false);
      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === editing.id
              ? { ...m, body: res.body ?? text, editedAt: res.editedAt || new Date().toISOString() }
              : m,
          ),
        );
        setEditing(null);
        setDraft('');
        setTip({ kind: 'ok', text: '改好了' });
      } else {
        setTip({ kind: 'warn', text: res.message ?? '没改成，稍后再试' });
      }
      return;
    }

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

  /** 进入编辑态：把原文放进输入区，光标落到末尾 */
  const startEdit = (m: ChatMessage) => {
    setEditing({ id: m.id, body: m.body });
    setDraft(m.body);
    setReplyTo(null);
    setPendingMedia(null);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
  };

  /** 举报：只把选择交给服务端，处置权在站长 —— 前端不做任何「自动隐藏」 */
  const doReport = async (reason: string) => {
    const target = reporting;
    if (!target || reportBusy) return;
    setReportBusy(true);
    const res = await reportApi(target.id, reason);
    setReportBusy(false);
    setReporting(null);
    setTip({ kind: res.ok ? 'ok' : 'warn', text: res.message ?? (res.ok ? '交到站长那儿了' : '没报上去') });
  };

  /** 置顶 / 取消置顶（服务端只认站长，这里只负责调用与回显） */
  const doPin = async (m: ChatMessage | null) => {
    const res = m ? await setPinApi(pin?.id === m.id ? null : m.id) : await setPinApi(null);
    if (res.ok) {
      setPinState(res.pin ?? null);
      setTip({ kind: 'ok', text: res.pin ? '置顶上去了' : '取消置顶了' });
    } else {
      setTip({ kind: 'warn', text: res.message ?? '没置顶成' });
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
   * 跳到置顶那条。
   *
   * 不主动 loadMore 去找：置顶可能是很久以前的一句，为它把几十条历史全拉进来
   * 会把滚动位置冲掉。找不到就直说「往上翻一翻」。
   */
  const jumpToPin = (id: number) => {
    const el = document.querySelector(`[data-mid="${id}"]`);
    if (!el) {
      setTip({ kind: 'warn', text: '这条更早，往上翻一翻就看到了' });
      return;
    }
    setHighlightId(id);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(() => setHighlightId(0), 2400);
  };

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
            editedAt: null,
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
      online={loading ? -1 : online}
      onLogin={() => setLoginOpen(true)}
    />
  );

  if (loading) {
    return (
      <div className="q-chat-layout">
        {aside}
        <section className="q-chat" aria-busy="true" aria-label="正在加载聊天记录">
          {/* 骨架按聊天的真实节奏摆：来一条、回一条、再来一条。
              纯装饰，读屏跳过（文字说明在最后一行）。 */}
          <div className="q-chat__skeleton" aria-hidden="true">
            <div className="q-skel-row">
              <span className="q-skel-av" />
              <div className="q-skel-body">
                <i className="q-skel-line" />
                <i className="q-skel-line" />
              </div>
            </div>
            <div className="q-skel-row is-mine">
              <span className="q-skel-av" />
              <div className="q-skel-body">
                <i className="q-skel-line" />
                <i className="q-skel-line" />
                <i className="q-skel-line" />
              </div>
            </div>
            <div className="q-skel-row">
              <span className="q-skel-av" />
              <div className="q-skel-body">
                <i className="q-skel-line" />
                <i className="q-skel-line" />
                <i className="q-skel-line" />
              </div>
            </div>
            <div className="q-skel-row is-mine">
              <span className="q-skel-av" />
              <div className="q-skel-body">
                <i className="q-skel-line" />
                <i className="q-skel-line" />
              </div>
            </div>
            <div className="q-skel-row">
              <span className="q-skel-av" />
              <div className="q-skel-body">
                <i className="q-skel-line" />
                <i className="q-skel-line" />
              </div>
            </div>
            <p className="q-chat__skeleton-note">正在推开长亭的门…</p>
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
        className={`q-chat${dragging > 0 ? ' is-drop' : ''}`}
        aria-label="长亭聊天室"
        onDragEnter={(e) => {
          if (!e.dataTransfer?.types.includes('Files')) return;
          e.preventDefault();
          setDragging((n) => n + 1);
        }}
        onDragOver={(e) => {
          // 不 preventDefault 的话浏览器会直接打开这个文件，把聊天页面顶掉
          if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!e.dataTransfer?.types.includes('Files')) return;
          setDragging((n) => Math.max(0, n - 1));
        }}
        onDrop={(e) => {
          setDragging(0);
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
          <div className="q-chat__barbtns">
            <button
              type="button"
              className={`q-chat__searchbtn${notify === 'on' ? ' is-on' : ''}`}
              onClick={() => void toggleNotify()}
              aria-pressed={notify === 'on'}
              title={
                notify === 'on'
                  ? '开着呢：页面在后台时，有人说话会弹一条系统提醒'
                  : notify === 'denied'
                    ? '浏览器拦了提醒，去地址栏左边放行'
                    : '页面放后台时，有人说话弹一条系统提醒'
              }
            >
              <MorphIcon icon={notify === 'on' ? BellRing : Bell} size={13} color="currentColor" />
              {notify === 'on' ? '提醒开' : '提醒'}
            </button>
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
        </div>

        {link === 'down' && (
          <p className="q-chat__offline" role="status">
            <i aria-hidden="true" />
            连接断了，正在重连…
          </p>
        )}

      {pin && (
        <div className="q-chat__pin">
          <span className="q-chat__pin__ic" aria-hidden="true">
            <MorphIcon icon={Pin} size={12} color="currentColor" />
          </span>
          <button type="button" className="q-chat__pin__t" onClick={() => jumpToPin(pin.id)}>
            <b>{pin.name}</b>
            <span>{pin.excerpt || '（这条没写正文）'}</span>
          </button>
          {account?.role === 'admin' && (
            <button
              type="button"
              className="q-chat__pin__x"
              onClick={() => void doPin(null)}
              aria-label="取消置顶"
              title="取消置顶"
            >
              <MorphIcon icon={X} size={11} color="currentColor" />
            </button>
          )}
        </div>
      )}

      <div
        className={`q-chat__scroll${messages.length === 0 ? ' is-empty' : ''}`}
        ref={scrollRef}
        onScroll={onScroll}
      >
        {/* role=log + aria-live：新消息进来读屏会念出来。
            只声明 additions —— 撤回、已读这些状态变化不该抢话。 */}
        <div
          className="q-chat__inner"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="聊天记录"
        >
          {hasMore && (
            <div className="q-chat__more">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? '正在翻…' : '看看更早的'}
              </button>
            </div>
          )}

          {messages.length === 0 && (
            <div className="q-chat__blank">
              {/* 一枚印章式的落点：细线方框 + 「亭」字。全站只有这一处这么用 */}
              <span className="q-chat__blank__mark" aria-hidden="true">
                亭
              </span>
              <p className="q-chat__blank__t">长亭还空着</p>
              <p className="q-chat__blank__s">坐下来说第一句。路过的人会看见，也会回你一句。</p>
              {!signedIn && (
                <button
                  type="button"
                  className="q-chat__blank__cta"
                  onClick={() => setLoginOpen(true)}
                >
                  坐下聊聊
                </button>
              )}
            </div>
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
            // 进来之后才到的消息（含自己刚发的）才做入场动画
            const fresh = firstMaxRef.current >= 0 && m.id > firstMaxRef.current;

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
                  fresh={fresh}
                  canRecall={m.mine && m.status === 'visible' && Date.now() - ts < 2 * 60 * 1000}
                  /* 和服务端同一个 5 分钟窗口：按钮显示条件不一致会出现「按钮在、点了报错」 */
                  canEdit={m.mine && m.status === 'visible' && Date.now() - ts < 5 * 60 * 1000}
                  canPin={account?.role === 'admin' && m.status === 'visible'}
                  pinned={pin?.id === m.id}
                  onRecall={() => void doRecall(m.id)}
                  onEdit={() => startEdit(m)}
                  onPin={() => void doPin(m)}
                  onReport={() => setReporting(m)}
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

      {(editing || replyTo || typingNames.length > 0 || pendingMedia) && (
        <div className="q-chat__above">
          {editing && (
            <div className="q-chat__replybar is-editing">
              <span className="q-chat__replybar__t">
                正在改这条 · Enter 保存，Esc 取消
              </span>
              <button type="button" onClick={cancelEdit} aria-label="取消编辑">
                <MorphIcon icon={X} size={11} color="currentColor" />
              </button>
            </div>
          )}
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
              ) : pendingMedia.kind === 'video' ? (
                <video src={mediaSrc(pendingMedia)} muted playsInline preload="metadata" />
              ) : (
                <span className="q-chat__pendingmedia__file">
                  <MorphIcon icon={FileText} size={14} color="currentColor" />
                  {pendingMedia.filename || '文件'}
                </span>
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
                if (e.key === 'Escape') {
                  if (mention) {
                    e.preventDefault();
                    setMention(null);
                    return;
                  }
                  // 编辑态下 Esc = 放弃这次修改，把输入区还给「发新消息」
                  if (editing) {
                    e.preventDefault();
                    cancelEdit();
                    return;
                  }
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
              /* 占位符要能在 390px 宽下**一行放完**：原来那句（@ 可以叫个人）
                 在手机上会折成两行，输入框一进页面就变高，看着像刚打了一半字 */
              placeholder={editing ? '改这句话…' : '说点什么… @ 叫人'}
              title="Enter 发送，Shift + Enter 换行，@ 提及"
              aria-label="说点什么，@ 可以提及在场的人"
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
                aria-label="发图片、视频或文件"
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
                /* 不再是 image/video 两个通配 —— 文档也要能发。
                   accept 只影响选择框的默认筛选，真正收什么由服务端白名单决定 */
                accept="image/*,video/*,.pdf,.zip,.txt,.md,.csv,.json,.epub,.docx,.xlsx,.pptx"
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
            aria-label={editing ? '保存修改' : '发送'}
            title={editing ? '保存修改（Esc 取消）' : '发送（Enter）'}
          >
            {sending ? (
              <MorphIcon icon={LoaderCircle} size={15} color="currentColor" />
            ) : editing ? (
              <MorphIcon icon={Pencil} size={14} color="currentColor" />
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

      {reporting &&
        createPortal(
          <div className="q-report" role="dialog" aria-modal="true" aria-label="举报这条消息">
            <button
              type="button"
              className="q-report__mask"
              aria-label="关掉"
              onClick={() => setReporting(null)}
            />
            <div className="q-report__box">
              <p className="q-report__t">举报给站长</p>
              <p className="q-report__s">
                {reporting.name} 的这条会标出来给站长看。不会自动删 ——
                举报不该让人说的话凭空消失。
              </p>
              <div className="q-report__opts">
                {REPORT_REASONS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    disabled={reportBusy}
                    onClick={() => void doReport(r.key)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button type="button" className="q-report__cancel" onClick={() => setReporting(null)}>
                算了
              </button>
            </div>
          </div>,
          document.body,
        )}
      </section>
    </div>
  );
}

/** 一条消息。自己的靠右、别人的靠左，和 IM 的肌肉记忆一致 */
function MessageRow({
  m,
  grouped,
  fresh,
  canRecall,
  canEdit,
  canPin,
  pinned,
  onRecall,
  onEdit,
  onPin,
  onReport,
  onReact,
  onReply,
  readCount,
}: {
  m: ChatMessage;
  grouped: boolean;
  fresh: boolean;
  canRecall: boolean;
  /** 自己的、可见的、5 分钟内 */
  canEdit: boolean;
  /** 站长，且这条可见 */
  canPin: boolean;
  /** 这条就是当前置顶 */
  pinned: boolean;
  onRecall: () => void;
  onEdit: () => void;
  onPin: () => void;
  onReport: () => void;
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
    <div
      className={`q-chat__row${mine ? ' is-mine' : ''}${grouped ? ' is-grouped' : ''}${
        fresh ? ' is-fresh' : ''
      }`}
    >
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
            {m.editedAt && (
              <span className="q-chat__edited" title={`改于 ${clockOf(m.editedAt)}`}>
                已编辑
              </span>
            )}
            <time className="q-chat__clock" dateTime={m.at}>
              {clockOf(m.at)}
            </time>
          </div>
        )}

        <div className="q-chat__bubblewrap">
          {m.media &&
            (m.media.kind === 'file' ? (
              /* 文件不挂 data-zoomable：那是给能放大的图用的，
                 文档的正确动作是「下载」，挂上去反而让点按行为变含糊 */
              <a
                className="q-chat__file"
                href={mediaSrc(m.media)}
                download={m.media.filename || undefined}
                rel="noopener"
              >
                <span className="q-chat__file__ic" aria-hidden="true">
                  <MorphIcon icon={FileText} size={16} color="currentColor" />
                </span>
                <span className="q-chat__file__meta">
                  <b>{m.media.filename || '文件'}</b>
                  <i>
                    {m.media.bytes ? `${Math.max(1, Math.round(m.media.bytes / 1024))} KB` : '点击下载'}
                  </i>
                </span>
                <span className="q-chat__file__dl" aria-hidden="true">
                  <MorphIcon icon={Download} size={15} color="currentColor" />
                </span>
              </a>
            ) : (
              /* data-zoomable：交给全站灯箱接管点击，点开停在本站，
                 能 Esc 关、能翻组里的下一张 */
              <div className={`q-chat__media is-${m.media.kind}`} data-zoomable>
                {m.media.kind === 'image' ? (
                  <img src={mediaSrc(m.media)} alt="图片" loading="lazy" decoding="async" />
                ) : (
                  <video src={mediaSrc(m.media)} controls playsInline preload="metadata" />
                )}
              </div>
            ))}

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
            {canEdit && (
              <button type="button" className="q-chat__recall" onClick={onEdit}>
                编辑
              </button>
            )}
            {canRecall && (
              <button type="button" className="q-chat__recall" onClick={onRecall}>
                撤回
              </button>
            )}
            {canPin && (
              <button type="button" className="q-chat__recall" onClick={onPin}>
                {pinned ? '取消置顶' : '置顶'}
              </button>
            )}
            {!mine && m.status === 'visible' && (
              <button
                type="button"
                className="q-chat__recall q-chat__report"
                onClick={onReport}
                title="觉得这条不合适？交给站长看"
              >
                举报
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
