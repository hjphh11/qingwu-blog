import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import { MorphIcon } from 'morphicons/react';
import { Link2, Mail, Share2, MessageCircle, X } from '../lib/icons';
import { aboutIcon } from '../lib/aboutIcons';

const SPRING = { type: 'spring', stiffness: 500, damping: 25 } as const;

/** 关于页的联系方式条目（来自 about.json 的 contacts）*/
interface ContactItem {
  icon: string;
  label: string;
  action: 'copy' | 'link';
  value: string;
}

interface Props {
  /** share = 文章页分享; contact = 关于页联系我们 */
  variant?: 'share' | 'contact';
  /** 收起态按钮文字 */
  label: string;
  /** 当前页 URL(用于复制/微博/QQ 分享) */
  url?: string;
  /** 标题(用于分享与邮件主题) */
  title?: string;
  /** 站点邮箱(邮件 / 复制) */
  email?: string;
  /** GitHub 地址(contact 用) */
  github?: string;
  /** 联系方式列表（contact 用）。**数据来自 about.json**，为空时回落到 email + github */
  contacts?: ContactItem[];
}

// 「分享 / 联系我们」弹性展开按钮 —— 点击后弹性展开为一排图标,逐个弹出,再点收回。
// 交互借鉴 MotionVault「ShareExpand」(MIT),配色按爱弥斯暖色重写。
export default function ContactExpand({
  variant = 'share',
  label,
  url = '',
  title = '',
  email = '',
  github = '',
  contacts = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const trans: Transition = reduce ? { type: 'tween', duration: 0.2 } : SPRING;

  const close = () => setOpen(false);

  const copy = async (text: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    close();
    setCopiedText(ok);
    window.setTimeout(() => setCopiedText(null), 1400);
  };

  const isShare = variant === 'share';

  // 联系方式**由 about.json 的 contacts 驱动**（没配就回落到 email + github，
  // 免得后台数据为空时这一块整个空掉）
  const contactList: ContactItem[] =
    contacts.length > 0
      ? contacts
      : [
          ...(email ? [{ icon: 'mail', label: '邮箱', action: 'copy' as const, value: email }] : []),
          ...(github ? [{ icon: 'github', label: 'GitHub', action: 'link' as const, value: github }] : []),
        ];

  const channels = isShare
    ? [
        { icon: Link2, label: '复制链接', run: () => copy(url, '已复制 ✓') },
        {
          icon: Mail,
          label: '邮件',
          run: () => {
            close();
            window.location.href = `mailto:${email}?subject=${encodeURIComponent('来自「清吾博客」的留言 · ' + title)}`;
          },
        },
        {
          icon: Share2,
          label: '微博',
          run: () => {
            close();
            window.open(
              `https://service.weibo.com/share/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
              '_blank',
            );
          },
        },
        {
          icon: MessageCircle,
          label: 'QQ',
          run: () => {
            close();
            window.open(
              `https://connect.qq.com/widget/shareqq/index.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
              '_blank',
            );
          },
        },
      ]
    : contactList.map((c) => ({
        icon: aboutIcon(c.icon) as never,
        label: c.label,
        run: () => {
          if (c.action === 'copy') {
            copy(c.value, `已复制${c.label} ✓`);
          } else {
            close();
            window.open(c.value, '_blank');
          }
        },
      }));

  const collapsedIcon = isShare ? Share2 : (aboutIcon(contactList[0]?.icon) as never) || Mail;

  return (
    <div className="flex items-center justify-center">
      <motion.div
        layout
        transition={trans}
        className={
          'flex h-11 items-center overflow-hidden rounded-full ' +
          (open
            ? 'gap-1 border border-rose/30 bg-cream/80 p-1 shadow-[0_6px_18px_rgba(246,165,184,0.3)]'
            : 'bg-crimson text-white shadow-[0_6px_18px_rgba(224,82,107,0.35)]')
        }
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {!open ? (
            <motion.button
              key="closed"
              type="button"
              onClick={() => setOpen(true)}
              className="flex h-full cursor-pointer items-center gap-2 px-5 text-sm font-medium text-white"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={trans}
            >
              {copiedText ? (
                <span className="flex items-center gap-1.5">{copiedText}</span>
              ) : (
                <>
                  <MorphIcon icon={collapsedIcon} size={16} color="currentColor" />
                  {label}
                </>
              )}
            </motion.button>
          ) : (
            <motion.div key="open" className="flex items-center gap-1" initial={false}>
              {channels.map(({ icon: Icon, label: chLabel, run }, i) => (
                <motion.button
                  key={chLabel}
                  type="button"
                  aria-label={chLabel}
                  title={chLabel}
                  onClick={run}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-crimson transition-colors hover:bg-white hover:text-crimson"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ ...trans, delay: open ? i * 0.06 : 0 }}
                >
                  <MorphIcon icon={Icon} size={16} color="currentColor" />
                </motion.button>
              ))}
              <motion.button
                type="button"
                aria-label="收起"
                onClick={close}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink/40 transition-colors hover:bg-white hover:text-crimson"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ ...trans, delay: open ? channels.length * 0.06 : 0 }}
              >
                <MorphIcon icon={X} size={16} color="currentColor" />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
