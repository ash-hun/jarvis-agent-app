// 응답 패널을 그린다. 대화 기록이 아니라 JARVIS 의 지금 응답만 보인다. 서버 이벤트의 해석은 main.ts 가 한다.
import { attachCopyBtns, escapeHtml, renderMarkdown } from './markdown.js';

// 바닥에서 이만큼 안쪽이면 새 글이 올 때 따라 내려간다. 위를 읽는 중이면 끌어내리지 않는다
const STICK_PX = 80;

const log = document.getElementById('log')!;
let current: { el: HTMLElement; body: HTMLElement; text: string; frame: number } | null = null;

function atBottom() {
  return log.scrollHeight - log.scrollTop - log.clientHeight < STICK_PX;
}

function append(el: HTMLElement) {
  const stick = atBottom();
  log.append(el);
  if (stick) log.scrollTop = log.scrollHeight;
}

function node(cls: string, html = '') {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return el;
}

export function clear() {
  log.replaceChildren();
  current = null;
}

function addAssistantDone(text: string) {
  const el = node('msg assistant', `<div class="md">${renderMarkdown(text)}</div>`);
  attachCopyBtns(el);
  append(el);
}

// 다시 붙었을 때 패널을 마지막 응답으로 맞춘다. 사용자 말은 보이지 않는다
export function renderHistory(messages: { role: string; text: string }[]) {
  clear();
  const last = messages.findLast((m) => m.role === 'assistant');
  if (last) addAssistantDone(last.text);
  log.scrollTop = 0;
}

export function startAssistant() {
  const el = node('msg assistant pending', '<div class="tools"></div><div class="md"></div>');
  current = { el, body: el.querySelector('.md')!, text: '', frame: 0 };
  append(el);
}

export function appendDelta(delta: string) {
  if (!current) startAssistant();
  const c = current!;
  c.text += delta;
  c.el.classList.remove('pending');
  // 조각마다 전체를 다시 그리면 긴 답에서 버벅인다. 프레임당 한 번만
  if (!c.frame) c.frame = requestAnimationFrame(() => {
    c.frame = 0;
    const stick = atBottom();
    c.body.innerHTML = renderMarkdown(c.text);
    if (stick) log.scrollTop = log.scrollHeight;
  });
}

export function endAssistant() {
  if (!current) return;
  const c = current;
  cancelAnimationFrame(c.frame);
  c.body.innerHTML = renderMarkdown(c.text);
  attachCopyBtns(c.body);
  // 도구만 쓰고 말이 없는 턴은 빈 말풍선을 남기지 않는다
  c.el.classList.remove('pending');
  if (!c.text.trim() && !c.el.querySelector('.tool')) c.el.remove();
  current = null;
}

export function toolStart(id: string, name: string, detail: string) {
  if (!current) startAssistant();
  const el = node('tool running', `<b>${escapeHtml(name)}</b> ${escapeHtml(detail)}`);
  el.dataset.id = id;
  current!.el.querySelector('.tools')!.append(el);
}

export function toolEnd(id: string, ok: boolean) {
  const el = log.querySelector<HTMLElement>(`.tool[data-id="${CSS.escape(id)}"]`);
  if (el) el.className = `tool ${ok ? 'ok' : 'err'}`;
}

export function addThought(interpretation: string, decision: string, confidence: number) {
  const el = document.createElement('details');
  el.className = 'thought';
  el.innerHTML = `<summary>💭 ${escapeHtml(decision)} · ${confidence}%</summary><p>${escapeHtml(interpretation)}</p>`;
  append(el);
}

export function addProactive(text: string, filler: boolean, onFeedback?: (accepted: boolean) => void) {
  const el = node('msg proactive', `<span class="badge">${filler ? '💬' : '🔔'}</span><div class="md">${renderMarkdown(text)}</div>`);
  if (onFeedback) {
    const row = node('feedback', '<span>도움이 됐나요?</span><button data-v="1">네</button><button data-v="0">아니오</button>');
    row.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).dataset.v;
      if (v === undefined) return;
      onFeedback(v === '1');
      row.textContent = v === '1' ? '고마워요' : '알겠어요';
    });
    el.append(row);
  }
  append(el);
}

export function addReminder(title: string, text: string, failed: boolean) {
  append(node(`msg reminder${failed ? ' err' : ''}`, `<b>⏰ ${escapeHtml(title)}</b><div class="md">${renderMarkdown(text)}</div>`));
}

export function addError(message: string) {
  append(node('msg system err', escapeHtml(message)));
}
