// 알림만 다룬다. 앱이 꺼져 있어도 서버의 Web Push 를 받아 iOS 알림으로 띄운다. 캐시는 하지 않는다(앱은 서버 없이 쓸 데가 없다).
// 서버가 보내는 본문: {"title": "...", "body": "...", "tag": "...", "icon"?: "..."}. tag 가 같으면 앞 알림을 덮는다. icon 은 보낸 에이전트의 아바타다.
// Ion 사고는 {"type": "incident", "id", "actions": [...], ...} 로 온다. 버튼을 보이는 곳(macOS, Android)에서는 알림에서 바로 답하고,
// iOS 는 버튼을 보이지 않으므로 누르면 앱을 열어 띠에서 답한다.

const LABELS = { restart: '재기동', stop: '멈춤', pause: '작업 멈춤', ignore: '무시' };
const DB = 'jarvis-sw';
const STORE = 'kv';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// 페이지가 넘겨 준 서버 주소와 접근 키. localStorage 는 여기서 못 읽어 IndexedDB 에 둔다. 같은 값을 몇 번 받아도 하나다
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kv(mode, run) {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const req = run(conn.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'connection') return;
  event.waitUntil(kv('readwrite', (store) => store.put({ server: data.server || '', token: data.token || '' }, 'connection')));
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const options = {
    body: data.body || '',
    tag: data.tag,
    // 아바타는 서버 기준 경로(/...)로 올 수 있다. iOS 는 icon 을 무시할 수 있다
    icon: data.icon ? new URL(data.icon, self.location.origin).href : 'icons/icon-192.png',
  };
  if (data.type === 'incident') {
    options.data = { id: data.id, actions: data.actions || [] };
    // 버튼은 브라우저가 허용하는 수만큼만. iOS 는 0 이라 넣지 않는다
    const max = (self.Notification && self.Notification.maxActions) || 0;
    if (max > 0) options.actions = options.data.actions.slice(0, max).map((a) => ({ action: a, title: LABELS[a] || a }));
  }
  // iOS 는 알림을 띄우지 않는 push 를 몇 번 받으면 구독을 끊는다. 본문이 비어도 반드시 띄운다
  event.waitUntil(self.registration.showNotification(data.title || 'JARVIS', options));
});

// 알림의 버튼으로 답한다. 결과는 같은 tag 로 띄워 원래 알림 자리에 보인다. 같은 답을 두 번 보내도 Ion 은 처음 것만 행동으로 옮긴다
async function respond(notification, action) {
  const conn = (await kv('readonly', (store) => store.get('connection')).catch(() => null)) || {};
  const base = conn.server || self.location.origin;
  const headers = { 'Content-Type': 'application/json' };
  if (conn.token) headers.Authorization = `Bearer ${conn.token}`;
  const name = LABELS[action] || action;
  let result;
  try {
    const res = await fetch(`${base}/ion/incidents/${encodeURIComponent(notification.data.id)}/respond`, {
      method: 'POST', headers, body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => ({}));
    result = res.ok ? `${name}, ${(body.incident && body.incident.action_result) || '받음'}` : `${name} 실패, HTTP ${res.status}`;
  } catch {
    result = `${name} 실패, 서버에 못 붙음`;
  }
  await self.registration.showNotification(notification.title, { body: result, tag: notification.tag, icon: notification.icon });
}

async function openApp(notification) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const win = wins.length ? await wins[0].focus() : await self.clients.openWindow(self.registration.scope);
  if (win && notification.data) win.postMessage({ type: 'ion', id: notification.data.id });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  if (data && data.id && event.action) {
    event.waitUntil(respond(event.notification, event.action));
    return;
  }
  event.waitUntil(openApp(event.notification));
});
