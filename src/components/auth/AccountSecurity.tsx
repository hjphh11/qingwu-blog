import { useState, type FormEvent } from 'react';
import { authPost, type SessionAccount } from '../../lib/auth';

export default function AccountSecurity({
  account,
  adopt,
}: {
  account: SessionAccount;
  adopt: (a: SessionAccount) => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [reset, setReset] = useState(false);
  async function action(path: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage('');
    const r = await authPost<{ account?: SessionAccount; devCode?: string }>(path, body);
    setBusy(false);
    if (!r.ok) {
      setMessage(r.message);
      return false;
    }
    if (r.account) adopt(r.account);
    setMessage(r.devCode ? success + ' · 本地验证码 ' + r.devCode : success);
    return true;
  }
  function values(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget));
  }
  return (
    <section className="q-security">
      <h3 className="font-display text-base">账号与安全</h3>
      <p>用户名 · {account.username}</p>
      {account.usernameProvisional ? (
        <form
          onSubmit={async (e) => {
            const body = values(e);
            if (window.confirm('确认使用 ' + body.username + '？确认后永久不可修改。'))
              await action('username/confirm', body, '用户名已确认');
          }}
        >
          <label>
            确认你的用户名
            <input name="username" required defaultValue={account.username} />
          </label>
          <small>这将是你的 Matrix 账号名，确认后不能修改。</small>
          <button disabled={busy}>确认用户名</button>
        </form>
      ) : (
        <p>用户名已确定，用于登录和 Matrix。</p>
      )}
      {account.role === 'visitor' && (
        <>
          <p>
            Matrix ·{' '}
            {account.matrix.userId ||
              { pending: '待重试', failed: '开通失败', disabled: '已停用' }[account.matrix.status] ||
              '尚未开通'}
          </p>
          {account.matrix.status === 'pending' && (
            <p>下次用本站密码登录时会重试，也可以在这里立即开通。</p>
          )}
          {account.matrix.passwordSyncPending && <p>下次用密码登录后同步 Matrix 密码。</p>}
          {account.hasPassword &&
            !account.usernameProvisional &&
            ['none', 'pending', 'failed'].includes(account.matrix.status) && (
              <details>
                <summary>立即开通 Matrix</summary>
                <form
                  onSubmit={async (e) => {
                    const f = e.currentTarget;
                    if (await action('matrix/activate', values(e), 'Matrix 已开通')) f.reset();
                  }}
                >
                  <label>
                    当前密码
                    <input name="password" type="password" autoComplete="current-password" required />
                  </label>
                  <button disabled={busy}>开通</button>
                </form>
              </details>
            )}
          <details open={!account.hasPassword || undefined}>
            <summary>
              {account.hasPassword ? '修改或找回密码' : '设个密码，以后换设备也能直接登录'}
            </summary>
            <form
              onSubmit={async (e) => {
                const f = e.currentTarget;
                const body = values(e);
                if (body.new_password !== body.confirm) {
                  setMessage('两次输入的密码不一致');
                  return;
                }
                if (await action('password', body, '密码已保存，其它设备已退出')) {
                  f.reset();
                  setReset(false);
                }
              }}
            >
              {account.hasPassword &&
                (reset ? (
                  <label>
                    邮箱验证码
                    <input
                      name="code"
                      required
                      pattern="[0-9]{6}"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    />
                  </label>
                ) : (
                  <label>
                    当前密码
                    <input
                      name="old_password"
                      type="password"
                      required
                      autoComplete="current-password"
                    />
                  </label>
                ))}
              {account.hasPassword && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (await action('password/reset/start', {}, '验证码已发送到当前邮箱'))
                      setReset(true);
                  }}
                >
                  用邮箱验证码重置密码
                </button>
              )}
              <label>
                新密码
                <input name="new_password" type="password" autoComplete="new-password" required />
              </label>
              <label>
                确认新密码
                <input name="confirm" type="password" autoComplete="new-password" required />
              </label>
              <button disabled={busy}>保存密码</button>
            </form>
          </details>
          <details>
            <summary>换绑邮箱 · {account.email}</summary>
            <form
              onSubmit={async (e) => {
                const body = values(e);
                body.new_email = email;
                if (emailSent) {
                  if (await action('email/change/verify', body, '邮箱已更新，其它设备已退出')) {
                    setEmail('');
                    setEmailSent(false);
                  }
                } else if (await action('email/change/start', body, '验证码已发至新邮箱'))
                  setEmailSent(true);
              }}
            >
              <label>
                新邮箱
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailSent(false);
                  }}
                />
              </label>
              {emailSent && (
                <label>
                  验证码
                  <input
                    name="code"
                    required
                    pattern="[0-9]{6}"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                  />
                </label>
              )}
              <button disabled={busy}>{emailSent ? '确认换绑' : '发送验证码'}</button>
              {emailSent && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action('email/change/start', { new_email: email }, '已重新发码')}
                >
                  重新发码
                </button>
              )}
            </form>
          </details>
        </>
      )}
      <button
        disabled={busy}
        onClick={async () => {
          if (
            confirm('退出包括当前设备在内的所有设备？') &&
            (await action('logout', { all: true }, '已退出'))
          )
            location.reload();
        }}
      >
        退出所有设备
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
