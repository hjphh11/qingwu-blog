import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { MapPin } from '../../lib/icons';

type Status = 'idle' | 'loading' | 'granted' | 'unknown';

const CITY_KEY = 'qingwu:city';
const OK_KEY = 'qingwu:geolocation-ok';

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('bad status');
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 反向地理编码:主用 bigdatacloud(免Key、CORS*、支持中文),备用 Nominatim。
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`;
    const data = await (await fetchWithTimeout(url, 7000)).json();
    const name = data.city || data.locality || data.principalSubdivision;
    if (name) return name;
  } catch {
    /* 走备用 */
  }
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=zh-CN`;
  const data = await (await fetchWithTimeout(url, 7000)).json();
  const a = data.address ?? {};
  const name = a.city || a.town || a.village || a.municipality || a.county || data.name;
  if (!name) throw new Error('geocode failed');
  return name;
}

// 定位被浏览器拒绝时,退而用 IP 归属拿个大致城市。
async function ipCity(): Promise<string | null> {
  try {
    const data = await (await fetchWithTimeout('https://ipwho.is/', 7000)).json();
    return data.city || data.region || null;
  } catch {
    return null;
  }
}

// 访客所在城市(方案B):浏览器精确定位 → 反向地理编码;失败兜底 IP。
// 持久化:首次授权后记住,以后进站自动静默获取,无需再点。
export default function VisitorCity() {
  const [status, setStatus] = useState<Status>('idle');
  const [city, setCity] = useState('');

  const persist = (name: string) => {
    setCity(name);
    setStatus('granted');
    try {
      localStorage.setItem(CITY_KEY, name);
      localStorage.setItem(OK_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  const locate = (auto = false) => {
    const saved = localStorage.getItem(CITY_KEY);
    if (!(auto && saved)) setStatus('loading');

    const onSuccess = (name: string) => persist(name);
    const onFail = () => {
      // 自动刷新失败时,若已有保存的城市则保留显示;否则显示未知
      if (!(auto && saved)) setStatus('unknown');
    };

    const viaIp = () => ipCity().then((name) => (name ? onSuccess(name) : onFail()));

    if (!navigator.geolocation) {
      viaIp();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          onSuccess(await reverseGeocode(latitude, longitude));
        } catch {
          viaIp();
        }
      },
      () => viaIp(),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };

  // 进站:优先显示已保存的城市;若之前授权过,静默自动刷新位置。
  useEffect(() => {
    const saved = localStorage.getItem(CITY_KEY);
    if (saved) {
      setCity(saved);
      setStatus('granted');
    }
    if (localStorage.getItem(OK_KEY) === '1') {
      locate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 text-sm text-ink/70">
        <MorphIcon icon={MapPin} size={17} className="shrink-0" color="currentColor" />
        <span className="font-medium">猜猜你在哪座城 ˶ᵔ ᵕ ᵔ˶</span>
      </div>

      {status === 'idle' && (
        <div className="mt-2">
          <p className="text-sm text-ink/70">愿意让我看看你在哪座城市吗?</p>
          <button
            type="button"
            onClick={() => locate(false)}
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
        <p className="mt-3 text-sm text-ink/50">
          🏠 未知 &nbsp;<span className="text-xs">(可在浏览器允许定位后重试)</span>
        </p>
      )}
    </div>
  );
}
