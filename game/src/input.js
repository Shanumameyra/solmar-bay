// SOLMAR BAY — input. Keyboard + mouse (pointer lock) into the object the
// loop consumes (contract in repo/NOTES.md, written by Worker B):
//   keys: Set of KeyboardEvent.code currently held
//   dx, dy: accumulated mouse movement since the last endFrame() call
//   justPressed: Set of codes pressed this frame (edge) — keydown (non-repeat)
//     plus 'Mouse0' on left click
//   pointerLocked: bool
//   attach(): (re)attach the listeners; endFrame(): clear dx/dy/justPressed.
// Listeners attach IMMEDIATELY on creation — main.js never calls attach(),
// it just reads the object every frame. A click on the canvas requests
// pointer lock; the first click only locks, the next ones fire 'Mouse0'.
// Runs in the browser only; constructing it in node is safe (no listeners
// are attached without a document).
export function createInput(canvas) {
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

  const hasDocument = typeof document !== 'undefined';
  let attached = false;

  function keyDown(e) {
    if (!e.repeat) input.justPressed.add(e.code);
    input.keys.add(e.code);
    // Keep the page from scrolling on game keys.
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  }

  function keyUp(e) { input.keys.delete(e.code); }

  function mouseMove(e) {
    if (!input.pointerLocked) return;
    input.dx += e.movementX || 0;
    input.dy += e.movementY || 0;
  }

  function mouseDown(e) {
    if (!input.pointerLocked) {
      lockPointer();
      return;
    }
    if (e.button === 0) input.justPressed.add('Mouse0');
  }

  function lockChange() {
    input.pointerLocked = hasDocument && document.pointerLockElement === canvas;
  }

  function lockPointer() {
    if (hasDocument && canvas && canvas.requestPointerLock) {
      canvas.requestPointerLock();
    }
  }

  // A key released while the tab is hidden never sends keyup: let go of
  // everything on blur, or the player keeps driving into a wall.
  function onBlur() {
    input.keys.clear();
  }

  function attach() {
    if (attached || !hasDocument) return;
    attached = true;
    document.addEventListener('keydown', keyDown);
    document.addEventListener('keyup', keyUp);
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('pointerlockchange', lockChange);
    window.addEventListener('blur', onBlur);
    if (canvas) {
      canvas.addEventListener('mousedown', mouseDown);
      canvas.addEventListener('click', lockPointer);
    }
  }

  function detach() {
    if (!attached || !hasDocument) return;
    attached = false;
    document.removeEventListener('keydown', keyDown);
    document.removeEventListener('keyup', keyUp);
    document.removeEventListener('mousemove', mouseMove);
    document.removeEventListener('pointerlockchange', lockChange);
    window.removeEventListener('blur', onBlur);
    if (canvas) {
      canvas.removeEventListener('mousedown', mouseDown);
      canvas.removeEventListener('click', lockPointer);
    }
    input.keys.clear();
    endFrame();
  }

  function endFrame() {
    input.dx = 0;
    input.dy = 0;
    input.justPressed.clear();
  }

  attach();
  return input;
}
