/*
 * 长亭 · 语音消息气泡
 *
 * 为什么不用 `<audio controls>`：原生控件在三个浏览器里长得完全不一样
 * （Chrome 一条灰、Safari 一个圆角块、Firefox 带下载键），放进暖色气泡里
 * 像贴了一块系统 UI。这里只留播放键 + 一排静态波形 + 时长，颜色跟着气泡走。
 *
 * 波形是**确定性**的（`(i * 7) % 11`），不是 random：
 * 随机数每次渲染都不一样，播放到一半 React 一重绘，整条波形会跳一下。
 */
import { useEffect, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Pause, Play } from '../../lib/icons';

const BARS = 21;

/** 0.75 → 「0:01」；超过一小时不处理，语音最长 60 秒 */
function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function VoiceBubble({
  src,
  duration,
  mine,
}: {
  src: string;
  /** 录音时记下的秒数；老数据可能没有 */
  duration: number | null;
  /** 自己的消息：气泡是绯红底，波形和字要跟着反白 */
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  /** 真实时长：`duration` 可能有偏差（录音时按秒取整），播过一次后以音频为准 */
  const [total, setTotal] = useState(duration ?? 0);

  // 切到别的消息 / 组件卸载时把声音停掉，否则会两条一起响
  useEffect(() => {
    const a = audioRef.current;
    return () => {
      a?.pause();
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play().catch(() => {
        /* 自动播放被拦 / 网络断了：按钮状态由 onPause 兜底复位 */
      });
    } else {
      a.pause();
    }
  };

  const progress = total > 0 ? Math.min(1, at / total) : 0;

  return (
    <div className={`q-voice${mine ? ' is-mine' : ''}`}>
      <button
        type="button"
        className="q-voice__play"
        onClick={toggle}
        aria-label={playing ? '暂停语音' : '播放语音'}
      >
        <MorphIcon icon={playing ? Pause : Play} size={14} color="currentColor" />
      </button>

      {/* 整条波形也是按钮：点波形任意位置等同于播放/暂停，命中区比那颗小圆大得多 */}
      <button
        type="button"
        className="q-voice__wave"
        onClick={toggle}
        tabIndex={-1}
        aria-hidden="true"
      >
        {Array.from({ length: BARS }, (_, i) => {
          const h = 5 + ((i * 7) % 11);
          const lit = progress * BARS > i;
          return <i key={i} style={{ height: `${h}px`, opacity: lit ? 1 : 0.42 }} />;
        })}
      </button>

      <b className="q-voice__t">{mmss(playing ? at : total)}</b>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotal(d);
        }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
        }}
      />
    </div>
  );
}
