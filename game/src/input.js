// input.js — keyboard + mouse input for Solmara.
// createInput(canvas) -> { keys:Set, mouseDX, mouseDY, consumeClick(),
// pressed(code), update() }.
// keys holds e.code strings currently held down. pressed(code) is
// edge-triggered: true once per physical press until update() runs at the
// end of the frame. mouseDX/mouseDY accumulate mouse-drag orbit deltas for
// the frame and are zeroed by update(). consumeClick() reports (and clears)
// a click (mouse down+up with almost no drag) for shooting / UI.
export function createInput(canvas) {
  const keys = new Set();
  const pressedSet = new Set();
  let mouseDX = 0;
  let mouseDY = 0;
  let clickPending = false;
  let dragging = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;

  const api = {
    keys,
    get mouseDX() { return mouseDX; },
    get mouseDY() { return mouseDY; },
    consumeClick() {
      const c = clickPending;
      clickPending = false;
      return c;
    },
    pressed(code) {
      return pressedSet.has(code);
    },
    update() {
      pressedSet.clear();
      mouseDX = 0;
      mouseDY = 0;
    },
  };

  // No browser (node test harness): return the inert object above.
  if (typeof window === 'undefined' || !canvas) return api;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressedSet.add(e.code);
    // Keep Space / arrows from scrolling the page.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    dragging = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    downX = e.clientX;
    downY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    mouseDX += e.clientX - lastX;
    mouseDY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved < 6) clickPending = true;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return api;
}
