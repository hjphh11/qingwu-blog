import { useState } from 'react';

type Status = 'idle' | 'loading' | 'granted' | 'unknown';

// 访客所在城市(方案B):浏览器精确定位 + OpenStreetMap Nominatim 反查。
export default function VisitorCity() {
  const [status, setStatus] = useState<Status>('idle');
  const [city, setCity] = useState('');

  const locate = () => {
    if (!navigator.geolocation) {
      setStatus('unknown');
      return;
    }
    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=zh-CN`;
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error('geocode failed');
          const data = await res.json();
          const a = data.address ?? {};
          const name =
            a.city || a.town || a.village || a.municipality || a.county || data.name;
          setCity(name || '未知');
          setStatus('granted');
        } catch {
          setStatus('unknown');
        } finally {
          clearTimeout(timer);
        }
      },
      () => setStatus('unknown'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 text-sm text-ink/60">
        <span>📍</span>
        <span className="uppercase tracking-wide">访客所在城市</span>
      </div>

      {status === 'idle' && (
        <div className="mt-2">
          <p className="text-sm text-ink/70">愿意让我看看你在哪座城市吗?</p>
          <button
            type="button"
            onClick={locate}
            className="mt-3 rounded-full bg-rose/70 px-4 py-1.5 text-sm text-ink transition-colors hover:bg-rose"
          >
            同意定位
          </button>
        </div>
      )}

      {status === 'loading' && (
        <p className="mt-3 text-sm text-ink/50">定位中…</p>
      )}

      {status === 'granted' && (
        <p className="mt-3 font-display text-xl text-crimson">🏙 {city}</p>
      )}

      {status === 'unknown' && (
        <p className="mt-3 font-display text-xl text-ink/50">🏠 未知</p>
      )}
    </div>
  );
}
