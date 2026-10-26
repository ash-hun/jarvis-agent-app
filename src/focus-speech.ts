// 전사 한 줄을 /focus 명령으로 바꾼다. 정규식은 HUD app/focus.js 의 복사본이다. 원본이 바뀌면 맞춘다.

// 인식은 "포커스" 를 "버스", "포커" 처럼 자주 틀리고 첫 마디를 흘린다. 비슷한 소리도 "모드" 가 붙으면 받고, 키워드가 문장 끝이어도 받는다
const KEY_EXACT = '포커스|포커즈|퍼커스|focus';
const KEY_FUZZY = '버스|보커스|포카스|포커|퍼커|포스';
const MODE = '(?:모드|mode)';
const KEY_STOP = `(?:(?:${KEY_EXACT})\\s*${MODE}?|(?:${KEY_FUZZY})\\s*${MODE})`;
const KEY_START = `(?:${KEY_EXACT}|${KEY_FUZZY})\\s*${MODE}`;
const SPEECH_STOP = new RegExp(`^\\s*${KEY_STOP}\\s*(?:를|은|는)?\\s*(?:종료|끝내|끝|꺼|그만|off|stop)`, 'i');
const SPEECH_START = new RegExp(`^\\s*${KEY_START}\\s*(?:로|으로)?\\s*(?:시작해\\s*줘|시작|켜\\s*줘|켜|해\\s*줘|on)?\\s*[,.:!]?\\s*(.*)$`, 'i');
const SPEECH_START_TAIL = new RegExp(
  `^(.+?)[\\s,.]*${KEY_START}\\s*(?:로|으로)?\\s*(?:시작해\\s*줘|시작|진행해\\s*줘|진행|해\\s*줘|켜|on)?[\\s.!]*$`, 'i');
// Focus 중에는 키워드가 잘려도 끝내는 말만으로 끝낸다. "동요" 는 "종료" 를 잘못 들은 실측 전사다
const SPEECH_STOP_BARE = new RegExp(
  `^\\s*(?:${KEY_STOP}\\s*)?(?:모드\\s*)?(?:를|은|는)?\\s*(?:종료|동요|끝내|끝|그만|꺼|off|stop)` +
  `\\s*(?:해\\s*줘|해|할게|하자|합니다|해요)?[\\s.!]*$`, 'i');

// 키워드가 없으면 null. 평소 대화로 보낸다
export function focusCommandFromSpeech(text: string, focusOn: boolean): string | null {
  if (SPEECH_STOP.test(text) || (focusOn && SPEECH_STOP_BARE.test(text))) return '/focus stop';
  const m = text.match(SPEECH_START) || text.match(SPEECH_START_TAIL);
  if (!m) return null;
  const task = m[1].trim().replace(/[\s,.]+$/, '');
  return task ? `/focus ${task}` : '/focus';
}
