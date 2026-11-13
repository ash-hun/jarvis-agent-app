// Ion(플랫폼 감시) 사고 하나를 띠 한 줄로 어떻게 보일지 정한다. 순수 함수라 DOM 없이 검사한다.

export type Severity = 'critical' | 'warning';

export type Incident = {
  id: string;
  kind: string;
  target: string;
  detail?: string;
  title?: string;
  severity?: Severity;
  actions?: string[];
  response?: string | null;
  action_result?: string;
  closed_ms?: number | null;
};

export type Line = { title: string; detail: string; result: string; actions: string[] };

export const LABELS: Record<string, string> = { restart: '재기동', stop: '멈춤', pause: '작업 멈춤', ignore: '무시' };
const RANK: Record<string, number> = { critical: 2, warning: 1 };

export function label(action: string): string {
  return LABELS[action] ?? action;
}

// 답한 사고는 결과만, 닫힌 사고는 "해결됨", 열린 사고는 버튼
export function describe(incident: Incident): Line {
  const base = { title: incident.title || incident.kind, detail: incident.detail ?? '' };
  if (incident.response) {
    return { ...base, result: `${label(incident.response)}, ${incident.action_result ?? ''}`.replace(/, $/, ''), actions: [] };
  }
  if (incident.closed_ms) return { ...base, result: '해결됨', actions: [] };
  return { ...base, result: '', actions: incident.actions?.length ? incident.actions : ['ignore'] };
}

// 아직 답하지 않은 사고 중 가장 심한 등급. 없으면 빈 글
export function worst(incidents: Iterable<Incident>): Severity | '' {
  let top: Severity | '' = '';
  for (const i of incidents) {
    if (!i.response && (RANK[i.severity ?? ''] ?? 0) > (RANK[top] ?? 0)) top = i.severity ?? '';
  }
  return top;
}

// 서버가 보낸 SSE incident 이벤트(푸시와 같은 꼴)를 목록의 사고 꼴로
export function fromNotification(p: Record<string, unknown>): Incident {
  return {
    id: String(p.id ?? ''),
    kind: String(p.kind ?? ''),
    target: String(p.target ?? ''),
    detail: typeof p.body === 'string' ? p.body : '',
    title: typeof p.title === 'string' ? p.title : undefined,
    severity: p.severity === 'critical' || p.severity === 'warning' ? p.severity : undefined,
    actions: Array.isArray(p.actions) ? p.actions.map(String) : undefined,
  };
}
