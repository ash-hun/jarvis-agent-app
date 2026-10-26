// 앱 진입점. 서버 이벤트를 화면 변화로 옮기고, 세션, 설정, 승인 시트를 잇는다.
import { Capacitor, registerPlugin } from '@capacitor/core';

import './reactor/hud.js';
import './reactor/sphere.js';

import * as chat from './chat.ts';
import { onSwipe } from './swipe.ts';
import { attachSlash } from './slash.ts';
import { Mic } from './mic.ts';
import { Voice, type VoiceState } from './voice.ts';
import { Socket, type ServerEvent } from './socket.ts';
import { isWakeCall } from './wake-call.ts';
import { focusCommandFromSpeech } from './focus-speech.ts';
import { parseApprovalAnswer } from './approval-answer.ts';
import { enablePush, pushState, type PushState } from './push.ts';
import { apiUrl, authHeaders, loadConnection, saveConnection, wsUrl, type Connection } from './connection.ts';

type Agent = { id: string; name: string; quote: string; palette: { primary: string; accent: string; background: string; nebula: string[] } };
type ReactorState = 'idle' | 'listening' | 'thinking' | 'tool_running' | 'speaking' | 'error';

declare global {
  interface Window { HUD: { setState(s: ReactorState): void } }
}

const SESSION_KEY = 'jarvis_session';
// 에이전트 id → 그 에이전트로 마지막에 쓴 세션. 스와이프로 돌아올 때 같은 대화로 붙는다
const AGENT_SESSIONS_KEY = 'jarvis_agent_sessions';
const DEFAULT_SESSION = 'default';
const ERROR_FLASH_MS = 3000;
const STT_LANG = 'ko-KR';
// 이 도구가 시작되면 미리 녹음한 문구를 읽는다(HUD events.js 와 같다)
const CUE_BY_TOOL: Record<string, string> = { web_search: 'web_search', remember_task_pattern: 'remember_pattern' };
const SPEECH_COMMAND_MAX = 120;
// 읽기 꼬리가 녹음에 들어가지 않게 읽기가 끝난 뒤 잠깐 쉬고 듣는다
const LISTEN_AFTER_SPEECH_MS = 250;
// 음성 승인 답을 기다리며 다시 듣는 횟수 상한. 전사가 비거나 실패해도 승인 시한(120초) 동안 이어 듣는다
const APPROVAL_LISTEN_MAX = 20;
// 서버 분류기는 6초 안에 답한다. 더 늦으면 연결 문제로 보고 거부 쪽으로 간다
const REPLY_TIMEOUT_MS = 8000;
const HEARD_SPEECH: Record<'allow' | 'always' | 'deny', string> = {
  allow: '허용으로 들었습니다.',
  always: '항상 허용으로 들었습니다.',
  deny: '거부로 들었습니다.',
};
// 서버는 영어 글을 JARVIS 목소리(Piper)로 읽고, SPEAK_ENGLISH 는 이 에이전트의 답만 영어로 옮긴다.
// 앱이 만드는 승인 질문도 이 에이전트면 영어로 써서 같은 목소리로 듣게 한다(번역을 기다리지 않는다)
const JARVIS_VOICE_AGENT = 'main';
const HEARD_SPEECH_EN: typeof HEARD_SPEECH = {
  allow: 'Allowed, sir.',
  always: 'Always allowed, sir.',
  deny: 'Denied, sir.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('input');
const sendBtn = $<HTMLButtonElement>('send');
const statusEl = $('status');
const statusText = $('status-text');
const settings = $<HTMLDialogElement>('settings');
const approval = $<HTMLDialogElement>('approval');
const drawer = $('sessions');
const sphere = document.querySelector<HTMLElement>('.sphere-wrap')!;

let conn: Connection = loadConnection();
let socket: Socket | null = null;
let agents: Record<string, Agent> = {};
let sessionId = localStorage.getItem(SESSION_KEY) || DEFAULT_SESSION;
let currentAgent = '';
let agentSessions: Record<string, string> = readJson(AGENT_SESSIONS_KEY);
let depth = 0;  // 서브 에이전트까지 포함한 루프 중첩. 0 이 되어야 입력을 다시 받는다
let approvalId: string | null = null;
let approvalReq: ServerEvent | null = null;
let approvalListens = 0;  // 음성 승인 답을 기다리며 남은 듣기 횟수
let replyClassifier = false;  // connected.reply_classifier. 사고가 꺼져 있으면 묻지 않는다
const classifying = new Map<string, (verdict: string) => void>();  // 승인 id → 분류 결과를 기다리는 쪽
// 접속 직후 히스토리를 받는 동안 온 이벤트. 히스토리가 화면을 비우므로 그 뒤에 다시 흘린다
let backlog: ServerEvent[] | null = null;
// 이번 요청을 말로 시작했는지. HUD 의 Default 모드처럼 그때만 답을 소리 내어 읽는다
let voiceMode = false;
let deferredReply = false;  // 대기 안내(filler)를 받았다. 다음 답은 뒤로 넘긴 작업의 답이다
let spokenUpTo = 0;  // 이번 응답에서 이미 읽어 달라고 한 글자 수. 도구 사이의 말을 차례대로 읽는다
let focusOn = false;
let focusCommanded = false;  // 마지막으로 보낸 말이 /focus 였는지. 접속 때 되살아난 Focus 는 읽지 않는다
let analysisBusy = false;
let wakeEnabled = false;  // connected.voice.wake. 서버가 웨이크워드 오디오를 받는지

function readJson(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

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
  currentAgent = id;
  const a = agents[id];
  document.querySelectorAll<HTMLElement>('.agent-dots i').forEach((dot) => dot.classList.toggle('on', dot.dataset.id === id));
  $('agent-name').textContent = a?.name ?? id.toUpperCase();
  $('agent-quote').textContent = a?.quote ?? '';
  resetPlaceholder();
  if (!a) return;
  // hud.js 와 sphere.js 는 이 이벤트로 링, 구, 별의 색을 약 0.9초에 걸쳐 섞는다
  window.dispatchEvent(new CustomEvent('jarvis:palette', { detail: a.palette }));
  const root = document.documentElement.style;
  root.setProperty('--primary', a.palette.primary);
  root.setProperty('--accent', a.palette.accent);
  root.setProperty('--bg', a.palette.background);
}

function resetPlaceholder() {
  input.placeholder = `Talk to ${agents[currentAgent]?.name ?? 'JARVIS'}`;
}

// ── 음성 ─────────────────────────────────────────────────────────────────────

const mic = new Mic();
// ios/App/App/SpeechPlugin.swift
const Speech = registerPlugin<{ transcribe(o: { data: string; lang: string }): Promise<{ text: string }> }>('Speech');

const voice = new Voice({
  mic,
  keepMic: () => wakeEnabled,
  send: (msg) => socket?.send(msg) ?? false,
  async fetchPhrase(name) {
    const res = await fetch(apiUrl(conn, `/api/voice/phrases/${encodeURIComponent(name)}`), { headers: authHeaders(conn) });
    return res.ok ? res.arrayBuffer() : null;
  },
  onState(state: VoiceState) {
    sphere.classList.remove('voice-listening', 'voice-processing', 'voice-speaking');
    if (state !== 'idle') sphere.classList.add(`voice-${state}`);
    if (state === 'listening' || state === 'speaking') setReactor(state);
    else if (state === 'idle') {
      setReactor(depth > 0 ? 'thinking' : 'idle');
      listenAgainForApproval();
    }
  },
  transcribe: Capacitor.isNativePlatform()
    ? async (data) => (await Speech.transcribe({ data, lang: STT_LANG })).text
    : undefined,
  onTranscript: (text) => onTranscript(text),
  onNoSpeech(peak) {
    // 승인 답을 기다리며 되풀이해 듣는 중이면 줄이 쌓인다
    if (!approvalId) chat.addError(`말소리를 듣지 못했습니다(최대 음량 ${peak.toFixed(3)})`);
  },
  speaker: () => agents[currentAgent]?.name ?? 'JARVIS',
  // JARVIS 는 서버가 글 전체를 영어로 옮겨 읽는다. 문장마다 옮기면 문맥이 끊긴다
  splitSpeech: () => currentAgent !== JARVIS_VOICE_AGENT,
  onLocked() {
    if (sphere.classList.contains('audio-locked')) return;
    sphere.classList.add('audio-locked');
    chat.addError('소리가 잠겨 있어 읽지 못했습니다. 구체를 한 번 탭하세요');
  },
  onError(message) {
    approvalListens = 0;  // 권한 거부 같은 녹음 오류에서 듣기를 되풀이하지 않는다
    chat.addError(message);
  },
});

// 기다리는 동안에만 마이크 소리를 서버로 흘린다. 듣기, 읽기, 응답, 승인 중의 "Jarvis" 는 대화의 일부다
function waitingForWake() {
  return wakeEnabled && !document.hidden && voice.state === 'idle' && !voice.isSpeaking() && depth === 0 && !approvalId;
}

mic.onFrame((pcm) => {
  if (waitingForWake()) socket?.sendBinary(pcm);
});

// 접속마다 서버가 알려 준다. 몇 번 불러도 같은 상태로 맞춘다
function setWake(on: boolean) {
  wakeEnabled = on;
  if (on) mic.ensure().catch((e) => chat.addError(`웨이크워드 꺼짐: ${(e as Error).message}`));
  else if (voice.state !== 'listening') mic.close();
}

// "Jarvis" 를 들었다. 대답 문구를 읽고 듣기를 연다. 그사이 다른 일이 시작됐으면 듣지 않는다
async function onWake(score: number) {
  if (!waitingForWake()) return;
  // 부르지 않았는데 깨는지 가르려고 남긴다(HUD Activity 의 "◉ wake" 와 같다)
  chat.addNote(`◉ 웨이크 감지 (점수 ${score.toFixed(2)})`);
  await voice.cue('wake_up');
  if (waitingForWake()) void voice.start();
}

async function answerWakeCall() {
  voice.setIdle();
  await voice.cue('wake_up');
  if (voice.state === 'idle' && !approvalId) void voice.start();
}

// 앱을 내렸다 오면 iOS 가 마이크를 끊어 둔다. 돌아오면 다시 잡는다
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  mic.resume();
  if (wakeEnabled) setWake(true);
});
// iOS 는 제스처 전에는 컨텍스트를 멈춰 둔다. 어디든 첫 터치에서 깨운다
document.addEventListener('pointerdown', () => {
  mic.resume();
  sphere.classList.remove('audio-locked');
});

// 말로 시작한 요청이면 응답 중 아직 읽지 않은 부분을 읽는다. 읽을 게 있었으면 true
function speakNewText(source: string) {
  const text = chat.assistantText();
  const piece = text.slice(spokenUpTo).trim();
  spokenUpTo = text.length;
  if (!voiceMode || !piece) return false;
  voice.requestSpeech(piece, source);
  return true;
}

// 말로 일하는 중일 때만 녹음 문구를 읽는다
function cue(name: string) {
  if (voiceMode) void voice.cue(name);
}

function approvalSpeech(command: string, always: boolean) {
  const cmd = command.length > SPEECH_COMMAND_MAX ? `${command.slice(0, SPEECH_COMMAND_MAX)}…` : command;
  if (currentAgent === JARVIS_VOICE_AGENT) return `Sir, shall I run ${cmd}? ${always ? 'Allow, always, or deny.' : 'Allow or deny.'}`;
  return `명령 ${cmd} 를 실행할까요. ${always ? '허용, 항상, 거부' : '허용, 거부'}.`;
}

// 읽던 것과 기다리던 읽기를 멈춘다. 멈춘 뒤엔 승인 답을 다시 듣지 않는다
function stopSpeech() {
  approvalListens = 0;
  voice.stopSpeaking();
}

// 질문을 읽고 나서, 또 전사가 비거나 실패할 때마다 다시 듣는다. 한 번만 들으면 늦게 한 답을 놓쳐 120초 뒤 거부된다
function listenAgainForApproval() {
  if (approvalListens <= 0) return;
  if (!approvalId) return void (approvalListens = 0);
  if (voice.isSpeaking()) return;  // 읽는 동안 들으면 질문 자체를 답으로 듣는다
  approvalListens -= 1;
  setTimeout(() => {
    if (approvalId && !voice.isSpeaking()) void voice.start();
  }, LISTEN_AFTER_SPEECH_MS);
}

// 키워드로 판정이 안 되는 답을 서버 분류기에 묻는다. 꺼져 있거나 늦으면 unclear
function classifyApproval(id: string, text: string, command: string, hasAlways: boolean): Promise<string> {
  if (!replyClassifier) return Promise.resolve('unclear');
  classifying.get(id)?.('unclear');
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish('unclear'), REPLY_TIMEOUT_MS);
    function finish(verdict: string) {
      if (classifying.get(id) !== finish) return;
      clearTimeout(timer);
      classifying.delete(id);
      resolve(verdict);
    }
    classifying.set(id, finish);
    socket?.send({ type: 'reply_classify', kind: 'approval', id, text, context: command, has_always: hasAlways });
  });
}

async function answerApprovalByVoice(text: string) {
  const req = approvalReq!;
  const hasAlways = !!req.always_pattern;
  let choice = parseApprovalAnswer(text, hasAlways);
  if (choice === 'unclear') choice = (await classifyApproval(req.id, text, req.command ?? '', hasAlways)) as typeof choice;
  if (approvalId !== req.id) return voice.setIdle();  // 분류하는 사이 버튼이나 다른 창이 먼저 답했다
  if (choice !== 'allow' && choice !== 'always') choice = 'deny';
  answerApproval(choice);
  voice.requestSpeech((currentAgent === JARVIS_VOICE_AGENT ? HEARD_SPEECH_EN : HEARD_SPEECH)[choice], 'approval_answer');
}

function onTranscript(text: string) {
  // 들은 말은 응답 패널이 아니라 입력창 자리에 잠깐 비춘다. 패널에는 JARVIS 의 말만 둔다
  input.placeholder = `“${text}”`;
  // 승인 시트가 열려 있으면 이 말은 승인 답이다. 메시지로 보내지 않는다
  if (approvalId) return void answerApprovalByVoice(text);
  // 듣는 중에 "Jarvis" 만 불렀다. 질문이 아니라 부른 것이니 웨이크워드처럼 대답하고 다시 듣는다
  if (isWakeCall(text)) return void answerWakeCall();
  voiceMode = true;
  if (!sendText(focusCommandFromSpeech(text, focusOn) ?? text)) voice.setIdle();
}

// ── 서버 이벤트 ──────────────────────────────────────────────────────────────

function handle(ev: ServerEvent) {
  if (backlog && ev.type !== 'connected') return void backlog.push(ev);
  switch (ev.type) {
    case 'connected':
      sessionId = ev.session_id;
      localStorage.setItem(SESSION_KEY, sessionId);
      applyAgent(ev.agent?.id ?? ev.agent);
      agentSessions = { ...agentSessions, [currentAgent]: sessionId };
      localStorage.setItem(AGENT_SESSIONS_KEY, JSON.stringify(agentSessions));
      depth = 0;
      setBusy(false);
      slash.setCommands(ev.slash_commands ?? []);
      voice.setPhrases(ev.voice?.phrases);
      voice.serverStt = ev.voice?.stt_mode === 'server';
      replyClassifier = !!ev.reply_classifier;
      setWake(!!ev.voice?.wake && voice.supported);
      void restoreHistory();
      break;

    case 'agent_start':
      if (depth === 0) {
        chat.startAssistant();
        spokenUpTo = 0;
      }
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
      // 도구를 부르기 전까지 한 말은 지금 읽는다. 다 끝난 뒤 몰아 읽으면 화면과 소리가 어긋난다
      speakNewText(deferredReply ? 'answer' : 'reply');
      chat.toolStart(ev.tool_call_id, ev.tool_name ?? 'tool', detail);
      setReactor('tool_running');
      if (CUE_BY_TOOL[ev.tool_name]) cue(CUE_BY_TOOL[ev.tool_name]);
      break;
    }

    case 'tool_execution_end':
      chat.toolEnd(ev.tool_call_id, !ev.is_error);
      setReactor('thinking');
      break;

    case 'agent_end': {
      depth = Math.max(0, depth - 1);
      if (depth > 0) break;
      // /focus 안내 뒤에는 메인 에이전트가 이어 돈다. 읽기는 그 응답에서 한다
      if (ev.continues) {
        chat.endAssistant();
        break;
      }
      const spoke = speakNewText(deferredReply ? 'answer' : 'reply');
      chat.endAssistant();
      setBusy(false);
      if (!spoke && voice.state === 'processing') voice.setIdle();  // 말 없는 응답(도구만)
      voiceMode = false;
      deferredReply = false;
      resetPlaceholder();
      break;
    }

    case 'agent_error':
      chat.endAssistant();
      chat.addError(ev.message ?? '알 수 없는 오류');
      depth = 0;
      setBusy(false);
      setReactor('error');
      if (voice.state === 'processing') voice.setIdle();
      voiceMode = false;
      resetPlaceholder();
      break;

    case 'error':
      voice.setIdle();  // TTS 오류면 읽기 대기를 푼다
      chat.addError(ev.message ?? '오류');
      break;

    case 'focus_state': {
      const was = focusOn;
      focusOn = !!ev.state?.active;
      if (was !== focusOn && focusCommanded) cue(focusOn ? 'focus_mode_enter' : 'focus_mode_quit');
      focusCommanded = false;
      break;
    }

    case 'focus_panel':
      if (ev.area === 'analysis') {
        if (ev.busy && !analysisBusy) cue('analysis');
        analysisBusy = !!ev.busy;
      }
      break;

    case 'voice_tts_audio':
      // JARVIS 는 JARVIS 목소리로만 말한다. 서버가 합성하지 못한 글은 기기 음성으로 읽지 않고 화면에만 둔다
      voice.receive(ev.id, ev.data ?? '', currentAgent === JARVIS_VOICE_AGENT ? '' : ev.text ?? '');
      break;

    case 'voice_wake':
      void onWake(ev.score ?? 0);
      break;

    case 'voice_stt_result':
      if (ev.error) {
        chat.addError(`STT 오류: ${ev.error}`);
        voice.setIdle();
      } else if (ev.text?.trim()) {
        onTranscript(ev.text.trim());
      } else {
        chat.addError('음성을 인식하지 못했습니다');
        voice.setIdle();
      }
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
      const filler = ev.kind === 'filler';
      chat.addProactive(text, filler, feedback);
      if (filler) deferredReply = true;
      // 오래 걸리는 일을 뒤로 넘겼다. 말로 일하는 중이면 대기 문장 대신 녹음한 문구를 읽는다
      const speak = voiceMode || ev.speak;
      // JARVIS 의 대기 안내는 말로 시작하지 않았어도 녹음 문구(JARVIS 목소리)로 읽는다
      const fillerCue = filler && voice.hasPhrase('horizontal_task') && (voiceMode || (speak && currentAgent === JARVIS_VOICE_AGENT));
      if (fillerCue) void voice.cue('horizontal_task');
      else if (speak) voice.requestSpeech(text, filler ? 'filler' : 'proactive');
      break;
    }

    case 'reminder': {
      // 스케줄 알림은 어느 에이전트 것이든 열린 화면 모두에 온다. 다른 에이전트 것이면 이름을 붙인다
      const from = ev.agent && ev.agent !== currentAgent ? agents[ev.agent]?.name ?? ev.agent : '';
      chat.addReminder(ev.label || ev.title || ev.name, ev.error || ev.text || '', !!ev.error, from);
      break;
    }

    case 'approval_request':
      // 말로 시작한 요청이면 시트 대신 아래 띠로 띄우고, 질문을 읽은 뒤 답을 듣는다
      showApproval(ev, voiceMode);
      if (voiceMode) {
        approvalListens = APPROVAL_LISTEN_MAX;
        voice.requestSpeech(approvalSpeech(ev.command ?? '', !!ev.always_pattern), 'approval');
      }
      break;

    case 'reply_classified':
      if (ev.kind === 'approval') classifying.get(ev.id)?.(ev.verdict ?? 'unclear');
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
  stopSpeech();
  voiceMode = false;
  focusOn = false;
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
// byVoice 면 모달이 아니라 아래 띠다. 구체가 가려지지 않아 탭으로 듣기를 끝낼 수 있다
function showApproval(ev: ServerEvent, byVoice: boolean) {
  approvalId = ev.id;
  approvalReq = ev;
  $('approval-reason').textContent = ev.reason ?? '';
  $('approval-command').textContent = ev.command ?? '';
  $('approval-always').hidden = !ev.always_pattern;
  const hint = $('approval-hint');
  hint.hidden = !byVoice;
  hint.textContent = `말로 답하세요: ${ev.always_pattern ? '허용, 항상, 거부' : '허용, 거부'}`;
  approval.classList.toggle('voice', byVoice);
  if (approval.open) approval.close();
  if (byVoice) approval.show();
  else approval.showModal();
}

function closeApproval() {
  approvalId = null;
  approvalReq = null;
  approvalListens = 0;
  // 승인 답으로 듣던 녹음이 끝난 뒤 메시지로 나가지 않게 버린다
  if (voice.state === 'listening') voice.cancel();
  if (approval.open) approval.close();
}

function answerApproval(answer: 'allow' | 'always' | 'deny') {
  if (!approvalId) return;
  // 답했으니 아직 읽던 질문은 쓸모없다. 남겨 두면 곧 올 답 읽기와 겹친다
  stopSpeech();
  socket?.send({ type: 'approval_response', id: approvalId, approved: answer !== 'deny', always: answer === 'always' });
  closeApproval();
}

approval.addEventListener('click', (e) => {
  const answer = (e.target as HTMLElement).dataset.answer;
  if (answer === 'allow' || answer === 'always' || answer === 'deny') answerApproval(answer);
});
// 바깥을 눌러 닫거나 스와이프로 내리면 답 없이 사라진다. 승인은 반드시 버튼으로만 끝낸다
approval.addEventListener('cancel', (e) => e.preventDefault());

// ── 입력 ─────────────────────────────────────────────────────────────────────

// 입력창과 음성 전사가 같은 길로 보낸다
function sendText(text: string) {
  if (!socket?.send({ type: 'user_message', text })) {
    chat.addError('서버에 연결되지 않았습니다');
    return false;
  }
  focusCommanded = /(^|\s)\/focus\b/.test(text);
  // 새 질문을 보내면 지난 응답을 치운다. 패널에는 이번 응답만 남는다
  chat.clear();
  return true;
}

function submit() {
  slash.hide();
  if (document.body.classList.contains('busy')) {
    socket?.send({ type: 'abort' });
    return;
  }
  const text = input.value.trim();
  if (!text || !sendText(text)) return;
  input.value = '';
  fitInput();
}

function fitInput() {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

// main 의 Enter 전송보다 먼저 붙어야 팝업이 열린 동안 Enter 가 고르기가 된다
const slash = attachSlash(input, $('slash-popup'));
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

// ── 구체 스와이프: 에이전트 전환 ─────────────────────────────────────────────

let switching = false;

function renderAgentDots() {
  const box = $('agent-dots');
  box.replaceChildren(...Object.keys(agents).map((id) => {
    const dot = document.createElement('i');
    dot.dataset.id = id;
    dot.classList.toggle('on', id === currentAgent);
    return dot;
  }));
  // 에이전트가 하나면 넘길 곳이 없으니 점도 숨긴다
  box.hidden = Object.keys(agents).length < 2;
}

// 기억한 세션이 아직 서버에 있으면 그대로, 없으면 같은 에이전트의 세션, 그것도 없으면 새로 만든다
async function sessionFor(agentId: string): Promise<string> {
  const { sessions, agents: owners } = await api<{ sessions: string[]; agents: Record<string, string> }>('/api/sessions');
  const remembered = agentSessions[agentId];
  if (remembered && owners[remembered] === agentId) return remembered;
  const existing = sessions.filter((id) => owners[id] === agentId).at(-1);
  if (existing) return existing;
  const { session_id } = await api<{ session_id: string }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ agent: agentId }),
  });
  return session_id;
}

async function switchAgent(dir: 1 | -1) {
  const order = Object.keys(agents);
  if (switching || order.length < 2) return;
  const target = order[(order.indexOf(currentAgent) + dir + order.length) % order.length];
  // 새 세션 생성은 멱등하지 않다. 응답 전 다시 밀어도 두 번 만들지 않게 막는다
  switching = true;
  applyAgent(target);  // 색과 이름은 바로 바꾸고, 세션은 connected 가 확정한다
  try {
    openSession(await sessionFor(target));
  } catch (e) {
    chat.addError(`전환 실패: ${(e as Error).message}`);
  } finally {
    switching = false;
  }
}

onSwipe(sphere, {
  onMove: (dx) => {
    sphere.classList.add('dragging');
    sphere.style.setProperty('--drag', `${dx}px`);
    sphere.style.setProperty('--fade', String(Math.min(0.6, Math.abs(dx) / 400)));
  },
  onEnd: (dir) => {
    sphere.classList.remove('dragging');
    sphere.style.setProperty('--drag', '0px');
    sphere.style.setProperty('--fade', '0');
    if (dir) void switchAgent(dir);
  },
  // 탭은 말하기. 읽는 중이면 멈춘다
  onTap: () => {
    voice.unlock();
    if (voice.isSpeaking()) return stopSpeech();
    if (!voice.supported) return chat.addError('이 환경에서는 음성 입력을 쓸 수 없습니다');
    voice.toggle();
  },
});

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
    renderAgentDots();
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
