import test from 'node:test';
import assert from 'node:assert/strict';

import { applySlash, slashContext } from './slash.ts';

test('slashContext: only a slash at the start or after a space', () => {
  assert.deepEqual(slashContext('/sch', 4), { query: 'sch', start: 0, end: 4 });
  assert.deepEqual(slashContext('hi /Fo', 6), { query: 'fo', start: 3, end: 6 });
  assert.equal(slashContext('a/b', 3), null);
  assert.equal(slashContext('/help me', 8), null);  // 공백 뒤로 넘어가면 명령 입력이 끝났다
});

test('applySlash replaces only the fragment before the cursor', () => {
  const ctx = slashContext('/fo tail', 3)!;
  assert.deepEqual(applySlash('/fo tail', ctx, 'focus'), { value: '/focus  tail', cursor: 7 });
});
