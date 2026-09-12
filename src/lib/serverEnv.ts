// 同时读**本地**(.env 由 Vite 注入 import.meta.env)与**线上**(Vercel 的 process.env)。
// 本地开发只配 .env 时 process.env 里没有；线上则相反。两处都读才两边都能跑。
export const env = (key: string): string =>
  (import.meta.env[key] as string | undefined) || process.env[key] || '';
