// 음성 입출력. 들은 말을 서버 STT 로 보내고, 서버가 합성한 WAV 와 미리 녹음한 문구를 읽는다. HUD 의 voice.js, voice-ui.js, phrases.js 를 옮겼다.

import type { Mic } from './mic.ts';
import { splitSpeech } from './speech-split.ts';
import { Endpoint, bytesToBase64, pcmToWav } from './endpoint.ts';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

type Deps = {
  mic: Mic;
  keepMic: () => boolean;  // 웨이크워드가 켜져 있으면 다 들은 뒤에도 마이크를 놓지 않는다
  send: (msg: object) => boolean;
  fetchPhrase: (name: string) => Promise<ArrayBuffer | null>;
  onState: (state: VoiceState) => void;
  onError: (message: string) => void;
  // 네이티브 앱에서만 있다. Apple 인식기가 서버 whisper 보다 한국어를 잘 받아 적는다. 오류면 서버로 보낸다.
  // 빈 글은 말이 없었다는 뜻이라 서버로 보내지 않는다. whisper 는 조용한 녹음에서 "고맙습니다" 같은 말을 지어낸다
  transcribe?: (wavBase64: string) => Promise<string>;
  onTranscript: (text: string) => void;
  speaker: () => string;  // 잠금 화면 재생기 제목. 지금 에이전트 이름
  onLocked: () => void;   // 탭 없이 온 읽기를 iOS 가 막았다. 화면에 탭하라고 보인다
  onNoSpeech: (peak: number) => void;  // 듣다가 말이 없어 접었다
  // 문장 단위로 나눠 읽기를 청할지. 합성이 느린 목소리(supertonic)에서 첫 소리를 앞당긴다
  splitSpeech: () => boolean;
};

const STT_SAMPLE_RATE = 16000;
// 듣기 시작 직전의 소리도 붙인다. 탭이나 웨이크 직후 바로 말하면 첫 음절이 잘린다
const PREROLL_FRAMES = 4;
// iOS 는 제스처 밖에서 만든 AudioContext 를 멈춰 둔다. 이만큼 기다려도 안 풀리면 소리 없이 넘어간다
const RESUME_TIMEOUT_MS = 300;
const ARTWORK_URL = 'icons/icon-192.png';

export class Voice {
  state: VoiceState = 'idle';
  // ponytail: webkitSpeechRecognition 은 쓰지 않는다(마이크를 따로 잡아 웨이크워드와 부딪히고 홈 화면 웹앱에선 막힌다), 웹앱 인식률이 문제되면 서버 whisper 모델을 키운다
  serverStt = false;

  private source: AudioBufferSourceNode | null = null;
  private sourceDone: (() => void) | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private speechUnlocked = false;
  private lastPeak = 0;
  private gen = 0;  // stopSpeaking 마다 오른다. 준비 중이던 읽기는 끝나고 보면 낡았다
  private preroll: ArrayBuffer[] = [];
  private frames: ArrayBuffer[] = [];
  private endpoint: Endpoint | null = null;
  private seq = 0;
  private awaiting = new Set<number>();  // 보냈지만 아직 다 읽지 않은 읽기 요청 id
  private order: number[] = [];  // 읽을 순서. 조각이 순서 없이 와도 이 차례로 읽는다
  private ready = new Map<number, { data: string; text: string }>();
  private pumping = false;
  private utteranceDone: (() => void) | null = null;
  private phrases = new Set<string>();
  private wavs = new Map<string, Promise<ArrayBuffer | null>>();

  constructor(private d: Deps) {
    d.mic.onFrame((pcm, rms) => this.onFrame(pcm, rms));
  }

  get supported() {
    return (this.serverStt || !!this.d.transcribe) && !!navigator.mediaDevices?.getUserMedia && 'AudioWorkletNode' in window;
  }

  setPhrases(names: string[] = []) { this.phrases = new Set(names); }
  hasPhrase(name: string) { return this.phrases.has(name); }

  // 탭마다 부른다. iOS 는 사용자 제스처 안에서 만들거나 resume 한 AudioContext 만 소리를 낸다
  unlock() {
    this.d.mic.resume();
    // 기기 음성도 제스처 안에서 한 번 말해야 그 뒤로 탭 없이 읽는다
    if (!this.speechUnlocked && 'speechSynthesis' in window) {
      this.speechUnlocked = true;
      speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    }
  }

  toggle() {
    if (this.state === 'idle') void this.start();
    else if (this.state === 'listening') this.stop();
  }

  // 말이 끝나면(Endpoint) 스스로 보낸다. 탭으로 먼저 끝낼 수도 있다
  async start() {
    if (this.state !== 'idle') return;
    this.set('listening');
    try {
      await this.d.mic.ensure();
    } catch (e) {
      this.set('idle');
      this.d.onError(`마이크 접근 실패: ${(e as Error).message}`);
      return;
    }
    if ((this.state as VoiceState) !== 'listening') return;  // 마이크를 여는 사이 취소됐다
    this.frames = [...this.preroll];
    this.endpoint = new Endpoint();
    this.lastPeak = 0;
  }

  private onFrame(pcm: ArrayBuffer, rms: number) {
    if (this.state !== 'listening' || !this.endpoint) {
      this.preroll.push(pcm);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      return;
    }
    this.frames.push(pcm);
    const verdict = this.endpoint.push(rms);
    this.lastPeak = this.endpoint.peak;
    if (verdict === 'end') this.stop();
    else if (verdict === 'timeout') {
      this.cancel();
      this.d.onNoSpeech(this.lastPeak);
    }
  }

  stop() {
    if (this.state !== 'listening') return;
    const frames = this.frames;
    this.reset();
    if (!frames.length) return this.set('idle');
    this.set('processing');
    const data = bytesToBase64(pcmToWav(frames, STT_SAMPLE_RATE));
    if (this.d.transcribe) void this.transcribeHere(data, this.d.transcribe);
    else this.submit(data);
  }

  private async transcribeHere(data: string, transcribe: (wav: string) => Promise<string>) {
    const text = await transcribe(data).catch(() => null);
    if (this.state !== 'processing') return;  // 기다리는 사이 멈췄다
    if (text === null) return this.submit(data);
    if (text.trim()) return this.d.onTranscript(text.trim());
    this.set('idle');
    this.d.onNoSpeech(this.lastPeak);
  }

  // 결과는 voice_stt_result 로 온다
  private submit(data: string) {
    if (!this.d.send({ type: 'voice_stt_submit', data, mime: 'audio/wav', sample_rate: STT_SAMPLE_RATE })) {
      this.set('idle');
      this.d.onError('음성 전송 실패: 서버에 연결되지 않았습니다');
    }
  }

  // 듣던 것을 보내지 않고 접는다. 말이 없었거나 듣던 이유(승인 시트)가 사라졌을 때
  cancel() {
    if (this.state !== 'listening') return;
    this.reset();
    this.set('idle');
  }

  private reset() {
    this.frames = [];
    this.endpoint = null;
    this.preroll = [];
    if (!this.d.keepMic()) this.d.mic.close();
  }

  setIdle() { this.set('idle'); }

  // 서버에 읽어 달라고 한다. 결과는 voice_tts_audio 로 오고 receive 가 차례대로 읽는다.
  // 나눠 청하면 조각마다 part 를 붙이고, 첫 조각에 full_text 를 실어 서버가 밖에는 한 번만 알리게 한다
  requestSpeech(text: string, source: string) {
    const pieces = this.d.splitSpeech() ? splitSpeech(text) : [text];
    if (this.state === 'idle') this.set('processing');
    pieces.forEach((piece, part) => {
      const id = ++this.seq;
      const split = pieces.length > 1 ? { part, ...(part === 0 ? { full_text: text } : {}) } : {};
      if (!this.d.send({ type: 'voice_tts_request', text: piece, id, source, ...split })) return;
      this.awaiting.add(id);
      this.order.push(id);
    });
    if (!this.awaiting.size && this.state === 'processing') this.set('idle');
  }

  // 멈춘 뒤에 늦게 온 결과는 버린다. id 없는 결과(웨이크 뒤 되묻기)는 바로 읽는다.
  // text 는 data 가 빌 때 기기 음성이 읽을 글이다. 비우면 화면에만 둔다
  receive(id: number | null | undefined, data: string, text: string) {
    if (id == null) {
      void this.playItem({ data, text }).then(() => this.settle());
      return;
    }
    if (!this.awaiting.has(id)) return;
    this.ready.set(id, { data, text });
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    while (this.order.length && this.ready.has(this.order[0])) {
      const id = this.order.shift()!;
      const item = this.ready.get(id)!;
      this.ready.delete(id);
      await this.playItem(item);
      this.awaiting.delete(id);
      // 다음 조각이 아직 합성 중이다
      if (this.order.length && !this.ready.has(this.order[0])) this.set('processing');
    }
    this.pumping = false;
    this.settle();
  }

  private playItem({ data, text }: { data: string; text: string }) {
    if (data) return this.playBase64(data);
    if (text) return this.speakBrowser(text);
    return Promise.resolve();
  }

  // 기다리는 읽기가 없으면 쉰다
  private settle() {
    if (!this.awaiting.size && !this.pumping && (this.state === 'speaking' || this.state === 'processing')) this.set('idle');
  }

  isSpeaking() { return this.state === 'speaking' || this.awaiting.size > 0; }

  // 읽던 것과 기다리던 읽기를 모두 멈춘다. 여러 번 불러도 같다
  stopSpeaking() {
    this.gen += 1;
    this.awaiting.clear();
    this.order = [];
    this.ready.clear();
    if (this.source) {
      const source = this.source;
      this.source = null;
      source.onended = null;
      try { source.stop(); } catch { /* 이미 끝났다 */ }
    }
    this.sourceDone?.();
    this.sourceDone = null;
    this.utterance = null;
    this.utteranceDone?.();
    this.utteranceDone = null;
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    if (this.state === 'speaking' || this.state === 'processing') this.set('idle');
  }

  private playBase64(data: string) {
    return this.playWav(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer);
  }

  // 끝나거나 멈추거나 실패하면 풀린다. 쉬는 상태로 돌리는 건 부른 쪽(settle)이 한다. 조각 사이에 쉬면 웨이크와 승인 듣기가 끼어든다
  private async playWav(wav: ArrayBuffer) {
    const gen = this.gen;
    this.set('speaking');
    try {
      const ctx = this.d.mic.context();
      if ((ctx.state as string) !== 'running') {
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, RESUME_TIMEOUT_MS))]);
      }
      // 탭 전에 온 읽기(🔔 등)는 iOS 가 막는다. 멈춘 채 기다리면 speaking 에서 못 빠져나온다
      if ((ctx.state as string) !== 'running') {
        this.d.onLocked();
        throw new Error('오디오가 잠겨 있다(화면을 한 번 탭해야 풀린다)');
      }
      const buffer = await ctx.decodeAudioData(wav.slice(0));
      if (gen !== this.gen) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      await new Promise<void>((resolve) => {
        this.sourceDone = resolve;  // stopSpeaking 이 onended 를 떼어도 기다리는 쪽이 풀리게
        source.onended = () => {
          resolve();
          if (this.source === source) this.source = null;
        };
        this.source = source;
        source.start(0);
      });
    } catch (e) {
      console.warn('[voice] 재생 실패', e);
    }
  }

  // 서버 TTS 가 없거나 읽을 글이 한국어면 서버가 data 를 비워 보내고 기기 음성이 읽는다
  private speakBrowser(text: string, lang = 'ko-KR') {
    if (!('speechSynthesis' in window)) return Promise.resolve();
    this.set('speaking');
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    this.utterance = u;  // 재생 중인 utterance 가 수거돼 onend 를 잃지 않게 잡아 둔다
    return new Promise<void>((resolve) => {
      this.utteranceDone = resolve;  // stopSpeaking 의 cancel 이 onend 를 안 부르는 기기도 있다
      u.onend = u.onerror = () => {
        resolve();
        if (this.utterance === u) this.utterance = null;
      };
      speechSynthesis.speak(u);
    });
  }

  // 미리 녹음한 문구를 읽는다. 없거나 받지 못하면 false 라 부른 쪽이 합성으로 넘어갈 수 있다
  async cue(name: string) {
    if (!this.phrases.has(name)) return false;
    const wav = await this.phraseWav(name);
    if (!wav) return false;
    this.d.send({ type: 'voice_spoken', phrase: name });  // 서버가 이 문구의 문장을 외부 채널에 알린다
    await this.playWav(wav);
    this.settle();
    return true;
  }

  private phraseWav(name: string) {
    let wav = this.wavs.get(name);
    if (!wav) {
      // 실패는 담아 두지 않는다. 다음에 다시 받는다
      wav = this.d.fetchPhrase(name).catch(() => null).then((buf) => {
        if (!buf) this.wavs.delete(name);
        return buf;
      });
      this.wavs.set(name, wav);
    }
    return wav;
  }

  private set(state: VoiceState) {
    if (this.state === state) return;
    if (state === 'speaking') this.showNowPlaying();
    else if (this.state === 'speaking') this.hideNowPlaying();
    this.state = state;
    this.d.onState(state);
  }

  // 정보를 안 주면 iOS 잠금 화면 재생기에 페이지 호스트(capacitor://localhost 의 localhost)가 뜬다
  private showNowPlaying() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.d.speaker(),
      artwork: [{ src: new URL(ARTWORK_URL, location.href).href, sizes: '192x192', type: 'image/png' }],
    });
    navigator.mediaSession.playbackState = 'playing';
  }

  // ponytail: 컨텍스트는 멈추지 않는다(멈추면 탭 없이 온 읽기를 다시 못 깨울 수 있다), 다 읽은 뒤에도 재생기가 남으면 마이크가 꺼져 있을 때만 suspend 한다
  private hideNowPlaying() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }
}
