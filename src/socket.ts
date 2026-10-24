// 세션 하나에 붙는 WebSocket. 끊기면 다시 붙고, 앱이 앞으로 돌아오면 기다리지 않고 바로 붙는다.

export type ServerEvent = { type: string; [key: string]: any };

type Handlers = {
  onOpen: () => void;
  onEvent: (ev: ServerEvent) => void;
  onState: (state: 'connecting' | 'open' | 'closed') => void;
  onFatal: (reason: string) => void;
};

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10000;
// ws_router.py 가 accept 뒤 이 코드로 닫으면 다시 붙어도 같은 결과라 재시도하지 않는다
const FATAL_CODES: Record<number, string> = { 4401: '접근 키가 틀렸습니다', 4404: '모르는 에이전트입니다' };

export class Socket {
  private ws: WebSocket | null = null;
  private delay = RECONNECT_MIN_MS;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private url: string, private h: Handlers) {
    document.addEventListener('visibilitychange', this.onVisible);
    this.connect();
  }

  send(msg: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.ws?.close();
  }

  private connect() {
    clearTimeout(this.timer);
    this.h.onState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.delay = RECONNECT_MIN_MS;
      this.h.onState('open');
      this.h.onOpen();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.h.onEvent(JSON.parse(e.data));
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.stopped) return;
      this.h.onState('closed');
      if (FATAL_CODES[e.code]) return this.h.onFatal(FATAL_CODES[e.code]);
      this.timer = setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(this.delay * 2, RECONNECT_MAX_MS);
    };
  }

  // iOS 는 앱을 내리면 소켓을 끊고 타이머도 멈춘다. 돌아왔을 때 백오프를 기다리게 하지 않는다
  // ponytail: OPEN 인데 실제로는 죽은 연결은 못 알아챈다, 실기기에서 복귀 뒤 멈춤이 보이면 ping 을 더한다
  private onVisible = () => {
    if (document.visibilityState !== 'visible' || this.stopped) return;
    const state = this.ws?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    this.delay = RECONNECT_MIN_MS;
    this.connect();
  };
}
