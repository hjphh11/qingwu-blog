// 与后端通信的小封装：统一带上 cookie、统一把错误变成异常
async function req(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...opts,
  });
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
