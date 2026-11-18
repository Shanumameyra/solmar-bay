// SOLMAR BAY — keyboard + mouse input (v6, fresh write)
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    mouseDX: 0,
    mouseDY: 0,
    isDown(code) {
      return input.keys.has(code);
    },
  };

  // Keys whose browser default (scrolling) must not fire during play.
  const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  window.addEventListener('keydown', (e) => {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    input.keys.clear();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) input.keys.clear();
  });

  // Pointer lock on click (mouse look only while locked).
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      input.mouseDX += e.movementX || 0;
      input.mouseDY += e.movementY || 0;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) {
      input.mouseDX = 0;
      input.mouseDY = 0;
    }
  });

  return input;
}
