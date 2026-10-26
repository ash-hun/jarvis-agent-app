// 승인 요청에 말로 한 답을 allow / always / deny / unclear 로 나눈다. 키워드는 HUD app/approval.js 의 복사본이다. 원본이 바뀌면 맞춘다.

export type ApprovalChoice = 'allow' | 'always' | 'deny' | 'unclear';

// 거부 쪽으로 기운다. 부정어가 섞이면 거부, 긍정 표현이 분명할 때만 허용
const VOICE_DENY = ['거부', '거절', '아니', '안돼', '안되', '안해', '하지마', '하지말', '취소', '멈춰', '그만', 'no', 'deny', 'stop'];
const VOICE_ALWAYS = ['항상', '언제나', '앞으로도', 'always'];
const VOICE_ALLOW = ['허용', '허락', '승인', '실행해', '진행해', 'allow'];
const VOICE_YES = ['응', '네', '예', '그래', '좋아', '오케이', '해', '해줘', 'ok', 'okay', 'yes'];

export function parseApprovalAnswer(text: string, hasAlways: boolean): ApprovalChoice {
  const t = text.toLowerCase().replace(/[\s.,!?…~]/g, '');
  if (VOICE_DENY.some((w) => t.includes(w))) return 'deny';
  if (hasAlways && VOICE_ALWAYS.some((w) => t.includes(w))) return 'always';
  if (VOICE_ALLOW.some((w) => t.includes(w)) || VOICE_YES.includes(t)) return 'allow';
  return 'unclear';
}
