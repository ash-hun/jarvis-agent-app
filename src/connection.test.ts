import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeServer, wsUrl } from './connection.ts';

test('normalizeServer converges pasted variants to one address', () => {
  const want = 'https://mini.tail1234.ts.net';
  for (const s of ['mini.tail1234.ts.net', ' https://mini.tail1234.ts.net/ ', 'https://mini.tail1234.ts.net//']) {
    assert.equal(normalizeServer(s), want);
  }
  assert.equal(normalizeServer('http://localhost:7777'), 'http://localhost:7777');
  assert.equal(normalizeServer('  '), '');
});

test('wsUrl picks scheme from server, falls back to page origin, encodes token', () => {
  assert.equal(
    wsUrl({ server: 'https://mini.ts.net', token: 'a&b' }, 'default', 'http://x'),
    'wss://mini.ts.net/ws?session_id=default&token=a%26b',
  );
  assert.equal(wsUrl({ server: '', token: '' }, 's1', 'http://localhost:5173'), 'ws://localhost:5173/ws?session_id=s1');
});
