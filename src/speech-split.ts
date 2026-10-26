// 읽을 글을 문장 단위로 나눈다. 서버가 앞 문장을 먼저 합성해 보내면 긴 답도 첫 소리가 빨리 나온다.

// 이보다 짧은 조각은 앞 조각에 붙인다. 너무 잘게 나누면 요청과 문장 사이 틈만 늘어난다
const MIN_PIECE = 15;
// 문장 끝(. ! ? … 다음 공백)이나 줄바꿈에서 자른다. 소수점(3.5)이나 URL 은 뒤에 공백이 없어 자르지 않는다
const SENTENCE_END = /(?<=[.!?…。])\s+|\n+/;

export function splitSpeech(text: string): string[] {
  const pieces: string[] = [];
  for (const raw of text.split(SENTENCE_END)) {
    const piece = raw.trim();
    if (!piece) continue;
    const last = pieces.length - 1;
    if (last >= 0 && (piece.length < MIN_PIECE || pieces[last].length < MIN_PIECE)) pieces[last] += ` ${piece}`;
    else pieces.push(piece);
  }
  return pieces.length ? pieces : [text];
}
