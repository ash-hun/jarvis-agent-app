// 구체 위의 손짓. 가로로 밀면 onMove 로 이동량을 알리고 놓을 때 방향을 정한다. 거의 안 움직이고 떼면 탭이다.

// 이만큼 가로로 밀어야 넘어간다. 그보다 짧으면 제자리로 돌아온다
const SWIPE_PX = 60;
// 세로로 더 많이 움직였으면 스와이프가 아니다(스크롤이나 탭)
const HORIZONTAL_RATIO = 1.5;
// 손가락은 떼는 순간에도 조금 밀린다. 이 안이면 탭으로 본다
const TAP_PX = 10;

// 1: 왼쪽으로 밀었다(다음), -1: 오른쪽으로 밀었다(이전), 0: 스와이프 아님
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) return 0;
  return dx < 0 ? 1 : -1;
}

export function isTap(dx: number, dy: number) {
  return Math.hypot(dx, dy) < TAP_PX;
}

export function onSwipe(el: HTMLElement, h: { onMove: (dx: number) => void; onEnd: (dir: -1 | 0 | 1) => void; onTap: () => void }) {
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
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    h.onEnd(cancelled ? 0 : swipeDirection(dx, dy));
    // 탭은 pointerup 안에서 부른다. iOS 는 이 안에서만 마이크와 오디오를 연다
    if (!cancelled && isTap(dx, dy)) h.onTap();
  };
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));
}
