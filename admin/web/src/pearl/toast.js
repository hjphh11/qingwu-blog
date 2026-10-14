// 珍珠玻璃提示牌堆（对应 scaffold 的 `composables/toast.ts`）。
//
// Vue 那边用 reactive 数组 + 定时器；这里是模块级数组 + 订阅者，
// React 侧用 `useSyncExternalStore` 订阅（见 ui/ToastHost.jsx）。
// 行为照抄：最多 4 条、悬停暂停、危险提示停留更久。
let toasts = [];
let seed = 0;
let paused = false;

const listeners = new Set();
const timers = new Map(); // id -> { handle, endsAt, remaining }

function emit() {
  listeners.forEach((fn) => fn(toasts));
}

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getToasts() {
  return toasts;
}

function dismiss(id) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
  const timer = timers.get(id);
  if (timer) clearTimeout(timer.handle);
  timers.delete(id);
}

export const dismissToast = dismiss;

function schedule(id, ms) {
  timers.set(id, {
    handle: paused ? 0 : setTimeout(() => dismiss(id), ms),
    endsAt: Date.now() + ms,
    remaining: ms,
  });
}

/** 推一条提示。tone：ok（青柠）/ info（蓝）/ danger（红，停 4.2 秒） */
export function pushToast(msg, tone = 'ok') {
  const id = (seed += 1);
  const duration = tone === 'danger' ? 4200 : 2600;
  toasts = [...toasts, { id, msg, tone, duration }];
  // 超过 4 条就把最早的挤掉
  if (toasts.length > 4) dismiss(toasts[0].id);
  emit();
  schedule(id, duration);
}

export function pauseToasts() {
  if (paused) return;
  paused = true;
  timers.forEach((timer) => {
    clearTimeout(timer.handle);
    timer.remaining = Math.max(0, timer.endsAt - Date.now());
  });
}

export function resumeToasts() {
  if (!paused) return;
  paused = false;
  const snapshot = [...timers.entries()];
  snapshot.forEach(([id, timer]) => {
    if (toasts.some((t) => t.id === id)) schedule(id, Math.max(600, timer.remaining));
  });
}

/** 统一的失败提示：后端的业务消息优先，其次用兜底文案 */
export function toastError(error, fallback) {
  pushToast(error?.message || fallback, 'danger');
}
