/**
 * 访客城市（从 `components/home/VisitorCity.tsx` 抽出来的，供首页 NowLine 复用）。
 *
 * 为什么抽成 hook：原来这段逻辑（约 110 行：浏览器定位 → 反向地理编码 → 失败兜底 IP
 * → localStorage 记忆）是长在卡片组件里的。首页要把「城市」压进一条 NowLine，
 * 而长卡片不再渲染 —— 逻辑必须有地方放，又不能复制一份（两份会各自去定位，互相打架）。
 *
 * 时序约束没有变：首帧必须是「未知」，不能读 localStorage（服务端读不到，
 * 直接渲染会和 SSR 的 HTML 对不上 → hydration mismatch）。
 */

import { useCallback, useEffect, useState } from 'react';

export type CityStatus = 'idle' | 'loading' | 'granted' | 'unknown';

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

// 反向地理编码:主用 bigdatacloud(免 Key、CORS*、支持中文),备用 Nominatim。
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

export function useVisitorCity() {
  const [status, setStatus] = useState<CityStatus>('idle');
  const [city, setCity] = useState('');

  const persist = useCallback((name: string) => {
    setCity(name);
    setStatus('granted');
    try {
      localStorage.setItem(CITY_KEY, name);
      localStorage.setItem(OK_KEY, '1');
    } catch {
      /* 隐私模式下写不进去,不影响本次显示 */
    }
  }, []);

  /** auto=true 表示「之前授权过,静默刷新」—— 失败时保留已保存的城市，不显示未知 */
  const locate = useCallback(
    (auto = false) => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(CITY_KEY);
      } catch {
        /* ignore */
      }
      if (!(auto && saved)) setStatus('loading');

      const onSuccess = (name: string) => persist(name);
      const onFail = () => {
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
    },
    [persist],
  );

  // 进站:优先显示已保存的城市;若之前授权过,静默自动刷新位置。
  // 首帧不读 localStorage —— 服务端读不到，直接渲染会和 SSR 的 HTML 对不上。
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CITY_KEY);
      if (saved) {
        setCity(saved);
        setStatus('granted');
      }
      if (localStorage.getItem(OK_KEY) === '1') locate(true);
    } catch {
      /* ignore */
    }
  }, [locate]);

  return {
    city,
    status,
    /** 用户主动点击时调用（会弹定位授权） */
    locate: () => locate(false),
  };
}
