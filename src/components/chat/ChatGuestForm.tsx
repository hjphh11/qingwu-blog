import { useState } from 'react';
import { changeGuestSession } from '../../lib/chat';

export default function ChatGuestForm({ onLogin, onDone }: { onLogin: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="q-auth"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const data = new FormData(e.currentTarget);
        setBusy(true);
        setError('');
        const message = await changeGuestSession({
          name: String(data.get('name')),
          email: String(data.get('email')),
        });
        setBusy(false);
        if (message) setError(message);
        else onDone();
      }}
    >
      <h1>以访客身份进入长亭</h1>
      <p>聊天时会显示你的名字和访客标记。邮箱用于生成头像。</p>
      <fieldset disabled={busy}>
        <label>
          名字
          <input name="name" required autoComplete="nickname" maxLength={40} />
        </label>
        <label>
          邮箱
          <input name="email" type="email" required autoComplete="email" maxLength={254} />
        </label>
        {error && (
          <p className="text-crimson" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="q-auth-primary">
          {busy ? '正在进入…' : '进入长亭'}
        </button>
        <footer>
          <button type="button" onClick={onLogin}>
            已有账号？账号登录
          </button>
        </footer>
      </fieldset>
    </form>
  );
}
