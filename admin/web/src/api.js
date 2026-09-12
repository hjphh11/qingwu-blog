// 与后端通信的小封装：统一带上 cookie、统一把错误变成异常。
//
// 阶段 N 收尾补的三件事（都是审计量出来的真问题）：
//  ① **超时**：以前没有超时，接口一直不响应时页面会**无限等**（实测挂了 280 秒还没提示）。
//     现在 30 秒没回就抛「请求超时」。
//  ② **断网 / 服务没起来**：以前直接抛浏览器的 `Failed to fetch`（英文、看不懂）。
//     现在换成「连不上后台服务（可能服务没启动，或者网络断了）」。
//  ③ **会话过期（401）**：以前只在页面上显示一句「请先登录」，人还留在坏页面里。
//     现在广播 `qingwu:unauthorized` 事件，App 收到就回登录页并说明原因。
const TIMEOUT_MS = 30_000;

async function req(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...opts,
    });
  } catch (err) {
    // 超时（AbortSignal.timeout 抛 TimeoutError）与断网都会落到这里
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const e = new Error(
      timedOut
        ? `请求超时（${TIMEOUT_MS / 1000} 秒没有响应）—— 可能后台服务卡住了，稍后再试`
        : '连不上后台服务（可能服务没启动，或者网络断了）',
    );
    e.status = 0;
    e.code = timedOut ? 'timeout' : 'network';
    e.cause = err;
    throw e;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(data?.message || `请求失败（HTTP ${res.status}）`);
    err.status = res.status;
    err.code = data?.error;
    // 401 = 没登录 / 会话过期。登录接口自己会处理，其它接口一律广播出去
    if (res.status === 401 && !url.includes('/api/auth/')) {
      try {
        window.dispatchEvent(new CustomEvent('qingwu:unauthorized', { detail: { message: err.message } }));
      } catch {
        /* 环境太老没有 CustomEvent 就算了：页面上照样会显示错误 */
      }
    }
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => req(url),
  post: (url, body) => req(url, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: (url, body) => req(url, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: (url) => req(url, { method: 'DELETE' }),
};
