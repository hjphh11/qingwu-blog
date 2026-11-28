import { useEffect, useState } from 'react';
import AuthDialog from './AuthDialog';
import { DEFAULT_CONFIG, fetchMe } from '../../lib/auth';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  useEffect(() => {
    void fetchMe().then((r) => {
      setConfig(r.config);
      if (r.account) location.replace('/account/');
    });
  }, []);
  return (
    <div className="q-auth-page">
      <AuthDialog
        open
        page
        mode={mode}
        config={config}
        onClose={() => location.assign('/')}
        onDone={(_, created) => {
          if (!created) location.assign('/account/');
        }}
      />
    </div>
  );
}
