import { useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { CircleAlert, LogOut } from '../icons.js';

export default function Login({ onSuccess }) {
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
