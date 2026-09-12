import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 开发时前端在 5173，接口在 3000 —— 代理过去，cookie 同源
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
  },
});
