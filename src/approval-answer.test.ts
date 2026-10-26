import test from 'node:test';
import assert from 'node:assert/strict';

import { parseApprovalAnswer } from './approval-answer.ts';

test('parseApprovalAnswer leans toward deny', () => {
  assert.equal(parseApprovalAnswer('허용해 줘.', false), 'allow');
  assert.equal(parseApprovalAnswer('네', false), 'allow');
  assert.equal(parseApprovalAnswer('아니 허용하지 마', false), 'deny');
  assert.equal(parseApprovalAnswer('항상 허용', true), 'always');
  assert.equal(parseApprovalAnswer('항상 허용', false), 'allow');  // 패턴이 없으면 항상은 고를 수 없다
  assert.equal(parseApprovalAnswer('음 글쎄', false), 'unclear');
});
