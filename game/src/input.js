// Solmar Bay — keyboard + mouse input (pointer lock). Pure logic, DOM only
// inside attachInput.
export function createInput() {
  return {
    keys: {},
    mouseDX: 0,
    mouseDY: 0,
    locked: false,
    mouseDown: false,
  };
}

export function attachInput(input, canvas) {
  if (typeof window === 'undefined' || !canvas) return input;

  window.addEventListener('keydown', (e) => {
    input.keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    input.keys[e.code] = false;
  });
  window.addEventListener('blur', () => {
    input.keys = {};
    input.mouseDown = false;
  });

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
  });

  canvas.addEventListener('click', () => {
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  });

  document.addEventListener('mousemove', (e) => {
    if (input.locked) {
      input.mouseDX += e.movementX || 0;
      input.mouseDY += e.movementY || 0;
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) input.mouseDown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
  });

  return input;
}

export function isDown(input, code) {
  return !!(input && input.keys && input.keys[code]);
}

export function consumeMouse(input) {
  const out = { dx: input.mouseDX || 0, dy: input.mouseDY || 0 };
  input.mouseDX = 0;
  input.mouseDY = 0;
  return out;
}
