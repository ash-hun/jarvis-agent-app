import test from 'node:test';
import assert from 'node:assert/strict';

import { isTap, swipeDirection } from './swipe.ts';

test('swipeDirection: left is next, right is previous', () => {
  assert.equal(swipeDirection(-120, 10), 1);
  assert.equal(swipeDirection(120, -10), -1);
});

test('swipeDirection ignores short, vertical, and diagonal moves', () => {
  assert.equal(swipeDirection(-40, 0), 0);   // 짧다
  assert.equal(swipeDirection(5, 200), 0);   // 세로
  assert.equal(swipeDirection(-80, 70), 0);  // 대각선: 가로가 세로의 1.5배 미만
});

test('isTap allows a small slip but not a drag', () => {
  assert.equal(isTap(3, -4), true);
  assert.equal(isTap(12, 0), false);
});
