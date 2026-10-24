import test from 'node:test';
import assert from 'node:assert/strict';

import { keyBytes } from './push.ts';

test('keyBytes decodes unpadded base64url VAPID keys', () => {
  // 65바이트 P-256 공개키 모양(0x04 로 시작). base64url, 패딩 없음, - 와 _ 포함
  const raw = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * 37) % 256));
  const b64url = Buffer.from(raw).toString('base64url');
  assert.ok(!b64url.includes('='));
  assert.deepEqual(keyBytes(b64url), raw);
});
