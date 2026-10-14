import type { ReactNode } from 'react';

/**
 * 侧栏卡片的骨架壳。
 *
 * 背景:首页右栏四张卡的数据都只能到客户端才拿得到(当前时间 / 定位 / localStorage
 * 统计 / 运行时长),所以它们一直是 `client:only` —— 服务端渲染为空,整栏会在 JS
 * 到位后**一起弹出来**;StatsCard 更明显:先画一个「0 次」,再跳成真值。
 *
 * 处理办法:把这几张卡改成 `client:load`,让壳(与真实卡同一套 glass-card + p-5)
 * 参与服务端渲染;数据没到位时先渲染骨架,到位后再换成真实内容。观感就从
 * 「弹出来」变成「本来就在那儿,只是还没填好」。
 *
 * ⚠️ 两个必须守住的点:
 * 1. **骨架要与真实内容同高**。骨架比真实内容矮(或高),切换那一刻照样是 CLS。
 *    所以调用方传进来的 skeleton 必须**逐元素对应**真实内容的标签与行高。
 * 2. **不能用「先渲染真值再改」的写法**(那正是 StatsCard 显示「0 次」的成因),
 *    也不能在首帧渲染 `new Date()` 这类客户端值 —— 服务端与客户端会算出不同结果,
 *    React 水合会对不上。统一用「mounted 前渲染骨架」这一种模式。
 *
 * 见 docs/开屏与全部加载动画-完整设计文档.html 第 04 节 ①。
 */
export function CardShell({
  pending,
  skeleton,
  children,
}: {
  /** 数据还没到位。为真时渲染骨架并标记 aria-busy。 */
  pending?: boolean;
  /** 与真实内容同高的骨架(逐元素对应)。 */
  skeleton: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`glass-card p-5${pending ? ' q-skel-shell' : ''}`}
      data-card-shell
      aria-busy={pending || undefined}
    >
      {/* 剪影水印:垫在骨架线下面(见 global.css 的 .q-skel-mark)。
          纯装饰,所以 aria-hidden。 */}
      {pending && <span className="q-skel-mark" aria-hidden="true" />}
      {pending ? skeleton : children}
    </div>
  );
}

/** 骨架块 · 玫瑰色扫光(样式见 global.css 的 `.q-skel`)。 */
export function Skel({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`q-skel block ${className}`} />;
}

/**
 * 卡片头骨架:与真实卡头(17px 图标 + 一行 13px/20px 文字)同高。
 * `className` 用来给文字位一个与真实标题相称的宽度。
 */
export function SkelHead({ className = 'w-[8.75rem]' }: { className?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Skel className="h-[17px] w-[17px] rounded-[5px]" />
      <Skel className={`h-5 ${className}`} />
    </div>
  );
}
