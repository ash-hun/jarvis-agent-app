import test from 'node:test';
import assert from 'node:assert/strict';

import { splitSpeech } from './speech-split.ts';

test('splitSpeech cuts at sentence ends and line breaks', () => {
  assert.deepEqual(
    splitSpeech('지금은 오후 세 시 십오 분입니다. 오늘 남은 일정은 네 시 회의 하나입니다!\n자료는 아침 문서에 있습니다.'),
    ['지금은 오후 세 시 십오 분입니다.', '오늘 남은 일정은 네 시 회의 하나입니다!', '자료는 아침 문서에 있습니다.'],
  );
});

test('splitSpeech keeps decimals and folds short pieces into a neighbour', () => {
  assert.deepEqual(splitSpeech('네. 버전 3.5 로 올렸고 테스트도 모두 통과했습니다. 끝.'), [
    '네. 버전 3.5 로 올렸고 테스트도 모두 통과했습니다. 끝.',
  ]);
  assert.deepEqual(splitSpeech('짧은 답'), ['짧은 답']);
  assert.deepEqual(splitSpeech(''), ['']);
});
