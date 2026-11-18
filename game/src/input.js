// Solmar Bay — keyboard + mouse input (Worker A, v3 rebuild).
// Returns the input object itself: { keys:Set, dx, dy, justPressed:Set,
// pointerLocked, attach(), detach(), endFrame() }.
//  - keys holds KeyboardEvent.code values (held keys).
//  - dx/dy accumulate pointer-lock mouse movement since the last endFrame().
//  - justPressed holds codes pressed this frame (edge) + 'Mouse0' on a left
//    click while pointer-locked.
// Listeners attach IMMEDIATELY on creation (main.js relies on that). The
// object is inert in Node: window/document are guarded, and a fake canvas
// without addEventListener simply gets no listeners.

export function createInput(canvas) {
  const hasWindow = typeof window !== 'undefined';
  const hasDocument = typeof document !== 'undefined';

  const input = {
    keys: new Set(),
    dx: 0,
    dy: 0,
    justPressed: new Set(),
    pointerLocked: false,
    attach,
    detach,
    endFrame,
  };

  function onKeyDown(e) {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.justPressed.add(e.code);
    // Keep arrows/space from scrolling the page.
    if (
      e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' || e.code === 'ArrowRight' ||
      e.code === 'Space'
    ) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    }
  }

  function onKeyUp(e) {
    input.keys.delete(e.code);
  }

  function onMouseMove(e) {
    if (!input.pointerLocked) return;
    input.dx += e.movementX || 0;
    input.dy += e.movementY || 0;
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (input.pointerLocked) {
      input.justPressed.add('Mouse0');
    } else if (canvas && typeof canvas.requestPointerLock === 'function') {
      canvas.requestPointerLock();
    }
  }

  function onLockChange() {
    input.pointerLocked = hasDocument && document.pointerLockElement === canvas;
  }

  // On blur the animation frame stops, so a stale dx would whip the camera
  // on return — clear everything.
  function onBlur() {
    input.keys.clear();
    input.dx = 0;
    input.dy = 0;
    input.justPressed.clear();
    input.pointerLocked = false;
  }

  function attach() {
    if (hasWindow) {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('blur', onBlur);
    }
    if (hasDocument) {
      document.addEventListener('pointerlockchange', onLockChange);
    }
    if (canvas && typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('mousedown', onMouseDown);
    }
  }

  function detach() {
    if (hasWindow) {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlur);
    }
    if (hasDocument) {
      document.removeEventListener('pointerlockchange', onLockChange);
    }
    if (canvas && typeof canvas.removeEventListener === 'function') {
      canvas.removeEventListener('mousedown', onMouseDown);
    }
  }

  function endFrame() {
    input.dx = 0;
    input.dy = 0;
    input.justPressed.clear();
  }

  attach();
  return input;
}
