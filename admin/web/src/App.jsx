import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const [phase, setPhase] = useState('checking'); // checking | out | in

  const check = useCallback(async () => {
    try {
      const me = await api.get('/api/auth/me');
      setPhase(me.authed ? 'in' : 'out');
    } catch {
      setPhase('out');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* 就算请求失败也回登录页 */
    }
    setPhase('out');
  };

  return (
    <>
      <div className="app-bg" />
      {phase === 'checking' && <div className="boot">正在连接后台…</div>}
      {phase === 'out' && <Login onSuccess={() => setPhase('in')} />}
      {phase === 'in' && <Shell onLogout={logout} />}
    </>
  );
}
