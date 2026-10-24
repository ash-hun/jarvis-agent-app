// 앱 진입점. 서버 이벤트를 화면 변화로 옮기고, 세션, 설정, 승인 시트를 잇는다.
import { Capacitor } from '@capacitor/core';

import './reactor/hud.js';
import './reactor/sphere.js';

import * as chat from './chat.ts';
import { Socket, type ServerEvent } from './socket.ts';
import { enablePush, pushState, type PushState } from './push.ts';
import { apiUrl, authHeaders, loadConnection, saveConnection, wsUrl, type Connection } from './connection.ts';

type Agent = { id: string; name: string; quote: string; palette: { primary: string; accent: string; background: string; nebula: string[] } };
type ReactorState = 'idle' | 'thinking' | 'tool_running' | 'error';

declare global {
  interface Window { HUD: { setState(s: ReactorState): void } }
}

const SESSION_KEY = 'jarvis_session';
const DEFAULT_SESSION = 'default';
const ERROR_FLASH_MS = 3000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('input');
const sendBtn = $<HTMLButtonElement>('send');
const statusEl = $('status');
const statusText = $('status-text');
const settings = $<HTMLDialogElement>('settings');
const approval = $<HTMLDialogElement>('approval');
const drawer = $('sessions');

let conn: Connection = loadConnection();
let socket: Socket | null = null;
let agents: Record<string, Agent> = {};
let sessionId = localStorage.getItem(SESSION_KEY) || DEFAULT_SESSION;
let depth = 0;  // 서브 에이전트까지 포함한 루프 중첩. 0 이 되어야 입력을 다시 받는다
let approvalId: string | null = null;
// 접속 직후 히스토리를 받는 동안 온 이벤트. 히스토리가 화면을 비우므로 그 뒤에 다시 흘린다
let backlog: ServerEvent[] | null = null;

class Unauthorized extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(conn, path), {
    ...init,
    headers: { ...authHeaders(conn), 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new Unauthorized('접근 키가 틀렸습니다');
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return res.json();
}

// ── 상태 표시 ────────────────────────────────────────────────────────────────

// 헤더의 작은 표시는 연결만 다룬다. 에이전트 상태는 구체 아래 라벨(hud.js)이 보인다
function setLink(text: string, up: boolean) {
  statusText.textContent = text;
  statusEl.dataset.kind = up ? 'on' : 'off';
}

let errorTimer: ReturnType<typeof setTimeout> | undefined;
function setReactor(state: ReactorState) {
  clearTimeout(errorTimer);
  window.HUD.setState(state);
  if (state === 'error') errorTimer = setTimeout(() => window.HUD.setState(depth > 0 ? 'thinking' : 'idle'), ERROR_FLASH_MS);
}

function setBusy(busy: boolean) {
  document.body.classList.toggle('busy', busy);
  sendBtn.textContent = busy ? '■' : '↑';
  sendBtn.setAttribute('aria-label', busy ? '중단' : '보내기');
  if (!busy) setReactor('idle');
}

function applyAgent(id: string) {
  const a = agents[id];
  $('agent-name').textContent = a?.name ?? id.toUpperCase();
  $('agent-quote').textContent = a?.quote ?? '';
  input.placeholder = `Talk to ${a?.name ?? 'JARVIS'}`;
  if (!a) return;
  // hud.js 와 sphere.js 는 이 이벤트로 링, 구, 별의 색을 약 0.9초에 걸쳐 섞는다
  window.dispatchEvent(new CustomEvent('jarvis:palette', { detail: a.palette }));
  const root = document.documentElement.style;
  root.setProperty('--primary', a.palette.primary);
  root.setProperty('--accent', a.palette.accent);
  root.setProperty('--bg', a.palette.background);
}

// ── 서버 이벤트 ──────────────────────────────────────────────────────────────

function handle(ev: ServerEvent) {
  if (backlog && ev.type !== 'connected') return void backlog.push(ev);
  switch (ev.type) {
    case 'connected':
      sessionId = ev.session_id;
      localStorage.setItem(SESSION_KEY, sessionId);
      applyAgent(ev.agent?.id ?? ev.agent);
      depth = 0;
      setBusy(false);
      void restoreHistory();
      break;

    case 'agent_start':
      if (depth === 0) chat.startAssistant();
      depth++;
      setBusy(true);
      setReactor('thinking');
      break;

    case 'message_update':
      if (ev.text_delta) chat.appendDelta(ev.text_delta);
      break;

    case 'stream_delta':
      chat.appendDelta(ev.text ?? '');
      break;

    case 'tool_execution_start': {
      const args = ev.args ?? {};
      const detail = args.command ?? args.query ?? (Object.keys(args).length ? JSON.stringify(args) : '');
      chat.toolStart(ev.tool_call_id, ev.tool_name ?? 'tool', detail);
      setReactor('tool_running');
      break;
    }

    case 'tool_execution_end':
      chat.toolEnd(ev.tool_call_id, !ev.is_error);
      setReactor('thinking');
      break;

    case 'agent_end':
      depth = Math.max(0, depth - 1);
      if (depth > 0) break;
      chat.endAssistant();
      // /focus 안내 뒤에는 메인 에이전트가 이어 돈다
      if (!ev.continues) setBusy(false);
      break;

    case 'agent_error':
      chat.endAssistant();
      chat.addError(ev.message ?? '알 수 없는 오류');
      depth = 0;
      setBusy(false);
      setReactor('error');
      break;

    case 'error':
      chat.addError(ev.message ?? '오류');
      break;

    case 'inner_thought': {
      const interp = (ev.interpretation ?? '').trim();
      if (interp) chat.addThought(interp, ev.decision ?? 'silent', Math.round((ev.confidence ?? 0) * 100));
      break;
    }

    case 'proactive_message': {
      const text = (ev.text ?? '').trim();
      // answer 는 스트림으로 이미 보인 답이다. 서버가 외부 알림용으로 보낸다
      if (!text || ev.kind === 'answer') break;
      const feedback = ev.kind === 'proactive'
        ? (accepted: boolean) => socket?.send({ type: 'proactive_feedback', id: ev.message_id, accepted })
        : undefined;
      chat.addProactive(text, ev.kind === 'filler', feedback);
      break;
    }

    case 'reminder':
      chat.addReminder(ev.label || ev.title || ev.name, ev.error || ev.text || '', !!ev.error);
      break;

    case 'approval_request':
      showApproval(ev);
      break;

    case 'approval_resolved':
      if (ev.id === approvalId) closeApproval();
      break;
  }
}

async function restoreHistory() {
  backlog = [];
  try {
    const { messages } = await api<{ messages: { role: string; text: string }[] }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    chat.renderHistory(messages);
  } catch (e) {
    chat.addError(`대화 기록을 못 불러왔습니다: ${(e as Error).message}`);
  }
  const queued = backlog;
  backlog = null;
  queued.forEach(handle);
}

function openSession(id: string) {
  socket?.close();
  closeApproval();
  chat.clear();
  sessionId = id;
  socket = new Socket(wsUrl(conn, id, location.origin), {
    onOpen: () => {},
    onEvent: handle,
    onState: (s) => {
      if (s === 'open') setLink('Online', true);
      if (s === 'connecting') setLink('Linking', false);
      if (s === 'closed') setLink('Offline · retrying', false);
    },
    onFatal: (reason) => openSettings(reason),
  });
}

// ── 승인 ─────────────────────────────────────────────────────────────────────

// ponytail: 승인 요청은 한 번에 하나만 띄운다, 떠 있는 동안 새 요청이 오면 앞의 것은 서버 시간 초과(120초)로 거부된다
function showApproval(ev: ServerEvent) {
  approvalId = ev.id;
  $('approval-reason').textContent = ev.reason ?? '';
  $('approval-command').textContent = ev.command ?? '';
  $('approval-always').hidden = !ev.always_pattern;
  if (!approval.open) approval.showModal();
}

function closeApproval() {
  approvalId = null;
  if (approval.open) approval.close();
}

approval.addEventListener('click', (e) => {
  const answer = (e.target as HTMLElement).dataset.answer;
  if (!answer || !approvalId) return;
  socket?.send({ type: 'approval_response', id: approvalId, approved: answer !== 'deny', always: answer === 'always' });
  closeApproval();
});
// 바깥을 눌러 닫거나 스와이프로 내리면 답 없이 사라진다. 승인은 반드시 버튼으로만 끝낸다
approval.addEventListener('cancel', (e) => e.preventDefault());

// ── 입력 ─────────────────────────────────────────────────────────────────────

function submit() {
  if (document.body.classList.contains('busy')) {
    socket?.send({ type: 'abort' });
    return;
  }
  const text = input.value.trim();
  if (!text) return;
  if (!socket?.send({ type: 'user_message', text })) {
    chat.addError('서버에 연결되지 않았습니다');
    return;
  }
  // 새 질문을 보내면 지난 응답을 치운다. 패널에는 이번 응답만 남는다
  chat.clear();
  input.value = '';
  fitInput();
}

function fitInput() {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

$('composer').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
input.addEventListener('input', fitInput);
input.addEventListener('focus', () => document.body.classList.add('typing'));
input.addEventListener('blur', () => document.body.classList.remove('typing'));
input.addEventListener('keydown', (e) => {
  // 한글 조합 중 Enter 는 글자를 확정하는 키라 보내지 않는다
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});

// ── 세션 서랍 ────────────────────────────────────────────────────────────────

async function openDrawer() {
  drawer.hidden = false;
  const list = $('session-list');
  list.replaceChildren();
  try {
    const { sessions, agents: owners } = await api<{ sessions: string[]; agents: Record<string, string> }>('/api/sessions');
    for (const id of sessions) {
      const li = document.createElement('li');
      li.innerHTML = `<button><b></b><small></small></button>`;
      li.querySelector('b')!.textContent = id;
      li.querySelector('small')!.textContent = agents[owners[id]]?.name ?? owners[id];
      li.classList.toggle('current', id === sessionId);
      li.querySelector('button')!.onclick = () => { drawer.hidden = true; openSession(id); };
      list.append(li);
    }
  } catch (e) {
    list.textContent = (e as Error).message;
  }
}

function renderAgentButtons() {
  const box = $('agent-list');
  box.replaceChildren();
  for (const a of Object.values(agents)) {
    const b = document.createElement('button');
    b.textContent = `+ ${a.name}`;
    b.style.setProperty('--agent', a.palette.primary);
    b.onclick = async () => {
      // 새 세션 생성은 멱등하지 않다(api-spec). 응답 전 다시 누르면 빈 세션이 쌓이므로 막는다
      box.querySelectorAll('button').forEach((x) => (x.disabled = true));
      try {
        const { session_id } = await api<{ session_id: string }>('/api/sessions', {
          method: 'POST',
          body: JSON.stringify({ agent: a.id }),
        });
        drawer.hidden = true;
        openSession(session_id);
      } catch (e) {
        chat.addError((e as Error).message);
      } finally {
        box.querySelectorAll('button').forEach((x) => (x.disabled = false));
      }
    };
    box.append(b);
  }
}

$('open-sessions').onclick = () => void openDrawer();
drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.hidden = true; });

// ── 설정 ─────────────────────────────────────────────────────────────────────

function openSettings(error?: string) {
  $<HTMLInputElement>('server').value = conn.server;
  $<HTMLInputElement>('token').value = conn.token;
  const err = $('settings-error');
  err.hidden = !error;
  err.textContent = error ?? '';
  // 버튼 없이 닫히면 returnValue 가 지난 값으로 남아 '저장'이 다시 실행된다
  settings.returnValue = '';
  if (!settings.open) settings.showModal();
}

settings.addEventListener('close', () => {
  if (settings.returnValue !== 'save') return;
  conn = saveConnection({ server: $<HTMLInputElement>('server').value, token: $<HTMLInputElement>('token').value });
  void start();
});
$('open-settings').onclick = () => { openSettings(); void showPushState(); };

// ── 알림 ─────────────────────────────────────────────────────────────────────

const PUSH_TEXT: Record<PushState, string> = {
  unsupported: '이 환경은 알림을 받을 수 없다',
  'needs-install': 'Safari 공유 > 홈 화면에 추가 후 그 앱에서 켤 수 있다',
  denied: '알림이 거부돼 있다. iPhone 설정 > 알림 > JARVIS 에서 허용',
  off: '꺼짐',
  on: '켜짐',
};
const pushBtn = $<HTMLButtonElement>('push-enable');

function renderPush(state: PushState) {
  $('push-state').textContent = PUSH_TEXT[state];
  // 켜진 뒤에도 누를 수 있게 둔다. 서버의 구독 저장을 다시 맞추는 용도다
  pushBtn.hidden = state === 'unsupported' || state === 'needs-install' || state === 'denied';
  pushBtn.textContent = state === 'on' ? '다시 등록' : '알림 켜기';
}

async function showPushState() {
  renderPush(Capacitor.isNativePlatform() ? 'unsupported' : await pushState());
}

pushBtn.onclick = async () => {
  pushBtn.disabled = true;
  try {
    renderPush(await enablePush(api));
  } catch (e) {
    $('push-state').textContent = `실패: ${(e as Error).message}`;
  } finally {
    pushBtn.disabled = false;
  }
};

// 알림은 service worker 가 받는다. 네이티브 앱의 WebView 에는 Web Push 가 없어 등록하지 않는다
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[push] sw 등록 실패', e));
}

// ── 시작 ─────────────────────────────────────────────────────────────────────

async function start() {
  try {
    const list = await api<{ agents: Agent[] }>('/api/agents');
    agents = Object.fromEntries(list.agents.map((a) => [a.id, a]));
    renderAgentButtons();
  } catch (e) {
    socket?.close();
    setLink('Offline', false);
    return openSettings(e instanceof Unauthorized ? e.message : `서버에 닿지 않습니다: ${(e as Error).message}`);
  }
  openSession(sessionId);
}

// 앱에는 같은 출처의 서버가 없으므로 주소가 없으면 설정부터
if (Capacitor.isNativePlatform() && !conn.server) openSettings();
else void start();
