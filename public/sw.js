// 알림만 다룬다. 앱이 꺼져 있어도 서버의 Web Push 를 받아 iOS 알림으로 띄운다. 캐시는 하지 않는다(앱은 서버 없이 쓸 데가 없다).
// 서버가 보내는 본문: {"title": "...", "body": "...", "tag": "...", "icon"?: "..."}. tag 가 같으면 앞 알림을 덮는다. icon 은 보낸 에이전트의 아바타다.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  // iOS 는 알림을 띄우지 않는 push 를 몇 번 받으면 구독을 끊는다. 본문이 비어도 반드시 띄운다
  event.waitUntil(self.registration.showNotification(data.title || 'JARVIS', {
    body: data.body || '',
    tag: data.tag,
    // 아바타는 서버 기준 경로(/...)로 올 수 있다. iOS 는 icon 을 무시할 수 있다
    icon: data.icon ? new URL(data.icon, self.location.origin).href : 'icons/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
