import test from 'node:test';
import assert from 'node:assert/strict';

import { Endpoint, bytesToBase64, pcmToWav } from './endpoint.ts';

const QUIET = 0.003, SPEECH = 0.08;

function run(levels: number[]) {
  const ep = new Endpoint();
  for (let i = 0; i < levels.length; i++) {
    const v = ep.push(levels[i]);
    if (v !== 'listen') return { v, at: i };
  }
  return { v: 'listen', at: levels.length };
}
const frames = (level: number, ms: number) => Array<number>(ms / 80).fill(level);

test('Endpoint ends after speech followed by 1.2s of quiet', () => {
  const r = run([...frames(QUIET, 400), ...frames(SPEECH, 1600), ...frames(QUIET, 2000)]);
  assert.equal(r.v, 'end');
  assert.equal(r.at, 5 + 20 + 15 - 1);
});

test('Endpoint keeps listening through a short pause', () => {
  const r = run([...frames(QUIET, 400), ...frames(SPEECH, 800), ...frames(QUIET, 800), ...frames(SPEECH, 800)]);
  assert.equal(r.v, 'listen');
});

test('Endpoint gives up when nobody speaks, and ignores a single blip', () => {
  const r = run([...frames(QUIET, 2000), SPEECH, ...frames(QUIET, 6000)]);
  assert.equal(r.v, 'timeout');
});

test('pcmToWav writes a 16kHz mono PCM header and the samples', () => {
  const wav = pcmToWav([new Int16Array([1, -1]).buffer], 16000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(40, true), 4);
  assert.equal(v.getInt16(46, true), -1);
  assert.equal(bytesToBase64(new Uint8Array([104, 105])), 'aGk=');
});
