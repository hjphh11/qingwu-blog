import { useEffect, useState } from 'react';
import { changeGuestSession } from '../../lib/chat';

export default function ChatGuestForm({ onBusyChange, onDone }: { onBusyChange: (busy: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
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
      <fieldset disabled={busy}>
        <label>
          昵称
          <input name="name" required autoComplete="nickname" maxLength={40} />
        </label>
        <label>
          邮箱
          <input name="email" type="email" required autoComplete="email" maxLength={254} />
        </label>
        <small>聊天时会显示访客标记，邮箱用于生成头像。</small>
        {error && (
          <p className="text-crimson" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="q-auth-primary">
          {busy ? '正在进入…' : '访客登录'}
        </button>
      </fieldset>
    </form>
  );
}
