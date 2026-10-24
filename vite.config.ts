import { defineConfig } from 'vite';

// 개발 중에는 같은 출처로 프록시해서 CORS 없이 로컬 jarvis 백엔드에 붙는다
const JARVIS_URL = process.env.JARVIS_URL ?? 'http://localhost:7777';

export default defineConfig({
  // 어느 경로에 올려도 돌게 한다(tailscale serve --set-path /m)
  base: './',
  // tailscale serve 가 넘겨주는 Host(*.ts.net)를 vite 가 막지 않게 한다
  preview: { allowedHosts: ['.ts.net'] },
  server: {
    proxy: {
      '/api': JARVIS_URL,
      '/ws': { target: JARVIS_URL, ws: true },
    },
  },
});
