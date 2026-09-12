import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Shell from './components/Shell.jsx';

export default function App() {
  const [phase, setPhase] = useState('checking'); // checking | out | in
  /** 回登录页时要说清原因（会话过期 / 服务器换了密钥）*/
  const [notice, setNotice] = useState('');

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

  // 阶段 N：任何接口回 401（会话过期、服务器重启换了密钥、cookie 没了）就回登录页。
  // 以前只会把「请先登录」当普通错误显示在页面上，人卡在一个打不开的页面里。
  useEffect(() => {
    const onUnauthorized = (e) => {
      setNotice(e?.detail?.message || '登录已过期');
      setPhase('out');
    };
    window.addEventListener('qingwu:unauthorized', onUnauthorized);
    return () => window.removeEventListener('qingwu:unauthorized', onUnauthorized);
  }, []);

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* 就算请求失败也回登录页 */
    }
    setNotice('');
    setPhase('out');
  };

  return (
    <>
      <div className="app-bg" />
      {phase === 'checking' && <div className="boot">正在连接后台…</div>}
      {phase === 'out' && (
        <Login
          notice={notice}
          onSuccess={() => {
            setNotice('');
            setPhase('in');
          }}
        />
      )}
      {phase === 'in' && <Shell onLogout={logout} />}
    </>
  );
}
