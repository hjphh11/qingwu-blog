import { useEffect, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { X } from '../lib/icons';
import { EMOJI_PACKS } from '../lib/emojis';

/**
 * 表情面板。
 *
 * 三套包各一个 tab（平滑 / 阿鲁 / 小电视），点一下往输入框里插 `:[key]`。
 * **图片全放 public**，不走 CDN —— 表情是留言的一部分，第三方挂掉不该开天窗。
 *
 * 为什么是「插入 token」而不是「插入 <img>」：留言存的是纯文本，
 * 表情在渲染时由 `src/lib/richText.ts` 换成图片。这样：
 *   · 数据库里没有 HTML，后台、邮件、AI 审核看到的都是可读文本；
 *   · 哪天想换一套表情，只改渲染层，历史留言自动跟着变。
 */
export default function EmojiPicker({
  open,
  onPick,
  onClose,
  placement = 'bottom',
}: {
  open: boolean;
  onPick: (key: string) => void;
  onClose: () => void;
  /**
   * 往哪边弹。默认向下、左对齐（评论区那个位置上面有内容、下面没有，左边是正文）。
   * 长亭的输入区在**页面最底部、按钮靠右**，所以是「向上 + 右对齐」：
   * 向下弹会被容器的 `overflow: hidden` 裁掉，左对齐会让 312px 宽的面板顶出卡片右缘
   * （实测两个都踩了）。默认值不改，其余调用点零感知。
   */
  placement?: 'bottom' | 'top';
}) {
  const [tab, setTab] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 点外面 / 按 Esc 关掉。用 pointerdown 而不是 click：
  // click 在拖选文字结束时会误触，pointerdown 更贴近「点到别处了」的直觉。
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(ev.target as Node)) onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  const pack = EMOJI_PACKS[tab] ?? EMOJI_PACKS[0]!;

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="表情"
      className={`absolute z-30 w-[19.5rem] max-w-[calc(100vw-3rem)] rounded-xl border border-rose/30 bg-[#fffdfb] p-2 shadow-[0_12px_36px_rgba(60,30,40,0.14)] ${
        placement === 'top' ? 'bottom-full right-0 mb-2' : 'top-full left-0 mt-2'
      }`}
    >
      {/* 八套包的 tab 一行放不下（2 字标签 + 内边距约 40px，八个就 300px+），
          所以 tab 自己换行，关闭按钮靠右单独站住，别跟着一起挤 */}
      <div className="mb-1.5 flex items-start gap-1 border-b border-rose/20 pb-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {EMOJI_PACKS.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setTab(idx)}
              aria-pressed={idx === tab}
              className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                idx === tab ? 'bg-crimson/10 text-crimson' : 'text-subtle hover:text-crimson'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起表情"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:bg-rose/12 hover:text-crimson"
        >
          <MorphIcon icon={X} size={12} color="currentColor" />
        </button>
      </div>

      <div className="grid max-h-[11.5rem] grid-cols-9 gap-0.5 overflow-y-auto">
        {pack.items.map((key) => (
          <button
            key={key}
            type="button"
            title={`:${key}:`}
            aria-label={key}
            onClick={() => onPick(key)}
            className="q-emoji-cell"
          >
            <img
              src={`${pack.base}/${key}${pack.ext}`}
              alt=""
              loading="lazy"
              decoding="async"
              /* 静态图偶尔会被限流/网络抖一下，浏览器不重试，格子里就留个破图。
                 失败过就带个参数重取一次，只试一次（data-retried 标记）。 */
              onError={(e) => {
                const img = e.currentTarget;
                if (img.dataset.retried) return;
                img.dataset.retried = '1';
                img.src = `${pack.base}/${key}${pack.ext}?r=1`;
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
