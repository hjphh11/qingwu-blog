import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import { MorphIcon } from 'morphicons/react';
import { Link2, Mail, Share2, MessageCircle, X } from '../lib/icons';

const SPRING = { type: 'spring', stiffness: 500, damping: 25 } as const;

interface Props {
  /** 当前文章规范链接,用于复制/微博/QQ 分享 */
  url: string;
  /** 当前文章标题 */
  title: string;
  /** 站点联系邮箱 */
  email: string;
}

// 「联系我们」弹性展开按钮 —— 点击后弹性展开为一排 联系/分享 图标,逐个弹出,再点收回。
// 交互借鉴 MotionVault「ShareExpand」(MIT),配色按爱弥斯暖色重写。
export default function ContactExpand({ url, title, email }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const reduce = useReducedMotion();
  const trans: Transition = reduce ? { type: 'tween', duration: 0.2 } : SPRING;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setOpen(false);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const mail = () => {
    setOpen(false);
    const subject = encodeURIComponent(`来自「清吾博客」的留言 · ${title}`);
    window.location.href = `mailto:${email}?subject=${subject}`;
  };

  const weibo = () => {
    setOpen(false);
    window.open(
      `https://service.weibo.com/share/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
      '_blank',
    );
  };

  const qq = () => {
    setOpen(false);
    window.open(
      `https://connect.qq.com/widget/shareqq/index.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
      '_blank',
    );
  };

  const channels = [
    { icon: Link2, label: '复制链接', onClick: copyLink },
    { icon: Mail, label: '邮件', onClick: mail },
    { icon: Share2, label: '微博', onClick: weibo },
    { icon: MessageCircle, label: 'QQ', onClick: qq },
  ];

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
              {copied ? (
                <span className="flex items-center gap-1.5">已复制 ✓</span>
              ) : (
                <>
                  <MorphIcon icon={Mail} size={16} color="currentColor" />
                  联系我们
                </>
              )}
            </motion.button>
          ) : (
            <motion.div key="open" className="flex items-center gap-1" initial={false}>
              {channels.map(({ icon: Icon, label, onClick }, i) => (
                <motion.button
                  key={label}
                  type="button"
                  aria-label={label}
                  title={label}
                  onClick={onClick}
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
                onClick={() => setOpen(false)}
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
