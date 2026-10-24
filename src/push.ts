// Web Push 구독. 홈 화면에 추가한 웹앱만 iOS 알림을 받을 수 있다(Safari 탭, Capacitor 앱은 불가).

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

// VAPID 공개키(base64url)를 subscribe 가 받는 바이트로
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function standalone() {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iOS Safari 탭에는 PushManager 가 없다. 홈 화면 앱이 되어야 생긴다
    return /iPhone|iPad/.test(navigator.userAgent) && !standalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

// 이미 구독돼 있으면 같은 구독을 다시 서버에 맞춘다. 서버는 endpoint 로 upsert 하므로 몇 번 눌러도 구독은 하나다
export async function enablePush(
  api: <T>(path: string, init?: RequestInit) => Promise<T>,
): Promise<PushState> {
  // iOS 는 사용자 탭 안에서 권한을 물어야 한다. 이 함수는 버튼 클릭에서만 부른다
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { public_key } = await api<{ public_key: string }>('/api/push/vapid');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) });
  }
  await api('/api/push/subscriptions', { method: 'PUT', body: JSON.stringify(sub.toJSON()) });
  return 'on';
}
