// 듣는 중에 들은 말이 웨이크워드("Jarvis", "헤이 자비스") 하나뿐인지 본다. 그러면 질문이 아니라 부른 것이다.

// 서버 웨이크워드 모델은 "Hey Jarvis" 하나다. Apple 인식기는 영어로도 한국어로도, 서버 whisper(ko)는 "javas" 로도 받아 적는다
const WAKE_CALL = /^(hey|헤이)?(jarvis|javis|javas|자비스|쟈비스|재비스)(야|아)?$/;

export function isWakeCall(text: string) {
  return WAKE_CALL.test(text.toLowerCase().replace(/[\s.,!?~'"“”]/g, ''));
}
