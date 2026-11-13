import test from 'node:test';
import assert from 'node:assert/strict';

import { describe, fromNotification, worst, type Incident } from './ion-card.ts';

const open: Incident = { id: 'backend_down:backend:1', kind: 'backend_down', target: 'backend', detail: '45초 무응답',
                         title: 'Ion: 백엔드가 응답하지 않아요', severity: 'critical', actions: ['restart', 'ignore'] };

test('describe shows buttons for an open incident, the result after a response, and 해결됨 when closed', () => {
  assert.deepEqual(describe(open), { title: 'Ion: 백엔드가 응답하지 않아요', detail: '45초 무응답', result: '', actions: ['restart', 'ignore'] });
  assert.equal(describe({ ...open, response: 'restart', action_result: '재기동함' }).result, '재기동, 재기동함');
  assert.deepEqual(describe({ ...open, response: 'ignore', action_result: '' }).actions, []);
  assert.equal(describe({ ...open, closed_ms: 5 }).result, '해결됨');
  assert.deepEqual(describe({ id: 'x', kind: 'odd', target: 't' }).actions, ['ignore']);
});

test('worst ranks critical over warning and ignores answered incidents', () => {
  const warn: Incident = { ...open, id: 'w', severity: 'warning' };
  assert.equal(worst([warn, open]), 'critical');
  assert.equal(worst([warn, { ...open, response: 'ignore' }]), 'warning');
  assert.equal(worst([]), '');
});

test('fromNotification maps the push payload shape and drops unknown severities', () => {
  const got = fromNotification({ id: 'a:b:1', kind: 'a', target: 'b', body: '본문', severity: 'odd', actions: ['pause'] });
  assert.deepEqual(got, { id: 'a:b:1', kind: 'a', target: 'b', detail: '본문', title: undefined, severity: undefined, actions: ['pause'] });
});
