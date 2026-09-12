import { useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { CircleAlert, Info, LogOut } from '../icons.js';

/**
 * `notice` = 回到登录页的原因（会话过期、服务器换了密钥…）。
 * 阶段 N 加的：以前会话过期只会把「请先登录」当普通错误显示在坏掉的页面上，
 * 现在直接回登录页并说明为什么。
 */
export default function Login({ onSuccess, notice = '' }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/login', { password });
      onSuccess();
    } catch (err) {
      setError(err.message || '登录失败');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            清
          </span>
          <div>
            <div className="name">清吾后台</div>
            <small style={{ fontSize: 11, color: 'rgba(74,55,40,.45)' }}>内容与发布</small>
          </div>
        </div>
        <p className="login-sub">输入密码进入 —— 只有你自己的设备（Tailscale 私网）能打开这一页。</p>

        {notice && (
          <div className="alert alert-warn" role="status">
            <MorphIcon icon={Info} size={15} color="currentColor" />
            <span>登录已过期（{notice}）—— 重新登录一下就好</span>
          </div>
        )}

        <label className="field">
          <span>密码</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        <button className="btn btn-block" type="submit" disabled={busy || !password}>
          <MorphIcon icon={LogOut} size={16} color="#fff" />
          {busy ? '登录中…' : '登录'}
        </button>

        {error && (
          <div className="alert alert-error" role="alert">
            <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
            <span>{error}</span>
          </div>
        )}
      </form>
    </div>
  );
}
