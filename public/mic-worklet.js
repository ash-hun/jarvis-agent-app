// 마이크 캡처 AudioWorklet: 기기 샘플레이트 입력을 16kHz 로 줄여 int16 1280 샘플(80ms) 묶음과 그 음량(RMS)을 넘긴다.
// HUD wake-worklet.js 는 16kHz AudioContext 에 기대지만, iOS 는 마이크와 다른 샘플레이트의 컨텍스트를 믿기 어려워 여기서 줄인다.
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1280;

class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE;  // 출력 한 샘플에 해당하는 입력 샘플 수
    this.t = 0;
    this.acc = 0;
    this.cnt = 0;
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
    this.energy = 0;
  }

  // 구간 평균으로 줄인다. 거친 저역 통과라 고음이 접혀 들어오는 걸 줄인다
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.cnt += 1;
      this.t += 1;
      if (this.t >= this.step) {
        this.t -= this.step;
        this.emit(this.acc / this.cnt);
        this.acc = 0;
        this.cnt = 0;
      }
    }
    return true;
  }

  emit(x) {
    const s = Math.max(-1, Math.min(1, x));
    this.energy += s * s;
    this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    if (this.filled < FRAME_SAMPLES) return;
    const pcm = this.frame.buffer;
    this.port.postMessage({ pcm, rms: Math.sqrt(this.energy / FRAME_SAMPLES) }, [pcm]);
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
    this.energy = 0;
  }
}

registerProcessor('mic-capture', MicCapture);
