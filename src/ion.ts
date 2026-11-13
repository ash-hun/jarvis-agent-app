// Ion(플랫폼 감시)의 열린 사고를 리액터 아래 띠로 보이고 버튼으로 답한다. 배경은 심각도로 물든다.
// /ion/ 은 nginx 가 Ion 컨테이너로 보내 백엔드가 죽어도 산다. 푸시 알림을 누르면 service worker 가 여기로 신호한다.
import { apiUrl, authHeaders, loadConnection } from './connection.ts';
import { describe, fromNotification, label, worst, type Incident } from './ion-card.ts';

// SSE 가 끊겨 있어도 이 주기로 다시 읽는다
const REFRESH_MS = 60_000;
// 답한 사고는 결과를 잠깐 보이고 띠에서 지운다
const DONE_LINGER_MS = 8_000;
// SSE 는 끊기면 브라우저가 다시 붙는데, 서버 주소를 바꾼 뒤에는 새로 만들어야 한다
const strip = document.getElementById('ion-strip')!;
const list = document.getElementById('ion-list')!;
const rows = new Map<string, { incident: Incident; el: HTMLElement }>();
let source: EventSource | null = null;
let sourceServer: string | null = null;

function render() {
  strip.hidden = rows.size === 0;
  const severity = worst([...rows.values()].map((r) => r.incident));
  if (severity) document.body.dataset.ion = severity;
  else delete document.body.dataset.ion;
}

function line(incident: Incident): HTMLElement {
  const view = describe(incident);
  const el = document.createElement('li');
  el.className = 'ion-item';
  const title = document.createElement('span');
  title.className = 'ion-title';
  title.textContent = view.title;
  const detail = document.createElement('span');
  detail.className = 'ion-detail';
  detail.textContent = view.detail;
  el.append(title, detail);
  if (view.result) {
    const result = document.createElement('span');
    result.className = 'ion-result';
    result.textContent = view.result;
    el.append(result);
    return el;
  }
  view.actions.forEach((action, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label(action);
    if (i === 0) btn.classList.add('primary');
    btn.onclick = () => void respond(incident.id, action);
    el.append(btn);
  });
  return el;
}

function upsert(incident: Incident) {
  const prev = rows.get(incident.id);
  const el = line(incident);
  if (prev) prev.el.replaceWith(el);
  else list.append(el);
  rows.set(incident.id, { incident, el });
  if (incident.response) setTimeout(() => remove(incident.id), DONE_LINGER_MS);
}

function remove(id: string) {
  rows.get(id)?.el.remove();
  rows.delete(id);
  render();
}

// 서버의 열린 사고 목록에 맞춘다. 답한 사고는 결과를 보이는 동안 남긴다
function sync(incidents: Incident[]) {
  const live = new Set(incidents.map((i) => i.id));
  incidents.forEach(upsert);
  for (const [id, { incident }] of rows) if (!live.has(id) && !incident.response) remove(id);
  render();
}

async function load() {
  const conn = loadConnection();
  try {
    const res = await fetch(apiUrl(conn, '/ion/status'), { headers: authHeaders(conn) });
    if (!res.ok) return;
    sync(((await res.json()) as { incidents?: Incident[] }).incidents ?? []);
  } catch {
    // Ion 이 없거나 서버에 못 붙으면 띠는 숨긴 채 둔다. 소켓 상태 표시가 연결 문제를 따로 보인다
  }
}

async function respond(id: string, action: string) {
  const row = rows.get(id);
  row?.el.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  const conn = loadConnection();
  try {
    const res = await fetch(apiUrl(conn, `/ion/incidents/${encodeURIComponent(id)}/respond`), {
      method: 'POST',
      headers: { ...authHeaders(conn), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    upsert(((await res.json()) as { incident: Incident }).incident);
    render();
  } catch {
    row?.el.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

function subscribe() {
  const conn = loadConnection();
  if (source && sourceServer === conn.server) return;
  source?.close();
  sourceServer = conn.server;
  const qs = conn.token ? `?token=${encodeURIComponent(conn.token)}` : '';
  source = new EventSource(apiUrl(conn, `/ion/events${qs}`));
  source.addEventListener('incident', (event) => {
    upsert(fromNotification(JSON.parse((event as MessageEvent<string>).data)));
    render();
  });
  source.addEventListener('incident_update', (event) => {
    upsert((JSON.parse((event as MessageEvent<string>).data) as { incident: Incident }).incident);
    render();
  });
  // 다시 붙을 때마다(Ion 재시작 뒤 등) 놓친 사고를 목록으로 맞춘다
  source.onopen = () => void load();
}

// service worker 는 localStorage 를 못 읽는다. 알림의 버튼이 서버를 부를 수 있게 주소와 키를 넘겨 둔다
async function shareConnection() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  reg?.active?.postMessage({ type: 'connection', ...loadConnection() });
}

function refresh() {
  subscribe();
  void load();
  void shareConnection();
}

if ('serviceWorker' in navigator) {
  // 알림을 눌러 앱이 열리거나 앞으로 오면 그 사고를 바로 보인다
  navigator.serviceWorker.addEventListener('message', (event) => {
    if ((event.data as { type?: string } | null)?.type === 'ion') void load();
  });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
// 서버 연결 시트를 저장하면 주소와 키가 바뀐다
document.getElementById('settings')?.addEventListener('close', refresh);

refresh();
setInterval(() => void load(), REFRESH_MS);
