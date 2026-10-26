import test from 'node:test';
import assert from 'node:assert/strict';

import { isWakeCall } from './wake-call.ts';

test('isWakeCall matches the bare wake word in either script', () => {
  for (const t of ['Jarvis', 'Hey, Jarvis!', '자비스', '헤이 자비스', '자비스야?']) assert.equal(isWakeCall(t), true, t);
});

test('isWakeCall leaves real requests alone', () => {
  for (const t of ['자비스 지금 몇 시야', 'Jarvis, what time is it', '', '고맙습니다.']) assert.equal(isWakeCall(t), false, t);
});
