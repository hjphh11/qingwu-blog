import { useCallback, useEffect, useRef, useState } from 'react';

const API = '/api/admin';

type Step = 'password' | 'verify';

interface LoginResp {
  ok?: boolean;
  reason?: string;
  message?: string;
  email?: string;
  cooldown?: number;
  retryAfter?: number;
}

/**
 * 两级登录：账号密码 → 邮箱验证码。
 *
 * 刻意不做「记住上一步」：刷新页面就回到第一步，
 * 因为第二步的有效期只有 5 分钟，留着一个半截状态反而更容易让人困惑。
 */
export default function AdminLogin() {
  const [step, setStep] = useState<Step>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [masked, setMasked] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cool, setCool] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // 冷却倒计时
  useEffect(() => {
    if (cool <= 0) return;
    const t = window.setTimeout(() => setCool((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cool]);

  useEffect(() => {
    if (step === 'verify') codeRef.current?.focus();
  }, [step]);

  const submitPassword = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busy) return;
      setErr('');
      if (!username.trim() || !password) {
        setErr('账号和密码都要填');
        return;
      }
      setBusy(true);
      try {
        const r = await fetch(`${API}/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password }),
        });
        const d = (await r.json().catch(() => ({}))) as LoginResp;
        if (r.ok && d.ok) {
          setMasked(d.email || '');
          setCool(d.cooldown ?? 60);
          setCode('');
          setStep('verify');
        } else if (d.reason === 'cooldown' && d.retryAfter) {
          // 码已经发出去了，直接进第二步等冷却
          setCool(d.retryAfter);
          setStep('verify');
          setErr(d.message || '验证码已发送，请稍候');
        } else {
          setErr(d.message || '登录失败，请稍后再试');
        }
      } catch {
        setErr('网络异常，请检查连接后重试');
      } finally {
        setBusy(false);
      }
    },
    [busy, password, username],
  );

  const submitCode = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busy) return;
      setErr('');
      if (!/^\d{6}$/.test(code.trim())) {
        setErr('请输入 6 位数字验证码');
        return;
      }
      setBusy(true);
      try {
        const r = await fetch(`${API}/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), code: code.trim() }),
        });
        const d = (await r.json().catch(() => ({}))) as LoginResp;
        if (r.ok && d.ok) {
          window.location.replace('/admin/console');
          return;
        }
        setErr(d.message || '验证失败');
        setCode('');
        codeRef.current?.focus();
      } catch {
        setErr('网络异常，请检查连接后重试');
      } finally {
        setBusy(false);
      }
    },
    [busy, code, username],
  );

  const resend = useCallback(async () => {
    if (cool > 0 || busy) return;
    setErr('');
    setBusy(true);
    try {
      const r = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const d = (await r.json().catch(() => ({}))) as LoginResp;
      if (r.ok && d.ok) {
        setCool(d.cooldown ?? 60);
        setErr('');
      } else {
        setErr(d.message || '重新发送失败');
      }
    } catch {
      setErr('网络异常，请检查连接后重试');
    } finally {
      setBusy(false);
    }
  }, [busy, cool, password, username]);

  return (
    <main className="q-admin-center">
      <div className="q-admin-login">
        <section className="q-admin-brand">
          <img className="q-admin-avatar" src="/images/emis/avatar.png" alt="爱弥斯" />
          <h1>欢迎回来</h1>
          <p>登录清吾控制台，处理评论、审核友链，看看谁又把回链悄悄下掉了。</p>
          <ol className="q-admin-steps">
            <li>验证管理员账号</li>
            <li>接收 6 位邮箱验证码</li>
            <li>安全进入控制台</li>
          </ol>
        </section>

        <section className="q-admin-form">
          {step === 'password' ? (
            <form onSubmit={submitPassword}>
              <h2>管理员登录</h2>
              <p className="q-admin-hint">账号与密码通过后，会向绑定邮箱发送一次验证码。</p>

              {err ? <p className="q-admin-error">{err}</p> : null}

              <div className="q-admin-field">
                <label htmlFor="q-admin-u">登录账号</label>
                <input
                  id="q-admin-u"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="q-admin-field">
                <label htmlFor="q-admin-p">登录密码</label>
                <input
                  id="q-admin-p"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </div>

              <div className="q-admin-mailbox">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <rect x="2.5" y="5" width="19" height="14" rx="2.4" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
                <div>
                  <b>验证码只会发送至绑定邮箱</b>
                  <span>换邮箱需要先在原邮箱收一次确认</span>
                </div>
              </div>

              <button className="q-admin-btn q-admin-btn--primary" type="submit" disabled={busy}>
                {busy ? '正在验证…' : '验证账号并发送验证码'}
              </button>
              <p className="q-admin-fine">
                登录成功后保持 <b>30 天</b>。连续失败 15 次将暂停登录 15 分钟，验证码发送间隔为 <b>60 秒</b>。
              </p>
            </form>
          ) : (
            <form onSubmit={submitCode}>
              <h2>输入验证码</h2>
              <p className="q-admin-hint">
                已发送至 <b>{masked || '绑定邮箱'}</b>，5 分钟内有效，只能使用一次。
              </p>

              {err ? <p className="q-admin-error">{err}</p> : null}

              <div className="q-admin-field">
                <label htmlFor="q-admin-code">6 位验证码</label>
                <input
                  id="q-admin-code"
                  ref={codeRef}
                  className="q-admin-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={busy}
                />
              </div>

              <button className="q-admin-btn q-admin-btn--primary" type="submit" disabled={busy}>
                {busy ? '正在核对…' : '进入控制台'}
              </button>

              <div className="q-admin-again">
                <button type="button" className="q-admin-linkbtn" onClick={resend} disabled={cool > 0 || busy}>
                  {cool > 0 ? `${cool} 秒后可重新发送` : '重新发送验证码'}
                </button>
                <button
                  type="button"
                  className="q-admin-linkbtn"
                  onClick={() => {
                    setStep('password');
                    setErr('');
                    setCode('');
                  }}
                >
                  换个账号
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
