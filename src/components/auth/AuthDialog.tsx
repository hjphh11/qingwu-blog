import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { authPost, githubLoginUrl, type AuthConfig, type SessionAccount } from '../../lib/auth';
import { usernameError, validNickname, validPassword } from '../../../worker/src/auth/rules';
import CodeInput from './CodeInput';
import './auth.css';

type Mode = 'login' | 'register';
type Props = {
  open: boolean;
  mode?: Mode;
  config: AuthConfig;
  onClose: () => void;
  onDone: (account: SessionAccount, created?: boolean) => void;
  page?: boolean;
};

export default function AuthDialog(props: Props) {
  if (!props.open || typeof document === 'undefined') return null;
  return props.page ? <AuthForm {...props} /> : createPortal(<Modal {...props} />, document.body);
}

function Modal(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="q-auth-modal"
      aria-label="登录与注册"
      onCancel={props.onClose}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      <div>
        <button className="q-auth-close" type="button" aria-label="关闭" onClick={props.onClose}>
          ×
        </button>
        <AuthForm {...props} />
      </div>
    </dialog>
  );
}

function AuthForm({ mode: initial = 'login', config, onDone }: Props) {
  const [mode, setMode] = useState<Mode>(initial);
  const [method, setMethod] = useState<'password' | 'code'>('password');
  const [sent, setSent] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ticket, setTicket] = useState('');
  const [devCode, setDevCode] = useState('');
  const [codeKey, setCodeKey] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cool, setCool] = useState(0);
  const hp = useRef<HTMLInputElement>(null);
  const registering = mode === 'register';
  useEffect(() => {
    if (cool) {
      const t = setTimeout(() => setCool(cool - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [cool]);

  function reset() {
    setSent(false);
    setTicket('');
    setError('');
    setPassword('');
    setConfirm('');
    setDevCode('');
    setCool(0);
  }
  async function send() {
    if (registering) {
      const message = usernameError(username)?.[1];
      if (message || !validNickname(nickname)) {
        setError(message || '昵称需为 1–20 个字，最多 3 个 emoji，首尾不能有空格');
        return;
      }
    }
    setBusy(true);
    setError('');
    const r = await authPost<{ devCode?: string }>(registering ? 'register/start' : 'email/start', {
      email: identifier,
      username,
      nickname,
      hp: hp.current?.value,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      setCool(r.retryAfter || 0);
      return;
    }
    setDevCode(r.devCode || '');
    setCodeKey((k) => k + 1);
    setSent(true);
    setCool(60);
  }
  async function verify(code: string) {
    if (busy || ticket) return;
    setBusy(true);
    setError('');
    if (registering) {
      const r = await authPost<{ ticket: string }>('register/verify', { email: identifier, code });
      if (r.ok) setTicket(r.ticket);
      else {
        setError(r.message);
        setDevCode('');
        setCodeKey((k) => k + 1);
      }
    } else {
      const r = await authPost<{ account: SessionAccount }>('email/verify', { email: identifier, code });
      if (r.ok) onDone(r.account);
      else {
        setError(r.message);
        setDevCode('');
        setCodeKey((k) => k + 1);
      }
    }
    setBusy(false);
  }
  async function submit() {
    if (busy) return;
    if ((method === 'code' || registering) && !sent) return send();
    if (sent && !ticket) {
      if (devCode) return verify(devCode);
      return;
    }
    if (
      registering &&
      (!validPassword(password.trim(), username, identifier.toLowerCase()) || password !== confirm)
    ) {
      setError(
        password !== confirm
          ? '两次输入的密码不一致'
          : '密码需为 8–72 位，不能为纯数字、用户名或邮箱前缀',
      );
      return;
    }
    setBusy(true);
    setError('');
    const r = await authPost<{ account: SessionAccount }>(registering ? 'register/complete' : 'login', {
      identifier,
      password,
      ticket,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onDone(r.account, registering);
    if (registering) location.assign('/account/?registered=1');
  }
  return (
    <form
      className="q-auth"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h1>{registering ? '注册账号' : '登录'}</h1>
      <p>
        {registering
          ? sent
            ? '第 2 步 · 验证邮箱并设置密码'
            : '第 1 步 · 填写账号资料'
          : '一个账号通用长亭、留言板和文章评论。'}
      </p>
      <fieldset disabled={busy}>
        {registering && !sent && (
          <>
            <label>
              用户名
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  e.target.setCustomValidity(usernameError(e.target.value)?.[1] || '');
                }}
              />
            </label>
            <small>注册后不能改，它也是你将来的 Matrix 账号名。中文名请填在昵称。</small>
            <label>
              昵称
              <input
                required
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  e.target.setCustomValidity(
                    validNickname(e.target.value)
                      ? ''
                      : '昵称需为 1–20 个字，最多 3 个 emoji，首尾不能有空格',
                  );
                }}
              />
            </label>
            {nickname && (
              <small>
                别人会看到：<b>{nickname}</b>
              </small>
            )}
            <input ref={hp} hidden tabIndex={-1} autoComplete="off" aria-hidden="true" />
          </>
        )}
        {!sent && (
          <label>
            {registering || method === 'code' ? '邮箱' : '邮箱或用户名'}
            <input
              required
              type={registering || method === 'code' ? 'email' : 'text'}
              autoComplete={registering || method === 'code' ? 'email' : 'username'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </label>
        )}
        {sent && <p>{ticket ? '邮箱已验证' : '验证码已发至 ' + identifier + '，5 分钟内有效。'}</p>}
        {sent && !ticket && <CodeInput key={codeKey} initial={devCode} onComplete={verify} />}
        {((!registering && method === 'password') || ticket) && (
          <label>
            {registering ? '设置密码' : '密码'}
            <input
              required
              type="password"
              autoComplete={registering ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {ticket && (
          <>
            <small>8–72 位，不能为纯数字、用户名或邮箱前缀。</small>
            <label>
              确认密码
              <input
                required
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </>
        )}
        {(!sent || ticket || devCode) && (
          <button
            className="q-auth-primary"
            disabled={!sent && cool > 0 && (registering || method === 'code')}
          >
            {busy
              ? '处理中…'
              : ticket
                ? '完成注册'
                : sent
                  ? '验证邮箱'
                  : registering || method === 'code'
                    ? '发送验证码'
                    : '登录'}
          </button>
        )}
        {sent && !ticket && (
          <button type="button" disabled={cool > 0} onClick={send}>
            {cool ? cool + ' 秒后可重发' : '重新发送'}
          </button>
        )}
        {sent && (
          <button type="button" onClick={reset}>
            返回填写资料
          </button>
        )}
        {error && (
          <p className="text-crimson" role="alert">
            {error}
          </p>
        )}
        <footer>
          {!registering && (
            <button
              type="button"
              onClick={() => {
                reset();
                setMethod(method === 'password' ? 'code' : 'password');
              }}
            >
              {method === 'password' ? '用邮箱验证码登录' : '用密码登录'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              reset();
              setMode(registering ? 'login' : 'register');
            }}
          >
            {registering ? '已有账号？去登录' : '还没有账号？去注册'}
          </button>
          {!registering && config.github && <a href={githubLoginUrl()}>GitHub 登录</a>}
        </footer>
      </fieldset>
    </form>
  );
}
