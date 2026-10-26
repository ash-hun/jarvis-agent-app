// 입력창 슬래시 명령 자동완성. 서버가 connected 로 준 목록을 커서 앞의 /조각으로 거른다. 규칙은 HUD app/composer.js 와 같다.
import { escapeHtml } from './markdown.js';

export type SlashCommand = { name: string; description?: string };
type Context = { query: string; start: number; end: number };

// 커서 앞의 /조각. 문장 맨 앞이나 공백 뒤의 / 만 명령으로 본다
export function slashContext(value: string, cursor: number): Context | null {
  const m = value.slice(0, cursor).match(/(?:^|\s)(\/([a-zA-Z0-9_?-]*))$/);
  if (!m) return null;
  return { query: m[2].toLowerCase(), start: cursor - m[1].length, end: cursor };
}

// 조각만 '/이름 ' 으로 바꾸고 뒤의 글은 둔다
export function applySlash(value: string, ctx: Context, name: string) {
  const inserted = `/${name} `;
  return { value: value.slice(0, ctx.start) + inserted + value.slice(ctx.end), cursor: ctx.start + inserted.length };
}

export function attachSlash(input: HTMLTextAreaElement, popup: HTMLElement) {
  let commands: SlashCommand[] = [];
  let shown: SlashCommand[] = [];
  let active = -1;

  const isOpen = () => shown.length > 0;

  function hide() {
    shown = [];
    active = -1;
    popup.hidden = true;
  }

  function setActive(i: number) {
    active = i;
    popup.querySelectorAll('.slash-item').forEach((el, j) => el.classList.toggle('active', j === i));
  }

  function pick(i: number) {
    const ctx = slashContext(input.value, input.selectionStart ?? input.value.length);
    const cmd = shown[i];
    hide();
    if (!ctx || !cmd) return;
    const next = applySlash(input.value, ctx, cmd.name);
    input.value = next.value;
    input.setSelectionRange(next.cursor, next.cursor);
    input.dispatchEvent(new Event('input'));
  }

  function refresh() {
    const ctx = slashContext(input.value, input.selectionStart ?? input.value.length);
    const matched = ctx ? commands.filter((c) => c.name.startsWith(ctx.query)) : [];
    if (!matched.length) return hide();
    shown = matched;
    popup.innerHTML = matched
      .map((c, i) => `<button type="button" class="slash-item" data-i="${i}"><b>/${escapeHtml(c.name)}</b><span>${escapeHtml(c.description ?? '')}</span></button>`)
      .join('');
    popup.hidden = false;
    setActive(0);
  }

  // mousedown 을 막아야 입력창 포커스가 남아 키보드가 내려가지 않는다
  popup.addEventListener('mousedown', (e) => e.preventDefault());
  popup.addEventListener('click', (e) => {
    const i = (e.target as HTMLElement).closest<HTMLElement>('.slash-item')?.dataset.i;
    if (i !== undefined) pick(Number(i));
  });
  input.addEventListener('input', refresh);
  input.addEventListener('click', refresh);
  input.addEventListener('blur', () => setTimeout(hide, 150));
  // main.ts 의 Enter 전송보다 먼저 붙인다. 열려 있으면 Enter 는 고르기다
  input.addEventListener('keydown', (e) => {
    if (!isOpen() || e.isComposing) return;
    const n = shown.length;
    if (e.key === 'ArrowDown') setActive((active + 1) % n);
    else if (e.key === 'ArrowUp') setActive((active - 1 + n) % n);
    else if (e.key === 'Tab' || e.key === 'Enter') pick(active);
    else if (e.key === 'Escape') hide();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });

  return {
    isOpen,
    hide,
    setCommands(list: SlashCommand[]) { commands = list; },
  };
}
