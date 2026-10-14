// 提示牌堆（React 版，DOM 与 scaffold 的 ui/ToastHost.vue 一致）。
//
// 差异说明：Vue 那边进出场用 GSAP 的 TransitionGroup 钩子做弹入/收回；
// 这里不引 GSAP，改成由 CSS 负责（`.toast-slot` / `.toast` 的过渡），
// 因此没有 GSAP 的 `clearProps` 收尾，元素直接落在终态。
import { useSyncExternalStore } from 'react';
import {
  dismissToast,
  getToasts,
  pauseToasts,
  resumeToasts,
  subscribeToasts,
} from '../toast.js';
import { cls } from '../cls.js';

export default function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const count = toasts.length;

  return (
    <div
      className={cls('toast-host', count > 0 && 'is-expanded')}
      role="status"
      aria-live="polite"
      style={{ '--toast-count': count }}
      onPointerEnter={pauseToasts}
      onPointerLeave={resumeToasts}
      onFocus={pauseToasts}
      onBlur={resumeToasts}
    >
      {toasts.map((t, i) => (
        <div key={t.id} className="toast-slot" style={{ '--depth': count - 1 - i }}>
          <div className={cls('toast', 'm-float', `tone-${t.tone}`, 'is-paused')}>
            <span className="toast-dot" aria-hidden="true" />
            <span className="toast-msg">{t.msg}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="关闭提示"
              onClick={() => dismissToast(t.id)}
            >
              <svg className="toast-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <circle className="ring-track" cx="9" cy="9" r="7" />
                <circle className="ring-time" cx="9" cy="9" r="7" style={{ animationDuration: `${t.duration}ms` }} />
                <path d="M6.6 6.6l4.8 4.8M11.4 6.6l-4.8 4.8" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
