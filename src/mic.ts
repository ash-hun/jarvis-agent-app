// 앱의 AudioContext 하나와 마이크 하나. 웨이크워드, 말하기, 소리 재생이 같이 쓰고 16kHz int16 80ms 묶음과 음량을 흘린다.

// iOS 는 같은 마이크를 두 번 잡으면 앞의 것을 조용히 끊는다. 그래서 스트림은 여기 하나만 둔다.
// 재생도 같은 컨텍스트를 쓴다. 마이크가 켜져 있는 동안 iOS 가 따로 둔 재생 컨텍스트를 멈춰 두면
// 탭 없이 온 읽기(웨이크워드 뒤 대답)를 깨울 수 없다
const WORKLET_URL = 'mic-worklet.js';

type FrameListener = (pcm: ArrayBuffer, rms: number) => void;

// iOS 17 Safari 의 navigator.audioSession. 마이크를 잡고 있는 동안만 녹음 겸 재생으로 둔다
type AudioSessionNav = Navigator & { audioSession?: { type: string } };
function setAudioSession(type: 'play-and-record' | 'auto') {
  const session = (navigator as AudioSessionNav).audioSession;
  if (session) session.type = type;
}

export class Mic {
  private ctx: AudioContext | null = null;
  private worklet: Promise<void> | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private opening: Promise<void> | null = null;
  private listeners = new Set<FrameListener>();

  onFrame(fn: FrameListener) { this.listeners.add(fn); }

  get live() {
    return this.stream?.getAudioTracks()[0]?.readyState === 'live';
  }

  // 처음 부를 때 만들고 앱이 끝날 때까지 닫지 않는다. 한 번 탭으로 풀린 컨텍스트는 탭 없이도 다시 깨울 수 있다
  context(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      // iOS 는 전화, 다른 앱 소리, 마이크 전환에 컨텍스트를 interrupted, suspended 로 돌린다. 곧바로 다시 깨운다
      ctx.onstatechange = () => {
        if ((ctx.state as string) !== 'running' && ctx.state !== 'closed') this.resume();
      };
      this.ctx = ctx;
    }
    return this.ctx;
  }

  // 제스처 안에서 부르면 잠금이 풀린다. 제스처 밖에서는 실패할 수 있고, 실패해도 그대로 둔다
  resume() {
    const ctx = this.context();
    if ((ctx.state as string) !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {});
  }

  // 열려 있으면 그대로, 앱을 내렸다 와서 끊겼으면 다시 연다. 여러 번 불러도 스트림은 하나다
  ensure(): Promise<void> {
    this.resume();
    if (this.live) return Promise.resolve();
    this.opening ??= this.openFresh().finally(() => { this.opening = null; });
    return this.opening;
  }

  // 마이크만 놓는다. 컨텍스트는 재생이 계속 쓴다
  close() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source?.disconnect();
    this.source = null;
    this.node?.disconnect();
    this.node = null;
    setAudioSession('auto');
  }

  private async openFresh() {
    this.close();
    setAudioSession('play-and-record');
    const ctx = this.context();
    try {
      // 실패한 등록은 담아 두지 않는다. 다음에 다시 시도한다
      this.worklet ??= ctx.audioWorklet.addModule(WORKLET_URL).catch((e) => { this.worklet = null; throw e; });
      await this.worklet;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const node = new AudioWorkletNode(ctx, 'mic-capture');
      node.port.onmessage = (e) => this.listeners.forEach((fn) => fn(e.data.pcm, e.data.rms));
      const source = ctx.createMediaStreamSource(stream);
      source.connect(node);
      // Safari 는 출력이 어디에도 이어지지 않은 노드를 돌리지 않을 수 있다. 노드는 무음을 낸다
      node.connect(ctx.destination);
      this.stream = stream;
      this.source = source;
      this.node = node;
      this.resume();
    } catch (e) {
      setAudioSession('auto');
      throw e;
    }
  }
}
