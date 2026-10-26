import test from 'node:test';
import assert from 'node:assert/strict';

import { focusCommandFromSpeech } from './focus-speech.ts';

test('focusCommandFromSpeech starts, stops, and ignores plain talk', () => {
  assert.equal(focusCommandFromSpeech('포커스 모드 보고서 정리', false), '/focus 보고서 정리');
  assert.equal(focusCommandFromSpeech('포커스 모드 종료', true), '/focus stop');
  assert.equal(focusCommandFromSpeech('종료해 줘', true), '/focus stop');
  assert.equal(focusCommandFromSpeech('종료해 줘', false), null);  // Focus 가 아니면 그냥 말이다
  assert.equal(focusCommandFromSpeech('오늘 날씨 어때', false), null);
});
