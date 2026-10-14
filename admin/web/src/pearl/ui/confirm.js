// 全局确认框（端口自 scaffold 的 composables/confirm.ts）。
//
// 用法：const ok = await confirm({ title, message, confirmText, danger })
// 由 ui/ConfirmHost.jsx 统一渲染，页面不用自己摆弹窗。
// React 版用「模块级 state + 订阅者」，宿主组件通过 useSyncExternalStore 订阅。
let state = null;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn(state));
}

export function subscribeConfirm(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getConfirmState() {
  return state;
}

/** 打开确认框，等用户点「确定 / 取消」；上一次没结算的会被当成「取消」 */
export function confirm(options) {
  if (state) state.resolve(false);
  return new Promise((resolve) => {
    state = { ...options, resolve };
    emit();
  });
}

export function resolveConfirm(ok) {
  const current = state;
  state = null;
  emit();
  current?.resolve(ok);
}
