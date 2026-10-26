// 듣는 동안 80ms 묶음의 음량을 보고 말이 끝났는지 정한다. 탭 없이 말이 끝나면 보낸다.

// 실제 마이크와 방마다 값이 다르다. 너무 일찍 끊기면 END_SILENCE_MS 를, 말을 못 잡으면 MIN_LEVEL 을 낮춘다
const FRAME_MS = 80;
const MIN_LEVEL = 0.008;      // 이보다 작으면 말이 아니다(0~1 RMS). 웨이크워드로 부를 땐 기기에서 멀어 작게 들어온다
const NOISE_RATIO = 3;        // 지금까지 가장 조용했던 음량의 이 배수를 넘어야 말이다
const SPEECH_FRAMES = 2;      // 이만큼 이어서 커야 말을 시작한 것으로 본다(잡음 한 번에 속지 않게)
const END_SILENCE_MS = 1200;  // 말한 뒤 이만큼 조용하면 끝
const NO_SPEECH_MS = 7000;    // 이때까지 말이 없으면 보내지 않고 접는다
const MAX_MS = 30000;

export type Verdict = 'listen' | 'end' | 'timeout';

export class Endpoint {
  private elapsed = 0;
  private floor = Infinity;
  private loud = 0;
  private quiet = 0;
  spoke = false;
  peak = 0;  // 말을 못 잡았을 때 기준을 맞추라고 보여 준다

  push(rms: number): Verdict {
    this.elapsed += FRAME_MS;
    this.peak = Math.max(this.peak, rms);
    this.floor = Math.min(this.floor, rms);
    if (rms >= Math.max(MIN_LEVEL, this.floor * NOISE_RATIO)) {
      this.loud += 1;
      this.quiet = 0;
      if (this.loud >= SPEECH_FRAMES) this.spoke = true;
    } else {
      this.loud = 0;
      this.quiet += FRAME_MS;
    }
    if (this.elapsed >= MAX_MS) return this.spoke ? 'end' : 'timeout';
    if (this.spoke && this.quiet >= END_SILENCE_MS) return 'end';
    if (!this.spoke && this.elapsed >= NO_SPEECH_MS) return 'timeout';
    return 'listen';
  }
}

// 16kHz mono int16 묶음을 WAV 하나로. 서버 STT 가 그대로 디코딩한다
export function pcmToWav(frames: ArrayBuffer[], rate: number): Uint8Array<ArrayBuffer> {
  const dataLen = frames.reduce((n, f) => n + f.byteLength, 0);
  const out = new Uint8Array(44 + dataLen);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);         // PCM
  v.setUint16(22, 1, true);         // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);  // byte rate
  v.setUint16(32, 2, true);         // block align
  v.setUint16(34, 16, true);        // bits
  ascii(36, 'data');
  v.setUint32(40, dataLen, true);
  let at = 44;
  for (const f of frames) {
    out.set(new Uint8Array(f), at);
    at += f.byteLength;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array) {
  let s = '';
  // 한 번에 넘기면 큰 녹음에서 인자 개수 한도를 넘는다
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
