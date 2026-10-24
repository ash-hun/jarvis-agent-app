// 가로 스와이프 감지. 손가락을 따라 onMove 로 이동량을 알리고, 놓을 때 방향을 정한다.

// 이만큼 가로로 밀어야 넘어간다. 그보다 짧으면 제자리로 돌아온다
const SWIPE_PX = 60;
// 세로로 더 많이 움직였으면 스와이프가 아니다(스크롤이나 탭)
const HORIZONTAL_RATIO = 1.5;

// 1: 왼쪽으로 밀었다(다음), -1: 오른쪽으로 밀었다(이전), 0: 스와이프 아님
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) return 0;
  return dx < 0 ? 1 : -1;
}

export function onSwipe(el: HTMLElement, h: { onMove: (dx: number) => void; onEnd: (dir: -1 | 0 | 1) => void }) {
  let start: { x: number; y: number; id: number } | null = null;

  el.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (start?.id === e.pointerId) h.onMove(e.clientX - start.x);
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    if (start?.id !== e.pointerId) return;
    const dir = cancelled ? 0 : swipeDirection(e.clientX - start.x, e.clientY - start.y);
    start = null;
    h.onEnd(dir);
  };
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));
}
