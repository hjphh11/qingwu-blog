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
}: {
  open: boolean;
  onPick: (key: string) => void;
  onClose: () => void;
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
      className="absolute left-0 top-full z-30 mt-2 w-[19.5rem] max-w-[calc(100vw-3rem)] rounded-xl border border-rose/30 bg-[#fffdfb] p-2 shadow-[0_12px_36px_rgba(60,30,40,0.14)]"
    >
      <div className="mb-1.5 flex items-center gap-1 border-b border-rose/20 pb-1.5">
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
        <button
          type="button"
          onClick={onClose}
          aria-label="收起表情"
          className="ml-auto grid h-6 w-6 place-items-center rounded-full text-subtle transition-colors hover:bg-rose/12 hover:text-crimson"
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
            <img src={`${pack.base}/${key}${pack.ext}`} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>

      <p className="mt-1.5 border-t border-rose/15 pt-1.5 text-[10px] leading-relaxed text-subtle">
        表情会以 <code className="text-[10px]">:[名字]</code> 的形式存下来，换一套表情也不影响老留言。
      </p>
    </div>
  );
}
