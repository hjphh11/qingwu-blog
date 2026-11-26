import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import {
  ChevronDown,
  Download,
  Ellipsis,
  FileText,
  Pencil,
  Pin,
  CircleAlert,
  ImageUp as ImageIcon,
  LoaderCircle,
  Mic,
  Paperclip,
  Search,
  Send,
  Smile,
  X,
} from '../lib/icons';
import EmojiPicker from './EmojiPicker';
import LoginDialog from './auth/LoginDialog';
import ChatAside from './chat/ChatAside';
import ChatInfo from './chat/ChatInfo';
import ChatSearch from './chat/ChatSearch';
import PersonCard, { hostOf } from './chat/PersonCard';
import VoiceBubble from './chat/VoiceBubble';
import { useDialogFocus } from '../lib/useDialogFocus';
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
  setBlock,
  setPin as setPinApi,
  typing,
  uploadMedia,
  edit as editApi,
  type BlockedUser,
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

/**
 * 模态弹层（举报 / 搜索）的焦点契约。
 *
 * 三条缺一条，就是「能用鼠标、用不了键盘」：
 *   ① 打开时焦点进弹层 —— 否则第一个 Tab 从页面顶端重新开始
 *   ② Tab 在弹层内部循环 —— 实测举报弹层 Tab 8 步就能跑到弹层外（焦点落到背后的链接上，
 *      而视觉上还盖着遮罩，用户以为卡死了）
 *   ③ 关闭后焦点回到触发它的按钮 —— 否则焦点掉到 body，键盘用户得从头 Tab 一遍
 *
 * `onClose` 用 ref 存着：父组件每次渲染都会传一个新函数，
 * 直接放进依赖会让 effect 反复重跑、焦点被反复抢回第一个按钮。
 */
const DRAFT_KEY = 'qingwu:chat-draft';

/**
 * 「轻点消息可以…」那条提示只出现一次。
 *
 * 紧凑形态下操作条默认收着，入口（点一下消息）本身没有任何可见标记 ——
 * 老用户知道，第一次来的人不知道。一次性提示比常驻的小图标省地方，
 * 也不至于让每行都挂一个「…」。
 */
const TAP_HINT_KEY = 'qingwu:chat-tap-hint';

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

/**
 * 按 id 合并：新状态覆盖旧状态，被收起来的不删（要留一行提示）。
 *
 * `removed` 与 `recalled` 分开传：两者的占位话不一样（「撤回了一条消息」
 * vs「被收起来了」）。混成一个数组，前端只能挑一句写，另一句就是在替人说话。
 */
function mergeMessages(
  prev: ChatMessage[],
  incoming: ChatMessage[],
  recalled: number[],
  removed: number[] = [],
): ChatMessage[] {
  if (!incoming.length && !recalled.length && !removed.length) return prev;

  const map = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  for (const id of recalled) {
    const old = map.get(id);
    if (old && old.status !== 'recalled') map.set(id, { ...old, status: 'recalled' });
  }
  for (const id of removed) {
    const old = map.get(id);
    if (old && old.status !== 'removed') map.set(id, { ...old, status: 'removed' });
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

/** 秒数 → 「0:07」。语音最长 60 秒，不处理小时 */
function mmss(sec: number): string {
  const v = Math.max(0, Math.round(sec));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/* ——— 语音消息 ———
   60 秒是微信的上限，也是「点一下开始、再点一下结束」这个交互能忍的最长时长；
   32kbps 的 opus 一分钟约 240KB，比一段视频小两个数量级。
   桌面端为主，所以不用「按住说话」——那个手势在鼠标上很不自然（松开点偏就白录）。 */
const REC_MAX_SEC = 60;
const REC_BPS = 32_000;

/* ——— 桌面三栏的列宽（拖分隔条改的就是这两个数） ———
   默认值就是设计稿的 272 / 312；边界是「再小就放不下内容」的实测值：
   左栏 200 以内频道名要换行，右栏 240 以内公告的标题会折成两行。
   中栏 420 是输入区 + 工具排 + 发送键刚好一行的宽度。 */
const COL_KEY = 'qingwu:chat-cols-v1';
const COL_DEFAULT = { side: 272, info: 312 };
const COL_MIN = { side: 200, info: 240 };
const COL_MAX = { side: 420, info: 460 };
const CENTER_MIN = 420;

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface Snapshot {
  /**
   * 快照结构版本。**改消息字段就升一号**（不适配旧结构，直接丢弃重拉）：
   * v2 起消息带 `authorId`（屏蔽要按账号 id 摘消息），v1 的旧快照没有这个字段，
   * 留着它会让「刚屏蔽的人」继续挂在屏幕上，直到下一次整页刷新。
   */
  v: 2;
  at: number;
  /** 写快照时的账号 id。换人登录时靠它判断「这份不是我看到的」 */
  accountId: number | null;
  /**
   * 写快照时的身份（昵称 / 头像 / 站点）。
   *
   * 带上它是为了侧栏第一帧就画对：之前加载态一律落进「还没进门」的访客卡，
   * 登录身份一到又换成 60px 的我的卡 —— 侧栏和页脚一起抖。
   * 这点数据约 200 字节，换来的是首屏不再出现「我明明是登录的，却让我登录」。
   */
  account: SessionAccount | null;
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
    if (s?.v !== 2 || !Array.isArray(s.messages) || s.messages.length === 0) return null;
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
      JSON.stringify({ v: 2, at: Date.now(), ...s, messages: s.messages.slice(-SNAP_MAX) }),
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
  const [account, setAccount] = useState<SessionAccount | null>(boot?.account ?? null);
  /** 身份是否已经确认。false = 还不知道登录没登录，侧栏先画同高占位，别急着说「还没进门」 */
  const [identityReady, setIdentityReady] = useState(Boolean(boot));
  const [members, setMembers] = useState<ChatMember[]>([]);
  /** 所有来过这间屋子的人（进过门或说过话）—— 右栏「空间成员」用这份，在线那份在上边 */
  const [people, setPeople] = useState<ChatMember[]>([]);
  /** 我屏蔽了谁（单向、只有我看不见）。服务端在 who 与屏蔽接口里一起回 */
  const [blocks, setBlocks] = useState<BlockedUser[]>([]);
  /** 互联大厅的成员数（0 = 没接互联）。与「此刻在长亭 N 人」口径不同，文案分开写 */
  const [remoteMembers, setRemoteMembers] = useState(0);
  /** 正在看谁的个人主页（null = 没开）。左栏头像 / 左栏「我」/ 右栏成员行共用 */
  const [peek, setPeek] = useState<ChatMember | null>(null);

  /** 是否停在底部 —— 控制「回到最新 / N 条新消息」浮标的显隐 */
  const [atBottom, setAtBottom] = useState(true);

  /** 正在回哪一条（引用） */
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  /** 这条消息里已经 @ 了谁（发出去时一并提交） */
  const [mentionIds, setMentionIds] = useState<number[]>([]);
  /** 输入框里正在打的那个 @（null = 没在选人） */
  const [mention, setMention] = useState<{ at: number; q: string } | null>(null);
  /** @ 弹层里「展开全部成员」了没 */
  const [mentionAllOpen, setMentionAllOpen] = useState(false);
  /** @ 弹层里键盘选中的第几个（↑↓ 移动，Enter 选） */
  const [mentionIdx, setMentionIdx] = useState(0);

  /** 别人正在打字 */
  const [typingNames, setTypingNames] = useState<string[]>([]);
  /**
   * 每个「正在输入」的名字最后一次被后端报到的时刻。
   *
   * 后端窗口 6 秒、前端 3 秒报一次，两次 poll 之间（2.5 秒）本来不该断；
   * 但请求一慢就容易在窗口边缘抖成「闪一下又没了」。这里多留 4 秒 ——
   * 只比 poll 间隔长一点，既不会让「停手」看起来像还在打，又不会闪。
   */
  const typingSeenRef = useRef<Map<string, number>>(new Map());
  /** 我最新那条被读了几次 */
  const [reads, setReads] = useState<{ id: number; n: number; names: string[] } | null>(null);

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
   * 触屏上展开操作条的是哪一条（0 = 都没展开）。
   *
   * 放在这里而不是每条消息自己管：自己管的话可以同时点开好几条，
   * 屏幕上就变成「一半消息挂着按钮」；互斥才是「我正在看这一条」。
   */
  const [openActs, setOpenActs] = useState(0);
  /** 举报弹层的焦点契约（Esc / Tab 循环 / 关闭后归位） */
  const reportBoxRef = useDialogFocus(Boolean(reporting), () => setReporting(null));

  /** 窄屏抽屉：左（频道）/ 右（空间详情）。桌面宽屏下这两个类名不起作用 */
  const [sideOpen, setSideOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  /**
   * 桌面（≥1200）三栏的列宽：只有左右两栏是数，中栏吃掉剩下的。
   *
   * 为什么是「左右固定、中间自适应」而不是三栏都给像素：
   * 视口一改宽，多出来的地方应该给正在读的消息流，而不是让两侧继续长。
   * 拖分隔条改的就是这两个数，存 localStorage（`q_chat_cols_v1`）。
   * ≤1199 时两侧都是抽屉，这两个数不生效（CSS 媒体查询直接换掉模板）。
   */
  const [cols, setCols] = useState(COL_DEFAULT);
  /** 桌面上把右栏整列收起来（窄屏走抽屉，用 infoOpen）。默认展开 */
  const [infoHidden, setInfoHidden] = useState(false);
  /** 是否到了「三栏并排」的宽度，决定分隔条渲染与否 */
  const [wide, setWide] = useState(false);
  /** 正在拖哪一根分隔条（用来加高亮 + 全局光标） */
  const [splitBusy, setSplitBusy] = useState<'' | 'side' | 'info'>('');
  /**
   * 正在跑「收起 / 展开信息栏」的那一下（≈ --dur-state 340ms）。
   *
   * 列宽的过渡**只在按钮触发时**打开：常开的话，拖分隔条和改窗口大小
   * 也会被这段时长拖住，整栏像在糖浆里动。
   */
  const [infoAnim, setInfoAnim] = useState(false);
  const infoAnimTimer = useRef<number | null>(null);

  const bentoRef = useRef<HTMLDivElement>(null);
  const colDrag = useRef<{ which: 'side' | 'info'; x: number; start: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1200px)');
    const sync = () => {
      const isWide = mq.matches;
      setWide(isWide);
      // 从窄屏拖宽回来时，抽屉要收掉 —— 否则那层遮罩会留在屏幕上（整页发灰）
      if (isWide) {
        setSideOpen(false);
        setInfoOpen(false);
      }
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /** 把一组列宽夹回可用范围：两侧都要让出中栏的最小宽度 */
  const fitCols = (next: { side: number; info: number }) => {
    const el = bentoRef.current;
    const total = el?.clientWidth || Math.max(880, window.innerWidth - 80);
    const cs = el ? getComputedStyle(el) : null;
    const gap = cs ? parseFloat(cs.columnGap) || 8 : 8;
    // 实际有几条轨道（右栏收起时是 2）—— 直接读模板，比再存一份状态可靠
    const lanes = cs ? cs.gridTemplateColumns.trim().split(/\s+/).length : 3;
    // ≤1199 两侧都是抽屉，这两个数根本不生效：别拿窄屏把存的值夹小
    if (!window.matchMedia('(min-width: 1200px)').matches) return next;
    const room = total - gap * (lanes - 1) - CENTER_MIN;
    const info = clampNum(
      next.info,
      COL_MIN.info,
      Math.min(COL_MAX.info, Math.max(COL_MIN.info, room - COL_MIN.side)),
    );
    const side = clampNum(
      next.side,
      COL_MIN.side,
      Math.min(COL_MAX.side, Math.max(COL_MIN.side, room - info)),
    );
    return { side, info };
  };

  // 进来时恢复上次拖的宽度；存的值可能是在很宽的屏上拖的，所以要夹一遍。
  // 只在挂载时读一次：之后再读会把用户正在拖的宽度盖回去。
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COL_KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as { side?: number; info?: number };
      if (typeof v.side !== 'number' || typeof v.info !== 'number') return;
      setCols(fitCols({ side: v.side, info: v.info }));
    } catch {
      /* 隐私模式 / 值坏了：用默认宽度，不影响聊天 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 视口变窄时要重新夹一次，否则会把中栏挤没
  useEffect(() => {
    const onResize = () => setCols((c) => fitCols(c));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拖到一半切页/卸载：把全局光标那个类收掉，不然整站光标都变成 ←→
  useEffect(() => () => document.documentElement.classList.remove('q-colresize'), []);

  /**
   * 宽度一变就落盘。
   *
   * 放在 effect 里而不是各自的事件回调里：拖动、键盘、双击复位三条路径
   * 都能写到，且拖动过程中不写（每帧写 localStorage 毫无意义）。
   */
  useEffect(() => {
    if (splitBusy) return;
    try {
      window.localStorage.setItem(COL_KEY, JSON.stringify(cols));
    } catch {
      /* 存不下就存不下，这次拖拽本身是生效的 */
    }
  }, [cols, splitBusy]);

  const endSplit = () => {
    if (!colDrag.current) return;
    colDrag.current = null;
    setSplitBusy('');
    document.documentElement.classList.remove('q-colresize');
  };

  const startSplit = (which: 'side' | 'info') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    colDrag.current = {
      which,
      x: e.clientX,
      start: which === 'side' ? cols.side : cols.info,
    };
    setSplitBusy(which);
    document.documentElement.classList.add('q-colresize');
  };

  const moveSplit = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = colDrag.current;
    if (!d) return;
    // 左栏向右拖 = 变宽；右栏向左拖 = 变宽，所以符号相反
    const raw = d.which === 'side' ? d.start + (e.clientX - d.x) : d.start - (e.clientX - d.x);
    setCols((c) => fitCols({ ...c, [d.which]: raw }));
  };

  /** 分隔条的键盘操作：左右各 16px，省得非要动鼠标 */
  const nudgeSplit = (which: 'side' | 'info') => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    setCols((c) => fitCols({ ...c, [which]: c[which] + (which === 'side' ? dir * step : -dir * step) }));
  };

  const resetSplit = (which: 'side' | 'info') => () => {
    setCols((c) => fitCols({ ...c, [which]: COL_DEFAULT[which] }));
  };

  /** 顶栏那个「信息栏」按钮：宽屏收/展整列，窄屏开/关抽屉 */
  const toggleInfo = () => {
    if (!wide) {
      setInfoOpen((v) => !v);
      return;
    }
    // 这一段允许列宽做匀速过渡（CSS `.is-anim`），跑完再摘掉
    setInfoAnim(true);
    setInfoHidden((v) => !v);
    if (infoAnimTimer.current) window.clearTimeout(infoAnimTimer.current);
    infoAnimTimer.current = window.setTimeout(() => setInfoAnim(false), 360);
  };

  /** 面板自己头上的 ×：宽屏收起整列，窄屏关抽屉。之前只关了抽屉，宽屏点了没反应 */
  const closeInfo = () => {
    if (!wide) {
      setInfoOpen(false);
      return;
    }
    setInfoAnim(true);
    setInfoHidden(true);
    if (infoAnimTimer.current) window.clearTimeout(infoAnimTimer.current);
    infoAnimTimer.current = window.setTimeout(() => setInfoAnim(false), 360);
  };

  useEffect(
    () => () => {
      if (infoAnimTimer.current) window.clearTimeout(infoAnimTimer.current);
    },
    [],
  );

  /** 当前右栏是不是「看得见」——宽屏看整列，窄屏看抽屉 */
  const infoShown = wide ? !infoHidden : infoOpen;

  /** 是否紧凑形态（窄屏 / 触屏）—— 决定要不要出「轻点消息…」那条一次性提示 */
  const [compact, setCompact] = useState(false);
  const [tapHint, setTapHint] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px), (hover: none)');
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!compact) return;
    try {
      if (window.localStorage.getItem(TAP_HINT_KEY)) return;
    } catch {
      // 隐私模式读不到 localStorage：那就每次都提一次，不影响功能
    }
    setTapHint(true);
  }, [compact]);

  // 第一次真的展开某条，就说明「学会了」—— 立刻收回提示并记下来
  useEffect(() => {
    if (!openActs) return;
    setTapHint(false);
    try {
      window.localStorage.setItem(TAP_HINT_KEY, '1');
    } catch {
      /* 存不下也无所谓：下次进来再提一次 */
    }
  }, [openActs]);

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
  /**
   * 录音状态。`null` = 没在录；否则是已录秒数（界面上那个 0:07）。
   *
   * 秒数用 state 是为了让计时器能驱动界面；真正的时长在停止时用时间戳算
   * （`setInterval` 会被后台标签页节流，累加它会少算好几秒）。
   */
  const [recSec, setRecSec] = useState<number | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunks = useRef<Blob[]>([]);
  const recStream = useRef<MediaStream | null>(null);
  const recTimer = useRef<number | null>(null);
  const recT0 = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 图片/视频单独一个 input：手机上 `accept="image/*"` 会直接进相册，
      混进 pdf/zip 之后系统只会弹「选取文件」，多一步还得自己找相册 */
  const imageRef = useRef<HTMLInputElement>(null);

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
    const w = await fetchWho();
    setMembers(w.members);
    setPeople(w.people);
    setBlocks(w.blocks);
    setRemoteMembers(w.remote?.members ?? 0);
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
        setIdentityReady(true);
        setMembers(list.members);
        setPeople(list.people);
        setBlocks(list.blocks);
        setRemoteMembers(list.remote?.members ?? 0);
        setPinState(page.pin);
        lastIdRef.current = page.messages.reduce((max, m) => Math.max(max, m.id), 0);
        readMarkRef.current = page.lastRead;
        // 冷启动（没有快照）时，首批消息不该有入场动画
        if (firstMaxRef.current < 0) firstMaxRef.current = lastIdRef.current;
        writeSnapshot({
          accountId: who.account?.id ?? null,
          account: who.account ?? null,
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
        // 失败也要落地，否则侧栏永远停在「占位」，用户看不到登录入口
        setIdentityReady(true);
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
      const excerptOf = (m: ChatMessage) =>
        m.body.replace(/\s+/g, ' ').trim() ||
        (m.media
          ? m.media.kind === 'video'
            ? '[视频]'
            : m.media.kind === 'file'
              ? '[文件]'
              : m.media.kind === 'audio'
                ? '[语音]'
                : '[图片]'
          : '');
      /**
       * 被 @ 的那条优先当标题。
       *
       * 通知只露一行时，「XX @ 了你」比「长亭 · 3 条新消息」有用得多 ——
       * 前者是叫我，后者只是「有人说话」，而群里一直有人说话。
       */
      const atMe = others.filter((m) => m.mentionedMe).pop();
      const title = atMe
        ? `长亭 · ${atMe.name} @ 了你`
        : others.length === 1
          ? `长亭 · ${last.name}`
          : `长亭 · ${others.length} 条新消息`;
      const body = atMe
        ? excerptOf(atMe).slice(0, 60)
        : others.length === 1
          ? excerptOf(last).slice(0, 60)
          : `最后一条来自 ${last.name}：${excerptOf(last).slice(0, 40)}`;
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
      account,
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
        {
          const now = Date.now();
          const seen = typingSeenRef.current;
          for (const n of r.typing) seen.set(n, now);
          const alive: string[] = [];
          for (const [n, at] of seen) {
            if (now - at < 4000) alive.push(n);
            else seen.delete(n);
          }
          setTypingNames((prev) =>
            prev.length === alive.length && prev.every((n, i) => n === alive[i]) ? prev : alive,
          );
        }
        setReads(r.reads);
        setPinState((prev) => (prev?.id === r.pin?.id ? prev : r.pin));

        if (r.messages.length || r.recalled.length) {
          const incoming = r.messages;
          const atBottom = atBottomRef.current;
          setMessages((prev) => mergeMessages(prev, incoming, r.recalled, r.removed));
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

  /**
   * 新消息「贴底跟随」。
   *
   * 只在本来就贴着底的时候跟：`atBottomRef` 在用户往上翻的那一刻就变 false，
   * 这时硬滚会把正在看历史的人拽走 —— 这是聊天室最招人烦的行为之一。
   * 往上翻的场景由右下角的「N 条新消息」按钮兜着（`pendingNew`）。
   *
   * 为什么放在 effect 而不是 poll 回调里：消息有三条来路（轮询 / 自己发 / AI 巡查后补），
   * 而且必须等 DOM 提交完再滚 —— 在 setMessages 的同一个 tick 里滚，
   * 读到的是**旧高度**，新消息会把视口顶出底部。
   *
   * 用 `auto` 不用 `smooth`：连续来消息时平滑滚动会互相打断，看久了发晕。
   */
  useEffect(() => {
    if (!atBottomRef.current) return;
    const raf = requestAnimationFrame(() => scrollToBottom(false));
    return () => cancelAnimationFrame(raf);
  }, [messages.length, scrollToBottom]);

  /**
   * 图片消息加载完再补一次贴底。
   *
   * `<img>` 的高度是异步来的：滚到底那一刻图还没解码，`scrollHeight` 是「假底部」，
   * 图一撑开用户又被顶上去半屏。所以只在**本来就在底部**时补滚，
   * 往上翻历史时 lazy 图陆续加载也不会把人拽回来。
   */
  const followIfAtBottom = useCallback(() => {
    if (atBottomRef.current) scrollToBottom(false);
  }, [scrollToBottom]);

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
  /**
   * 一条消息发出去之后的收尾。
   *
   * 抽出来是因为现在有两个入口：点「发送」（doSend）和「图/文件传完直接发」（handleUploaded）。
   * 两边的清场动作必须一模一样 —— 漏一个就会出现「图已经发出去了、草稿还挂在输入框里」。
   */
  const afterSent = (message: ChatMessage) => {
    setDraft('');
    // 发出去之后引用、@、待发媒体都该清掉 —— 留着会让下一条莫名其妙也带上
    setReplyTo(null);
    setMentionIds([]);
    setMention(null);
    setPendingMedia(null);
    setMessages((prev) => mergeMessages(prev, [message], []));
    lastIdRef.current = Math.max(lastIdRef.current, message.id);
    setEmojiOpen(false);
    requestAnimationFrame(() => scrollToBottom(true));
    inputRef.current?.focus();
    // 发言数变了 —— 侧栏的「累计发言 / 再聊几句」要跟着走，别等 30 秒
    void refreshWho();
  };

  /**
   * 上传成功后怎么处置这张图 / 这个文件。
   *
   * · 没在打字 ⇒ **直接作为独立一条发出去**（选完就发，不用再点一次发送）
   * · 正在打字 ⇒ 挂成待发，把话说完一起发 —— 这种场景下「图 + 说明」本来就是一体的
   * · 发送失败 ⇒ 退回待发状态，图不能丢，点发送还能再试
   */
  const handleUploaded = async (media: ChatMedia) => {
    if (draft.trim()) {
      setPendingMedia(media);
      return;
    }
    setSending(true);
    setTip(null);
    const res = await send('', { replyTo: 0, mentions: [], mediaId: media.id });
    setSending(false);
    if (res.ok) afterSent(res.message);
    else {
      setPendingMedia(media);
      setTip({ kind: 'warn', text: res.message });
    }
  };

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
        if (up.ok) await handleUploaded(up.media);
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
        if (up.ok) await handleUploaded(up.media);
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
      if (up.ok) await handleUploaded(up.media);
      else setTip({ kind: 'warn', text: up.message });
    } finally {
      setUploading(false);
    }
  };

  /**
   * 挑一个浏览器认的录音容器。
   *
   * Chrome / Android 只有 `audio/webm`（opus），Safari / iOS 只有 `audio/mp4`
   * —— 两边都不支持对方的那个，所以**必须问** `isTypeSupported`，
   * 不能写死一个然后指望它到处能用。返回空串就让 MediaRecorder 自己挑默认。
   */
  const pickRecMime = (): string => {
    if (typeof MediaRecorder === 'undefined') return '';
    const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const m of list) {
      try {
        if (MediaRecorder.isTypeSupported?.(m)) return m;
      } catch {
        /* 老浏览器没有这个静态方法：直接走默认 */
      }
    }
    return '';
  };

  /**
   * 造一个 MediaRecorder，**三级降级**。
   *
   * 为什么不能只 `new MediaRecorder(stream, { mimeType, audioBitsPerSecond })`：
   * 部分安卓内核（厂商自带浏览器、旧 WebView）`isTypeSupported('audio/webm;codecs=opus')`
   * 明明回 true，真构造时却抛 `NotSupportedError`；指定 `audioBitsPerSecond` 也有同样毛病。
   * 站长的手机就是这样 —— 麦克风权限给了、`getUserMedia` 也成功，卡在构造这一步，
   * 却被下面那个 catch 统一报成了「没权限」，所以怎么看都是「明明允许了还说没权限」。
   *
   * 顺序：mime + 码率 → 只给码率 → 只给 mime → 什么都不给（让浏览器自己挑，最保险）。
   */
  const makeRecorder = (stream: MediaStream): MediaRecorder => {
    const mime = pickRecMime();
    const tries: MediaRecorderOptions[] = [
      ...(mime ? [{ mimeType: mime, audioBitsPerSecond: REC_BPS }] : []),
      { audioBitsPerSecond: REC_BPS },
      ...(mime ? [{ mimeType: mime }] : []),
      {},
    ];
    let lastErr: unknown = null;
    for (const opts of tries) {
      try {
        return new MediaRecorder(stream, opts);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  };

  const stopRecTracks = () => {
    recStream.current?.getTracks().forEach((t) => t.stop());
    recStream.current = null;
  };

  /** 停止录音并上传。`stop()` 之后由 `onstop` 收尾（那里才拿得到完整数据） */
  const stopRec = () => {
    if (recTimer.current !== null) {
      window.clearInterval(recTimer.current);
      recTimer.current = null;
    }
    const mr = recRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
  };

  /** 录音 → 上传 → 直接发出去（语音没有「待发送」预览这一步，和微信一致） */
  const sendVoice = async (blob: Blob, sec: number) => {
    setUploading(true);
    try {
      const dataUrl = await readAsDataURL(blob);
      const up = await uploadMedia(dataUrl, { duration: sec });
      if (!up.ok) {
        setTip({ kind: 'warn', text: up.message });
        return;
      }
      const res = await send('', { mediaId: up.media.id });
      if (!res.ok) {
        setTip({ kind: 'warn', text: res.message });
        if (res.reason === 'login') setLoginOpen(true);
        return;
      }
      setMessages((prev) => mergeMessages(prev, [res.message], []));
      lastIdRef.current = Math.max(lastIdRef.current, res.message.id);
      requestAnimationFrame(() => scrollToBottom(true));
      void refreshWho();
    } catch {
      setTip({ kind: 'warn', text: '这段语音没传上去，再录一次？' });
    } finally {
      setUploading(false);
    }
  };

  const startRec = async () => {
    if (!signedIn) {
      setLoginOpen(true);
      return;
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setTip({ kind: 'warn', text: '这个浏览器不支持录音，换个浏览器或者发文字吧' });
      return;
    }
    setTip(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStream.current = stream;
      const mr = makeRecorder(stream);

      recChunks.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recChunks.current.push(e.data);
      };
      mr.onstop = () => {
        const sec = Math.max(1, Math.round((Date.now() - recT0.current) / 1000));
        const blob = new Blob(recChunks.current, { type: mr.mimeType || 'audio/webm' });
        recRef.current = null;
        setRecSec(null);
        stopRecTracks();
        // 小于 ~1KB 基本是「点错了两下」，传上去只是一段杂音
        if (blob.size < 1200) {
          setTip({ kind: 'warn', text: '这段太短了，说一句再停？' });
          return;
        }
        void sendVoice(blob, sec);
      };

      recT0.current = Date.now();
      recRef.current = mr;
      setRecSec(0);
      mr.start();

      recTimer.current = window.setInterval(() => {
        const sec = Math.round((Date.now() - recT0.current) / 1000);
        setRecSec(sec);
        // 到上限自动停：不然录到 5 分钟才发现传不上去
        if (sec >= REC_MAX_SEC) stopRec();
      }, 250);
    } catch (err) {
      stopRecTracks();
      setRecSec(null);
      /**
       * 别再一律报「没拿到麦克风权限」—— 权限给了还失败才是最常遇到的：
       * 构造 MediaRecorder 抛 NotSupportedError、麦克风被别的 App 占着（NotReadableError），
       * 都会走到这里。分不清就只能让人反复去查那个小锁。
       */
      const name = (err as { name?: string } | null)?.name ?? '';
      console.warn('[chat] 录音启动失败:', name || '(no name)', err);
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setTip({ kind: 'warn', text: '没拿到麦克风权限，看看浏览器地址栏那个小锁' });
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setTip({ kind: 'warn', text: '没找到可用的麦克风，插个耳机再试' });
      } else if (name === 'NotReadableError' || name === 'AbortError') {
        setTip({ kind: 'warn', text: '麦克风被别的应用占着，关掉通话/录音再试' });
      } else {
        setTip({ kind: 'warn', text: '这个浏览器录不了音，换 Chrome 或 Edge 试试' });
      }
    }
  };

  const toggleRec = () => {
    if (recSec !== null) stopRec();
    else void startRec();
  };

  // 切走 / 卸载时收干净：麦克风不关会一直亮着那个红点
  useEffect(
    () => () => {
      if (recTimer.current !== null) window.clearInterval(recTimer.current);
      const mr = recRef.current;
      if (mr && mr.state !== 'inactive') mr.stop();
      recStream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

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
      afterSent(res.message);
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
    setMentionAllOpen(false);
    setMentionIdx(0);
    requestAnimationFrame(() => {
      el?.focus();
      const p = Math.min(mention.at + insert.length, next.length);
      el?.setSelectionRange(p, p);
    });
  };

  /**
   * @ 候选：**所有来过这间屋子的人**，不只是此刻在线的。
   *
   * 原来只从 `members`（在线）里取 —— 想 @ 一个刚走开两分钟的人就找不到，
   * 而草稿里那句「@他一下」其实等他在线了再发也来得及。
   * 排序：在线的在前，其次是站长，其余按后端给的「最近在场」顺序。
   *
   * 先摆 6 个（弹层不挡输入区），要更全就点底部那颗「查看全部」。
   */
  const mentionPool = people.length ? people : members;
  const mentionList = mention
    ? mentionPool
        .filter((m) => !mention.q || m.name.toLowerCase().includes(mention.q.toLowerCase()))
        .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.admin ? 1 : 0) - (a.admin ? 1 : 0))
        .slice(0, mentionAllOpen ? 200 : 6)
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
            authorId: hit.authorId,
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
            // 搜索结果只带正文，不带卡片：滚过去之后那次 poll 会把真正的媒体/链接补上
            link: null,
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
  /**
   * 开人卡：顺手把两侧抽屉收掉。
   *
   * 手机上人卡（z 84）会盖在抽屉（60）和遮罩（55）上面，不收的话关掉人卡
   * 背后还压着一层半透明遮罩，看着像没关干净。桌面宽屏这两个状态本来就是 false。
   */
  const openPeek = (m: ChatMember) => {
    setSideOpen(false);
    setInfoOpen(false);
    setPeek(m);
  };

  /**
   * 屏蔽 / 取消屏蔽。
   *
   * 屏蔽要**当场生效**：服务端下一次 poll 起就不再给这个人的消息了，但屏幕上
   * 已经加载的那些得立刻摘掉 —— 否则要等刷新，用户会以为没成功，再点一次。
   *
   * 取消屏蔽相反：服务端不再过滤，可本地列表里并没有那些旧消息，
   * 所以走一次安静的重载把它们拉回来（也顺手校正了屏蔽期间的遗漏）。
   */
  const toggleBlock = async (target: { id: number; name: string }) => {
    const on = !blocks.some((b) => b.id === target.id);
    const r = await setBlock(target.id, on);
    if (!r.ok) {
      setTip({ kind: 'warn', text: r.message });
      if (r.reason === 'login') setLoginOpen(true);
      return;
    }
    setBlocks(r.blocks);
    if (on) {
      // `?? 0` 只是兜底（快照已升到 v2，正常消息都带 authorId），别让 undefined 漏过判断
      setMessages((prev) => prev.filter((m) => (m.authorId ?? 0) !== target.id || m.mine));
      // 名单里也立刻摘掉：右栏那张卡还要显示「N 人来过」，不能等他下次刷新
      setMembers((prev) => prev.filter((m) => m.id !== target.id));
      setPeople((prev) => prev.filter((m) => m.id !== target.id));
      setTypingNames((prev) => prev.filter((n) => n !== target.name));
      setTip({ kind: 'ok', text: `已屏蔽 ${target.name}` });
    } else {
      setTip({ kind: 'ok', text: `已取消屏蔽 ${target.name}` });
      void init({ quiet: true });
    }
  };

  const side = (
    <ChatAside
      account={account}
      members={members}
      people={people}
      identityPending={!identityReady}
      online={loading ? -1 : online}
      notify={notify}
      open={sideOpen}
      onToggleNotify={() => void toggleNotify()}
      onSearch={() => {
        setSideOpen(false);
        setSearchOpen(true);
      }}
      onLogin={() => setLoginOpen(true)}
      onClose={() => setSideOpen(false)}
      onPick={openPeek}
    />
  );

  const spaceInfo = (
    <ChatInfo
      members={members}
      people={people}
      blocks={blocks}
      online={loading ? -1 : online}
      pin={pin}
      loading={loading}
      open={infoOpen}
      collapsed={wide && infoHidden}
      onClose={closeInfo}
      onPick={openPeek}
      onUnblock={toggleBlock}
      remoteMembers={remoteMembers}
    />
  );

  /** 窄屏抽屉打开时的遮罩：点哪儿都能收 */
  const drawerMask = (
    <button
      type="button"
      className="q-mask"
      aria-label="收起浮层"
      onClick={() => {
        setSideOpen(false);
        setInfoOpen(false);
      }}
    />
  );

  if (loading) {
    return (
      <div className="q-chatpage">
        <div
          className={`q-bento${wide && infoHidden ? ' is-noinfo' : ''}`}
          style={
            {
              '--side-w': `${cols.side}px`,
              '--info-w': `${cols.info}px`,
            } as React.CSSProperties
          }
        >
          {side}
          <section className="q-chat q-glass" aria-busy="true" aria-label="正在加载聊天记录">
            <header className="q-chat__bar">
              <div className="q-chat__head">
                <div style={{ minWidth: 0 }}>
                  <h2 className="q-chat__title"># 综合大厅</h2>
                  <p className="q-chat__sub">正在推开长亭的门…</p>
                </div>
              </div>
            </header>
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
              <p className="q-chat__skeleton-note">正在推开长亭的门…</p>
            </div>
          </section>
          {spaceInfo}
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="q-chatpage">
        <div
          className={`q-bento${wide && infoHidden ? ' is-noinfo' : ''}`}
          style={
            {
              '--side-w': `${cols.side}px`,
              '--info-w': `${cols.info}px`,
            } as React.CSSProperties
          }
        >
          {side}
          <section className="q-chat q-glass" aria-label="长亭聊天室">
            <div className="q-chat__empty">
              <MorphIcon icon={CircleAlert} size={18} color="currentColor" />
              <span>长亭的门暂时推不开，稍后再来看看</span>
              <div className="q-chat__retry">
                <button type="button" onClick={() => void init()}>
                  再试一次
                </button>
              </div>
            </div>
          </section>
          {spaceInfo}
        </div>
      </div>
    );
  }

  return (
    <div className="q-chatpage">
      {!wide && (sideOpen || infoOpen) && drawerMask}

      <div
        ref={bentoRef}
        className={`q-bento${wide && infoHidden ? ' is-noinfo' : ''}${infoAnim ? ' is-anim' : ''}${
          splitBusy ? ' is-colresize' : ''
        }`}
        style={
          {
            '--side-w': `${cols.side}px`,
            '--info-w': `${cols.info}px`,
          } as React.CSSProperties
        }
      >
        {side}

        <section
          className={`q-chat q-glass${dragging > 0 ? ' is-drop' : ''}`}
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
          <header className="q-chat__bar">
            {/* 窄屏才有：打开左侧频道抽屉 */}
            <button
              type="button"
              className="q-chat__searchbtn q-chat__menu"
              onClick={() => setSideOpen(true)}
              aria-label="打开频道栏"
            >
              {/* 自绘「左边一条栏」：和站内导航的汉堡区分开，否则手机顶部会并排两个汉堡 */}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <path d="M9 4v16" />
              </svg>
            </button>

            <div className="q-chat__head">
              <div style={{ minWidth: 0 }}>
                <div className="q-chat__titlerow">
                  <h2 className="q-chat__title"># 综合大厅</h2>
                  <span className="q-chat__live">
                    <i aria-hidden="true" />
                    {/* 「还没有人在」缺宾语 —— 在长亭里，「在」的宾语就是长亭 */}
                    {online > 0 ? `${online} 人在线` : '还没人在'}
                  </span>
                </div>
                <p className="q-chat__sub">推门即见的暖光客厅，分享此刻的灵感与茶香</p>
              </div>
            </div>

            <div className="q-chat__barbtns">
              <button
                type="button"
                className="q-chat__searchbtn"
                onClick={() => setSearchOpen(true)}
                aria-label="搜索聊天记录"
                title="搜索聊天记录"
              >
                <MorphIcon icon={Search} size={16} color="currentColor" />
              </button>
              <button
                type="button"
                className={`q-chat__searchbtn${!wide && infoOpen ? ' is-on' : ''}${
                  wide && infoHidden ? ' is-off' : ''
                }`}
                onClick={toggleInfo}
                aria-expanded={infoShown}
                aria-controls="q-chat-info"
                aria-label={infoShown ? '收起信息栏' : '展开信息栏'}
                title={infoShown ? '收起信息栏' : '展开信息栏'}
              >
                {/* 自绘：一块面板 + 一条竖分隔，和设计稿的图标同一个语义 */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <path d="M15 4v16" />
                </svg>
                <span className="q-btnlabel">信息栏</span>
              </button>
            </div>
          </header>

          {/* 置顶：常驻在消息流上方，点它跳过去 */}
          {pin && (
            <div className="q-chat__pin">
              <span className="q-chat__pin__ic" aria-hidden="true">
                <MorphIcon icon={Pin} size={12} color="currentColor" />
              </span>
              <button
                type="button"
                className="q-chat__pin__t"
                onClick={() => jumpToPin(pin.id)}
                /* 两个 span 之间只有 CSS 的 gap，读屏会把「谁」和「说什么」连成一串；
                   给它一句完整的话，顺便说明点它会做什么 */
                aria-label={`${pin.name} 置顶：${pin.excerpt || '这条没写正文'}（跳到这条）`}
              >
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

          {/* 一次性操作提示。放在消息流外：消息流是 role=log + aria-live，
              塞进去会被读屏当成一条新消息念出来。
              ⚠️ 访客别说「可以回复、回应或举报」—— 那三件事都要登录。 */}
          {tapHint && messages.length > 0 && (
            <p className="q-chat__taphint">
              {signedIn ? '轻点一条消息，可以回复、回应或举报' : '登录之后才能回复、回应或举报'}
            </p>
          )}

          {link === 'down' && (
            <p className="q-chat__offline" role="status">
              <i aria-hidden="true" />
              连接断了，正在重连…
            </p>
          )}

          {/* tabIndex=0：可滚动区域必须能被键盘聚焦，否则键盘/读屏用户既读不到历史，
              也没法用方向键往下翻（WCAG 2.1.1）。只加在容器上，不落到每条消息里。 */}
          <div
            className={`q-chat__scroll${messages.length === 0 ? ' is-empty' : ''}`}
            ref={scrollRef}
            onScroll={onScroll}
            tabIndex={0}
            role="region"
            aria-label="聊天记录，可用方向键滚动"
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
                  <p className="q-chat__blank__s">
                    坐下来说第一句。路过的人会看见，也会回你一句。
                  </p>
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
                  prev &&
                  prev.name === m.name &&
                  prev.status !== 'recalled' &&
                  m.status !== 'recalled';
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
                      /* 上面刚画过时间线就不再重复时刻：同一条消息上出现两个相同的时间，
                         读者要花一秒确认「这俩是一个时间吗」 */
                      showClock={!splitTime}
                      actsOpen={openActs === m.id}
                      onToggleActs={() => setOpenActs((v) => (v === m.id ? 0 : m.id))}
                      canRecall={
                        m.mine && m.status === 'visible' && Date.now() - ts < 2 * 60 * 1000
                      }
                      /* 和服务端同一个 5 分钟窗口：条件不一致会出现「按钮在、点了报错」 */
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
                      readNames={reads?.id === m.id ? reads.names : undefined}
                      onMediaLoad={followIfAtBottom}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* 「回到最新」要浮在输入区**上方**，不能压在输入框上。
              用一个 0 高度的定位壳贴在输入区前面：按钮绝对定位在壳的上沿，
              因而永远比输入区高半个指头，也不会吃掉布局高度。 */}
          {!atBottom && (
            <div className="q-chat__jumpwrap">
              <button type="button" className="q-chat__jump" onClick={() => scrollToBottom(true)}>
                <MorphIcon icon={ChevronDown} size={13} color="currentColor" />
                {pendingNew > 0 ? `${pendingNew} 条新消息` : '回到最新'}
              </button>
            </div>
          )}

          {(editing ||
            replyTo ||
            typingNames.length > 0 ||
            pendingMedia ||
            tip ||
            recSec !== null) && (
            <div className="q-chat__above">
              {/*
                录音条：只在录的时候存在。它替换的是「你正在说什么」这件事 ——
                没有反馈的话，用户不知道自己到底有没有在录。
              */}
              {recSec !== null && (
                <div className="q-chat__rec" role="status">
                  <i className="q-chat__rec__dot" aria-hidden="true" />
                  <b className="q-chat__rec__t">{mmss(recSec)}</b>
                  <span className="q-chat__rec__hint">
                    {recSec >= REC_MAX_SEC - 5
                      ? `最多 ${REC_MAX_SEC} 秒，马上就到`
                      : `最长 ${REC_MAX_SEC} 秒 · 再点一下麦克风结束`}
                  </span>
                  <button type="button" className="q-chat__rec__end" onClick={stopRec}>
                    结束并发送
                  </button>
                </div>
              )}
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
                    aria-label="不用这个附件了"
                  >
                    <MorphIcon icon={X} size={11} color="currentColor" />
                  </button>
                </div>
              )}
              {typingNames.length > 0 && (
                <p className="q-chat__typing" aria-live="polite">
                  {/* 头像比名字先被看见：名字可能是「茶客#7」这种，头像一眼认得 */}
                  {typingNames.slice(0, 2).map((n) => {
                    const who = members.find((x) => x.name === n);
                    return (
                      <span key={n} className="q-chat__typingav" aria-hidden="true">
                        {n.slice(0, 1)}
                        {who?.avatar && (
                          <img
                            src={who.avatar}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        )}
                      </span>
                    );
                  })}
                  {typingNames.slice(0, 2).join('、')}
                  {typingNames.length > 2 ? ` 等 ${typingNames.length} 人` : ''} 正在输入
                  <i />
                  <i />
                  <i />
                </p>
              )}
              {/*
                提示是**浮起来的小框**，不是占一行的高条。
                它绝对定位在 `.q-chat__above` 上方 —— 那一层没有别的子项时高度是 0，
                所以既不会把输入区顶下去，也不会把最后一条消息挤走。
              */}
              {tip && (
                <p className={`q-chat__toast${tip.kind === 'ok' ? ' is-ok' : ''}`} role="status">
                  {tip.text}
                </p>
              )}
            </div>
          )}

          {signedIn ? (
            <div className="q-chat__composer">
              <div className="q-chat__inputwrap">
                {mention && mentionList.length > 0 && (
                  <div className="q-chat__mentions" role="listbox" aria-label="选择要提及的人">
                    <div className="q-chat__mentions__head" aria-hidden="true">
                      <span>提及</span>
                      <i>对方开着提醒时会收到通知</i>
                    </div>
                    {mentionList.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={i === mentionIdx}
                        className={i === mentionIdx ? 'is-active' : ''}
                        onClick={() => pickMention(p)}
                        onMouseEnter={() => setMentionIdx(i)}
                      >
                        <span
                          className="q-chat__mentions__av"
                          style={p.avatar ? { backgroundImage: `url("${p.avatar}")` } : undefined}
                          aria-hidden="true"
                        >
                          {p.name.slice(0, 1)}
                        </span>
                        <span className="q-chat__mentions__n">{p.name}</span>
                        {/* 右侧一行小字交代「他是谁」：在不在、从哪个站来、是不是站长 */}
                        <span className="q-chat__mentions__meta">
                          {p.online ? '此刻在长亭' : hostOf(p.site) || '本站'}
                          {p.admin ? ' · 站长' : ''}
                        </span>
                      </button>
                    ))}
                    {!mentionAllOpen && mentionPool.length > mentionList.length && (
                      <button
                        type="button"
                        className="q-chat__mentions__all"
                        onClick={() => {
                          setMentionAllOpen(true);
                          setMentionIdx(mentionList.length);
                        }}
                      >
                        查看全部 {mentionPool.length} 位成员并 @ 提及
                      </button>
                    )}
                  </div>
                )}

                <div className="q-chat__tools">
                  <button
                    type="button"
                    className="q-chat__tool"
                    aria-label="表情"
                    aria-expanded={emojiOpen}
                    onClick={() => setEmojiOpen((v) => !v)}
                  >
                    <MorphIcon icon={Smile} size={17} color="currentColor" />
                  </button>
                  <button
                    type="button"
                    className="q-chat__tool"
                    aria-label="发图片或视频（手机会直接打开相册）"
                    onClick={() => imageRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <MorphIcon icon={LoaderCircle} size={17} color="currentColor" />
                    ) : (
                      <MorphIcon icon={ImageIcon} size={17} color="currentColor" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="q-chat__tool"
                    aria-label="添加附件"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                  >
                    <MorphIcon icon={Paperclip} size={17} color="currentColor" />
                  </button>
                  <button
                    type="button"
                    className={`q-chat__tool${recSec !== null ? ' is-rec' : ''}`}
                    aria-label={recSec !== null ? '结束录音并发送' : '录一段语音'}
                    aria-pressed={recSec !== null}
                    onClick={toggleRec}
                    disabled={uploading || sending}
                  >
                    <MorphIcon icon={Mic} size={17} color="currentColor" />
                  </button>
                  <input
                    ref={imageRef}
                    type="file"
                    /* 只认图/视频：手机上点图片按钮会**直接进相册**，不再先弹「选取文件」。
                       ⚠️ 别加 capture —— 加了就只能拍照，选不了相册里已有的照片。 */
                    accept="image/*,video/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      // 清空 value：不然连选同一张图不会触发 change
                      e.target.value = '';
                      if (f) void attachFile(f);
                    }}
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    /* 附件只列文档类。accept 只影响选择框的筛选，真正收什么由服务端白名单决定 */
                    accept=".pdf,.zip,.txt,.md,.csv,.json,.epub,.docx,.xlsx,.pptx"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
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
                    if (hit) {
                      // 关键词变了就回到第一个，别让人按键时选中项还停在老的
                      if (mention?.q !== (hit[1] ?? '')) setMentionIdx(0);
                      setMention({ at: pos - hit[0].length, q: hit[1] ?? '' });
                    } else {
                      setMention(null);
                      setMentionAllOpen(false);
                    }
                    // 「正在输入」上报：3 秒一次，别把接口打成 DoS
                    if (v.trim() && Date.now() - lastTypingRef.current > 3000) {
                      lastTypingRef.current = Date.now();
                      void typing();
                    }
                  }}
                  onKeyDown={(e) => {
                    // @ 弹层开着：↑↓ 在候选里走，Enter 选中的那个（见下面那一段）
                    if (mention && mentionList.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                      e.preventDefault();
                      const n = mentionList.length;
                      setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
                      return;
                    }
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
                        pickMention(mentionList[Math.min(mentionIdx, mentionList.length - 1)]!);
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
                  /* 占位符要能在 390px 宽下一行放完，否则输入框一进页面就变高
                     （placeholder 换行会抬高 scrollHeight，自动增高逻辑把它当真内容） */
                  placeholder={editing ? '改这句话…' : '写点什么吧…支持 Markdown'}
                  title="Enter 发送，Shift + Enter 换行，@ 提及"
                  aria-label="说点什么，@ 可以提及在场的人"
                />

                {/*
                  底栏：工具在左，快捷键提示跟在后面，字数被 margin-left:auto 推到右边，
                  发送键单独贴在末尾 —— 它不跟工具挤在一起，手指不会误触。
                  窄屏（≤1279）和触屏会把提示藏掉：那里既没有 Enter 键、也没有 Shift。
                */}
                <span className="q-chat__hint" aria-hidden="true">
                  Enter 发送 · Shift + Enter 换行
                </span>
                <span className="q-chat__count" aria-hidden="true">
                  {draft.length}/500
                </span>

                <button
                  type="button"
                  className="q-chat__send"
                  onClick={() => void doSend()}
                  disabled={sending || !draft.trim()}
                  aria-label={editing ? '保存修改' : '发送'}
                  title={editing ? '保存修改（Esc 取消）' : '发送（Enter）'}
                >
                  <span className="q-btnlabel">{editing ? '保存' : '发送'}</span>
                  {sending ? (
                    <MorphIcon icon={LoaderCircle} size={15} color="currentColor" />
                  ) : editing ? (
                    <MorphIcon icon={Pencil} size={14} color="currentColor" />
                  ) : (
                    <MorphIcon icon={Send} size={15} color="currentColor" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="q-chat__composer">
              <div className="q-chat__guest">
                <p>登录之后就能一起聊了 ~</p>
                <button type="button" onClick={() => setLoginOpen(true)}>
                  登录
                </button>
              </div>
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
                <div className="q-report__box" ref={reportBoxRef}>
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
                  <button
                    type="button"
                    className="q-report__cancel"
                    onClick={() => setReporting(null)}
                  >
                    算了
                  </button>
                </div>
              </div>,
              document.body,
            )}
        </section>

        {spaceInfo}

        {/* 两根分隔条：只在三栏并排时出现，拖它改左右两栏的宽度。
            宽 20px、高整栏 —— 视觉只有中间一小截握把，其余是透明命中区。 */}
        {wide && (
          <>
            <div
              className={`q-split q-split--left${splitBusy === 'side' ? ' is-drag' : ''}`}
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动调整频道栏宽度"
              aria-valuenow={cols.side}
              aria-valuemin={COL_MIN.side}
              aria-valuemax={COL_MAX.side}
              tabIndex={0}
              onPointerDown={startSplit('side')}
              onPointerMove={moveSplit}
              onPointerUp={endSplit}
              onPointerCancel={endSplit}
              onKeyDown={nudgeSplit('side')}
              onDoubleClick={resetSplit('side')}
            />
            {!infoHidden && (
              <div
                className={`q-split q-split--right${splitBusy === 'info' ? ' is-drag' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整信息栏宽度"
                aria-valuenow={cols.info}
                aria-valuemin={COL_MIN.info}
                aria-valuemax={COL_MAX.info}
                tabIndex={0}
                onPointerDown={startSplit('info')}
                onPointerMove={moveSplit}
                onPointerUp={endSplit}
                onPointerCancel={endSplit}
                onKeyDown={nudgeSplit('info')}
                onDoubleClick={resetSplit('info')}
              />
            )}
          </>
        )}
      </div>

      {/* 个人主页：三个入口共用 —— 右栏成员行 / 左栏「此刻在长亭」的头像 /
          左栏底部那张「我」。人卡本身挂 portal，放这儿只是取状态。 */}
      {peek && (
        <PersonCard
          m={peek}
          self={!!account && peek.id === account.id}
          blocked={blocks.some((b) => b.id === peek.id)}
          onToggleBlock={toggleBlock}
          account={account}
          /**
           * 刚存完资料：会话立刻换成新的（左栏「我」跟着改名换头像），
           * 名单也重新拉一遍；人卡手里的 `peek` 是一份快照，得手动并一下 ——
           * 否则名字要等 30 秒后的下次轮询才变。
           */
          onAccount={(a) => {
            setAccount(a);
            void refreshWho();
            if (a) {
              setPeek((p) =>
                p && p.id === a.id
                  ? {
                      ...p,
                      name: a.name,
                      avatar: a.avatar,
                      site: a.site,
                      bio: a.bio,
                      admin: a.role === 'admin',
                      online: true,
                    }
                  : p,
              );
            }
          }}
          onClose={() => setPeek(null)}
        />
      )}
    </div>
  );

}

/** 一条消息。自己的靠右、别人的靠左，和 IM 的肌肉记忆一致 */
function MessageRow({
  m,
  grouped,
  fresh,
  showClock,
  actsOpen,
  onToggleActs,
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
  readNames,
  onMediaLoad,
}: {
  m: ChatMessage;
  grouped: boolean;
  fresh: boolean;
  /** 上面是否已经画过时间线（画过就不再重复时刻） */
  showClock: boolean;
  /** 触屏上这条的操作条是否展开（同一时刻只有一条展开，状态在 ChatRoom 里） */
  actsOpen: boolean;
  onToggleActs: () => void;
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
  /** 是谁读的（最多 5 个名字），只用来做悬停提示 */
  readNames?: string[];
  /** 图/卡片图撑开高度后回调一次（父组件用它做「贴底跟随」） */
  onMediaLoad?: () => void;
}) {
  // ⚠️ hook 必须在下面那个「撤回消息直接 return」之前 —— 否则两种状态的 hook
  //    数量不同，React 会报 "Rendered fewer hooks than expected"。
  const [pickOpen, setPickOpen] = useState(false);
  const reactWrapRef = useRef<HTMLSpanElement | null>(null);

  /**
   * 表情弹层的两个「出去的路」。
   *
   * 之前只有再点一次「+」能关：点开之后按 Esc 没反应、点到别处也不关 ——
   * 一个浮层如果没有通用的关闭手势，用户只能去猜「再点一次那个加号」。
   * Esc / 点外面关闭是所有浮层的肌肉记忆，必须给。
   */
  useEffect(() => {
    if (!pickOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPickOpen(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && reactWrapRef.current && !reactWrapRef.current.contains(t)) setPickOpen(false);
    };
    document.addEventListener('keydown', onKey);
    // pointerdown 而不是 click：后面的按钮会 stopPropagation，click 传不到 document
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [pickOpen]);

  if (m.status === 'recalled') {
    return (
      <p className="q-chat__recalled">
        {m.mine ? '你' : m.name} 撤回了一条消息
      </p>
    );
  }

  if (m.status === 'deleted') {
    return <p className="q-chat__recalled">这条被站长收走了</p>;
  }

  /**
   * AI 判定违规、自动收起来的那条。
   *
   * 措辞刻意和「撤回」「站长收走」都不一样：用户得能分清这是三件事，
   * 尤其不能让人以为作者自己撤了。悬停补一句解释 —— 只说「被收起来了」
   * 太像故障，得让人知道该找谁。
   */
  if (m.status === 'removed') {
    return (
      <p className="q-chat__recalled" title="模型判定不符合长亭的规矩，已经收起来；有异议可以找站长">
        这条被收起来了
      </p>
    );
  }

  const mine = m.mine;
  return (
    <div
      className={`q-chat__row${mine ? ' is-mine' : ''}${grouped ? ' is-grouped' : ''}${
        fresh ? ' is-fresh' : ''
      }${actsOpen ? ' is-acts-open' : ''}`}
      /**
       * 点消息 = 展开/收起操作条。
       *
       * **不限 hover:none**：带触摸屏的笔记本主指针是鼠标，`(hover: none)` 不匹配，
       * 但用户照样会用手指点 —— 只按媒体查询放行的话那类设备上手指永远打不开操作条。
       * 桌面上这个状态没有视觉后果（操作条本来就在悬停时出现），所以放行是安全的。
       *
       * 用 click 而不是 pointerdown：滚动结束浏览器不派发 click，
       * 顺着列表划不会一路把每条都点开。
       * 点在按钮/图/视频上不算（那是在操作，不是在「选这条消息」）。
       */
      onClick={(e) => {
        const t = e.target as Element | null;
        if (t?.closest('button, a, img, video, input, textarea')) return;
        onToggleActs();
      }}
      /**
       * Esc 收起挂在**整行**上，不挂在那个「…」按钮上。
       *
       * 焦点已经 Tab 进操作条（比如停在「回复」上）时，用户按 Esc 是想收起这一排；
       * 只绑在入口按钮上的话，这一步毫无反应 —— 实测「回复」上按 Esc，操作条仍在。
       * 行级监听能同时覆盖「在入口上」和「在展开的按钮里」两种位置。
       */
      onKeyDown={(e) => {
        if (e.key === 'Escape' && actsOpen) {
          e.stopPropagation();
          onToggleActs();
          // 收起后把焦点还给入口：让它消失又不还焦点，等于把键盘用户丢在原地
          (e.currentTarget as HTMLElement)
            .querySelector<HTMLButtonElement>('.q-chat__actstoggle')
            ?.focus();
        }
      }}
    >
      {/*
        头像用 background-image 而不是 <img>：外链头像挂掉时 background 不会有
        「破图」占位符，底下的首字自然露出来 —— 用 <img> + onError 切首字要多写一层
        状态，而且图还在 pending 的那几秒里会是一个空白圆。
        自己的消息也露头像（设计稿两侧都有），行的 flex-direction 是 row-reverse，
        所以它会自动落到右边。
      */}
      <span className="q-chat__avatar" aria-hidden="true">
        {m.name.slice(0, 1)}
        {m.avatar && (
          <img
            src={m.avatar}
            alt=""
            loading="lazy"
            decoding="async"
            /* 外链头像挂掉时藏起自己，露出底下的首字 —— 比留个空白圆好 */
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
      </span>

      <div className="q-chat__body">
        {!grouped && (
          <div className="q-chat__meta">
            {/* 站长标在名字**前面**：「站长 清吾」是正式署名写法，也先说明身份 */}
            {m.admin && <span className="q-chat__tag">站长</span>}
            <span className="q-chat__name">{m.name}</span>
            {m.mentionedMe && <span className="q-chat__tag q-chat__tag--at">@了你</span>}
            {/*
              来源标签：`site` 存的是完整 URL（协议/尾斜杠都有，比如 `https://rainzt.cn/`），
              直接显示会是一长串；这里归一成域名，原始地址留在 title 里。
              协议里 `site` 只保证是 URL，没有站点名可读，所以域名就是最准的"从哪来"。
            */}
            {m.origin === 'remote' && m.site && (
              <span className="q-chat__site" title={m.site}>
                来自 {hostOf(m.site) || m.site}
              </span>
            )}
            {m.editedAt && (
              <span className="q-chat__edited" title={`改于 ${clockOf(m.editedAt)}`}>
                已编辑
              </span>
            )}
            {showClock && (
              <time className="q-chat__clock" dateTime={m.at}>
                {clockOf(m.at)}
              </time>
            )}
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
              <div
                className={`q-chat__media is-${m.media.kind}`}
                /* 只有图需要交给人像灯箱；语音和视频自己带控件，挂上去反而抢点击 */
                data-zoomable={m.media.kind === 'image' ? '' : undefined}
              >
                {m.media.kind === 'image' ? (
                  /**
                   * 图片本身可聚焦、可用 Enter 打开。
                   *
                   * 原来点图能放大，但键盘没有任何入口 —— 鼠标能做、键盘不能做，
                   * 等于把「看原图」这件事从键盘用户那里删掉了。
                   * 打开/关闭仍归 ImageZoom 管，这里只提供可聚焦与一个语义标签。
                   */
                  <img
                    src={mediaSrc(m.media)}
                    alt="图片"
                    loading="lazy"
                    decoding="async"
                    tabIndex={0}
                    role="button"
                    aria-label="查看大图"
                    /* 图撑开高度后如果人还在底部，跟上（见 ChatRoom 的 followIfAtBottom） */
                    onLoad={onMediaLoad}
                  />
                ) : m.media.kind === 'audio' ? (
                  <VoiceBubble
                    src={mediaSrc(m.media)}
                    duration={m.media.duration}
                    mine={m.mine}
                  />
                ) : (
                  <video src={mediaSrc(m.media)} controls playsInline preload="metadata" />
                )}
              </div>
            ))}

          {/* 纯图消息的 body 是空串，不画空气泡 */}
          {m.body && (
            <div
              className={`q-rich q-chat__bubble${m.status === 'pending' ? ' is-pending' : ''}`}
              /* 正文里的图（对方站的 Markdown 封面）也要能点开：
                 灯箱只认 `.prose img` 和 `[data-zoomable] img`，气泡不在其中 */
              data-zoomable=""
              /* 正文图（卡片封面）是异步撑高的，load 不冒泡但 React 用捕获阶段代理，
                 所以挂在容器上能收到 —— 人还贴着底就跟上去 */
              onLoadCapture={onMediaLoad}
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
          {/*
            链接预览卡片。
            服务端抓到 OG 才有（在 bubblewrap 里、气泡外面：它是「这条消息指向的东西」，
            不属于这条消息本身）。点开是新标签页，`rel=noopener` 不能省。
          */}
          {m.link && (
            <a
              className="q-chat__link"
              href={m.link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="q-chat__link__body">
                <b className="q-chat__link__site">{m.link.site || hostOf(m.link.url)}</b>
                <span className="q-chat__link__title">{m.link.title || m.link.url}</span>
                {m.link.description && (
                  <span className="q-chat__link__desc">{m.link.description}</span>
                )}
              </span>
              {m.link.image && (
                <img
                  className="q-chat__link__img"
                  src={m.link.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  /* 第三方图床按 referer 拦外链的不少；referrerPolicy 能救回一大半 */
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
            </a>
          )}

          {m.status === 'pending' && (
            <span className="q-chat__pending" title="正在过一遍审核，稍等一下">
              等一等
            </span>
          )}

          {m.reactions.length > 0 && (
            <div className="q-chat__reacts">
              {m.reactions.map((r) => {
                const src = EMOJI_MAP[r.emoji]?.src;
                return (
                  <button
                    key={r.emoji}
                    type="button"
                    className={`q-chat__react${r.mine ? ' is-mine' : ''}${r.remote ? ' is-remote' : ''}`}
                    /* 大厅那边点的只展示：我们不能替别人取消，
                       点下去会把 Unicode 键写进本地表（那张表只认表情包的 key） */
                    onClick={r.remote ? undefined : () => onReact(r.emoji)}
                    disabled={r.remote}
                    title={
                      r.remote ? `大厅里有人点了 ${r.emoji}` : r.mine ? '再点一下取消' : '也点一个'
                    }
                  >
                    {src ? (
                      <img src={src} alt="" loading="lazy" decoding="async" />
                    ) : (
                      /* 对方站的 key（Unicode 🔥 或自定义 token）我们没有素材，直接显示字符 */
                      <span className="q-chat__react-char">{r.emoji}</span>
                    )}
                    <span>{r.n}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/*
            紧凑形态（窄屏 / 触屏）下操作条默认 `display: none`，这个按钮是键盘的入口：
            平时完全透明、`pointer-events: none`（手指点它的时候事件会穿过去命中气泡，
            走的是整行 toggle，不会双触发）；一旦键盘聚焦或已展开就现形。
            可见尺寸 28px —— 低于 WCAG 2.5.8 的 24 会点不中，也低于自己定的 30px 基准。

            **DOM 顺序必须排在 `.q-chat__acts` 之前**：Tab 顺序跟 DOM 走，
            排在后面的话从它按 Tab 会直接跳到下一条消息，进不去刚展开的那排按钮。
          */}
          <button
            type="button"
            className="q-chat__actstoggle"
            aria-label="这条消息的操作"
            aria-expanded={actsOpen}
            onClick={(e) => {
              e.stopPropagation();
              // detail === 0 说明这次 click 来自键盘（Enter / 空格），不是手指或鼠标
              const byKeyboard = e.detail === 0;
              const wasOpen = actsOpen;
              onToggleActs();
              /**
               * 展开后入口会让位（`[aria-expanded=true]` 时 opacity 0），
               * 所以键盘触发时必须把焦点交接给操作条的第一个按钮 ——
               * 否则焦点停在一个刚变透明的元素上，等于消失。
               */
              if (byKeyboard && !wasOpen) {
                const row = (e.currentTarget as HTMLElement).closest('.q-chat__row');
                requestAnimationFrame(() => {
                  row
                    ?.querySelector<HTMLButtonElement>('.q-chat__acts button')
                    ?.focus({ preventScroll: true });
                });
              }
            }}
            onKeyDown={(e) => {
              // Esc 收起；焦点留在这个按钮上，不会掉到 body
              if (e.key === 'Escape' && actsOpen) {
                e.stopPropagation();
                onToggleActs();
              }
            }}
          >
            <MorphIcon icon={Ellipsis} size={14} color="currentColor" />
          </button>

          {/* 操作条：压在气泡上沿（自己的消息镜像到左侧）。
              位置、尺寸和「为什么贴着气泡而不是浮在上方」见 chat.css 里 .q-chat__acts 的注释 */}
          <div className={`q-chat__acts${pickOpen ? ' has-open' : ''}`}>
            {/* 「+」放在最前面当开场：想加个表情的人不用先把整条读完再往右找。
                原来这里有三个快捷表情，2026-11-25 站长去掉了（表情全在 + 里）。 */}
            {m.status === 'visible' && (
              <span className="q-chat__addreact" ref={reactWrapRef}>
                <button
                  type="button"
                  className="q-chat__plus"
                  aria-label="更多回应"
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
            {/* 举报只针对本站发言：大厅来的消息（origin='remote'）我们删不掉也罚不了，
                收下举报等于许诺一个做不到的处置 —— 该找大厅管理员 */}
            {!mine && m.status === 'visible' && m.origin !== 'remote' && (
              <button
                type="button"
                className="q-chat__recall q-chat__report"
                onClick={onReport}
                title="觉得这条不合适？交给站长看"
              >
                举报
              </button>
            )}
          </div>
        </div>

        {/*
          已读回执：对勾 + 人数。对勾不是装饰 —— 它比「已读」两个字更早被扫到，
          而人数和「谁读的」放在悬停提示里，不占行宽。

          ⚠️ 用**单勾**，不要改成双勾。原先是照 WhatsApp 画的双勾，但那边双勾的含义
          是「对方已读」、单勾是「已送达」，是两级；我们只有「已读」一级，
          用双勾等于许诺了一个不存在的状态。而且 13px 底下两条 path 会交叉糊成一坨，
          放大看是个分叉的粗勾 —— 站长第一眼就是问「怎么两个勾」。
        */}
        {readCount > 0 && (
          <span
            className="q-chat__reads"
            title={
              readNames && readNames.length
                ? `${readNames.join('、')}${readCount > readNames.length ? ` 等 ${readCount} 人` : ''} 已读`
                : `${readCount} 人已读`
            }
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6.5 9.2 17.3 4 12.1" />
            </svg>
            已读 {readCount}
          </span>
        )}
      </div>
    </div>
  );
}
