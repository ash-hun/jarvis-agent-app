import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ashhun.jarvis',
  appName: 'JARVIS',
  webDir: 'dist',
  // 앱의 출처(capacitor://localhost)와 서버가 달라도 fetch 가 네이티브로 나가서 백엔드에 CORS 가 필요 없다
  plugins: { CapacitorHttp: { enabled: true } },
};

export default config;
